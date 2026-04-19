import http from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type {
  ProxyApprovalRequester,
  ProxyAuditSink,
  ProxyMapping,
  ProxyTokenValidator,
} from '../types/proxy_types.js';
import { DEFAULT_PROXY_HOST } from '../types/proxy_types.js';
import { createChildLogger } from '../../../lib/logger.js';
import { authorizeProxyRequest } from './proxy_auth.js';
import { createProxyApprovalCache, type ProxyApprovalCache } from './proxy_approval_cache.js';

const log = createChildLogger('proxy');

export interface ProxyServers {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Runtime dependencies shared by every proxy mapping. All fields are
 * optional so that legacy callers with only open (`authMode: 'none'`)
 * proxies keep working without wiring them up.
 */
export interface ProxyServerDeps {
  tokenValidator?: ProxyTokenValidator;
  approvalRequester?: ProxyApprovalRequester;
  auditSink?: ProxyAuditSink;
  /** Injected primarily so tests can isolate per-mapping cache state. */
  approvalCacheFactory?: () => ProxyApprovalCache;
}

interface RunningProxy {
  mapping: ProxyMapping;
  server: http.Server;
  cache: ProxyApprovalCache;
}

function writeJsonError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: code, message }));
}

function buildProxyServer(
  mapping: ProxyMapping,
  deps: ProxyServerDeps,
  cache: ProxyApprovalCache,
): http.Server {
  const middleware = createProxyMiddleware({
    target: mapping.baseUrl,
    changeOrigin: true,
    logger: log,
    on: {
      proxyReq: (proxyReq) => {
        // Defense-in-depth: also strip the caller's auth header from the
        // outgoing request. The incoming req.headers has already been
        // mutated (see handler below), but proxyReq.removeHeader is the
        // authoritative write onto the outgoing socket.
        if (mapping.authMode && mapping.authMode !== 'none' && mapping.apiKeyHeader) {
          proxyReq.removeHeader(mapping.apiKeyHeader);
        }
        if (!mapping.headers) return;
        for (const [name, value] of Object.entries(mapping.headers)) {
          proxyReq.setHeader(name, value);
        }
      },
      error: (err, _req, res) => {
        log.error({ err, port: mapping.port, baseUrl: mapping.baseUrl }, 'Proxy upstream error');
        // res can be a ServerResponse or a Socket (on WebSocket upgrades).
        // Only ServerResponse has writeHead/end that make sense for HTTP errors.
        if ('writeHead' in res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_gateway', message: 'Upstream request failed' }));
        }
      },
    },
  });

  return http.createServer((req, res) => {
    authorizeProxyRequest(req, {
      mapping,
      validator: deps.tokenValidator,
      approvalRequester: deps.approvalRequester,
      cache,
      audit: deps.auditSink,
    })
      .then((decision) => {
        if (decision.kind === 'reject') {
          writeJsonError(res, decision.status, decision.code, decision.message);
          return;
        }

        // Strip the caller's auth header from req.headers before the proxy
        // middleware forwards it, so the lucifer-gate token does not leak
        // upstream. The proxyReq handler also removes it on the outgoing
        // socket (belt and braces).
        if (mapping.authMode && mapping.authMode !== 'none' && mapping.apiKeyHeader) {
          delete req.headers[mapping.apiKeyHeader.toLowerCase()];
        }

        middleware(req, res).catch((err: unknown) => {
          log.error({ err, port: mapping.port }, 'Proxy middleware threw');
          writeJsonError(res, 502, 'bad_gateway', 'Proxy handler failed');
        });
      })
      .catch((err: unknown) => {
        // authorizeProxyRequest never rejects, but guard just in case.
        log.error({ err, port: mapping.port }, 'Proxy auth threw unexpectedly');
        writeJsonError(res, 500, 'internal_error', 'Proxy authorization failed');
      });
  });
}

function listenAsync(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      rejectListen(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeAsync(server: http.Server): Promise<void> {
  return new Promise((resolveClose) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.close(() => resolveClose());
  });
}

async function bestEffortClose(server: http.Server): Promise<void> {
  try {
    await closeAsync(server);
  } catch (err) {
    log.warn({ err }, 'Error while closing proxy listener');
  }
}

/**
 * Validate that every mapping with a non-`none` authMode has the runtime
 * deps it needs. Called at startup so operators get a descriptive error
 * rather than a confusing 500 on the first request.
 */
function validateMappingDeps(mappings: ProxyMapping[], deps: ProxyServerDeps): void {
  for (const [index, m] of mappings.entries()) {
    const mode = m.authMode ?? 'none';
    if (mode === 'none') continue;
    if (!deps.tokenValidator) {
      throw new Error(
        `Proxy mapping proxies[${index}] (port ${m.port}) has authMode='${mode}' but no token validator is wired. ` +
        `Ensure api-keys.json is present so the gateway is initialized before the proxy.`,
      );
    }
    if (mode === 'api-key-telegram' && !deps.approvalRequester) {
      throw new Error(
        `Proxy mapping proxies[${index}] (port ${m.port}) has authMode='api-key-telegram' but no approval channel is wired. ` +
        `Configure Telegram (LUCIFER_TELEGRAM_TOKEN + chat id) or the web approval UI.`,
      );
    }
  }
}

/**
 * Build proxy servers for a set of mappings. Listeners are NOT bound until
 * `start()` is called so that `createApp()` stays synchronous and config
 * errors surface before any socket is opened.
 *
 * `start()` is all-or-nothing: if a later listener fails to bind, already-
 * started listeners are closed before the error is rethrown, so the caller
 * never observes a partially-started set.
 */
export function createProxyServers(
  mappings: ProxyMapping[],
  deps: ProxyServerDeps = {},
): ProxyServers {
  validateMappingDeps(mappings, deps);

  const cacheFactory = deps.approvalCacheFactory ?? (() => createProxyApprovalCache());

  const running: RunningProxy[] = mappings.map((mapping) => {
    const cache = cacheFactory();
    return {
      mapping,
      cache,
      server: buildProxyServer(mapping, deps, cache),
    };
  });

  async function start(): Promise<void> {
    const started: RunningProxy[] = [];
    try {
      for (const entry of running) {
        const host = entry.mapping.host ?? DEFAULT_PROXY_HOST;
        await listenAsync(entry.server, entry.mapping.port, host);
        started.push(entry);
        log.info(
          { port: entry.mapping.port, host, baseUrl: entry.mapping.baseUrl, authMode: entry.mapping.authMode ?? 'none' },
          'Proxy listening',
        );
      }
    } catch (err) {
      // Roll back any listeners that did come up before rethrowing, so the
      // caller sees an all-or-nothing startup.
      await Promise.all(started.map(({ server }) => bestEffortClose(server)));
      throw err;
    }
  }

  async function stop(): Promise<void> {
    // Best-effort close: a listener that never bound (e.g. because start()
    // failed partway) must not prevent cleanup of the rest.
    await Promise.all(running.map(({ server, cache }) => {
      cache.clear();
      return bestEffortClose(server);
    }));
  }

  return { start, stop };
}

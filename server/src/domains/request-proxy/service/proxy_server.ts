import http from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ProxyMapping } from '../types/proxy_types.js';
import { DEFAULT_PROXY_HOST } from '../types/proxy_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('proxy');

export interface ProxyServers {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface RunningProxy {
  mapping: ProxyMapping;
  server: http.Server;
}

function buildProxyServer(mapping: ProxyMapping): http.Server {
  const middleware = createProxyMiddleware({
    target: mapping.baseUrl,
    changeOrigin: true,
    logger: log,
    on: {
      proxyReq: (proxyReq) => {
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
    middleware(req, res).catch((err: unknown) => {
      log.error({ err, port: mapping.port }, 'Proxy middleware threw');
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_gateway', message: 'Proxy handler failed' }));
      }
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
 * Build proxy servers for a set of mappings. Listeners are NOT bound until
 * `start()` is called so that `createApp()` stays synchronous and config
 * errors surface before any socket is opened.
 *
 * `start()` is all-or-nothing: if a later listener fails to bind, already-
 * started listeners are closed before the error is rethrown, so the caller
 * never observes a partially-started set.
 */
export function createProxyServers(mappings: ProxyMapping[]): ProxyServers {
  const running: RunningProxy[] = mappings.map((mapping) => ({
    mapping,
    server: buildProxyServer(mapping),
  }));

  async function start(): Promise<void> {
    const started: RunningProxy[] = [];
    try {
      for (const entry of running) {
        const host = entry.mapping.host ?? DEFAULT_PROXY_HOST;
        await listenAsync(entry.server, entry.mapping.port, host);
        started.push(entry);
        log.info(
          { port: entry.mapping.port, host, baseUrl: entry.mapping.baseUrl },
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
    await Promise.all(running.map(({ server }) => bestEffortClose(server)));
  }

  return { start, stop };
}

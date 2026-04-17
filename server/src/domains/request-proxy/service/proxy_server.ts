import http from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ProxyMapping } from '../types/proxy_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('proxy');

export interface ProxyServers {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Opaque handle on one running listener — exported for testability. */
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
    // http-proxy-middleware returns a Promise<void>; unhandled rejections
    // here would log via the `error` handler above, but we guard explicitly.
    middleware(req, res).catch((err: unknown) => {
      log.error({ err, port: mapping.port }, 'Proxy middleware threw');
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_gateway', message: 'Proxy handler failed' }));
      }
    });
  });
}

function listenAsync(server: http.Server, port: number): Promise<void> {
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
    server.listen(port);
  });
}

function closeAsync(server: http.Server): Promise<void> {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose());
  });
}

/**
 * Build proxy servers for a set of mappings. Listeners are NOT bound until
 * `start()` is called so that `createApp()` stays synchronous and config
 * errors surface before any socket is opened.
 */
export function createProxyServers(mappings: ProxyMapping[]): ProxyServers {
  const running: RunningProxy[] = mappings.map((mapping) => ({
    mapping,
    server: buildProxyServer(mapping),
  }));

  async function start(): Promise<void> {
    for (const { mapping, server } of running) {
      await listenAsync(server, mapping.port);
      log.info({ port: mapping.port, baseUrl: mapping.baseUrl }, 'Proxy listening');
    }
  }

  async function stop(): Promise<void> {
    await Promise.all(running.map(({ server }) => closeAsync(server)));
  }

  return { start, stop };
}

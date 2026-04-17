import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProxyServers, type ProxyServers } from './proxy_server.js';

interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Spin up a fake upstream that records every request it receives. */
function createUpstream(): Promise<{ server: http.Server; port: number; captured: CapturedRequest[] }> {
  return new Promise((resolve) => {
    const captured: CapturedRequest[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        captured.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'x-upstream-marker': 'yes' });
        res.end(JSON.stringify({ ok: true, echoedUrl: req.url }));
      });
    });
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port, captured });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function findFreePort(): Promise<number> {
  const throwaway = http.createServer();
  await new Promise<void>((r) => throwaway.listen(0, r));
  const { port } = throwaway.address() as AddressInfo;
  await closeServer(throwaway);
  return port;
}

describe('createProxyServers', () => {
  let upstream: { server: http.Server; port: number; captured: CapturedRequest[] };
  let proxies: ProxyServers | undefined;

  beforeAll(async () => {
    upstream = await createUpstream();
  });

  afterAll(async () => {
    await closeServer(upstream.server);
  });

  afterEach(async () => {
    if (proxies) {
      await proxies.stop();
      proxies = undefined;
    }
    upstream.captured.length = 0;
  });

  it('forwards request path and body to the upstream', async () => {
    const proxyPort = await findFreePort();

    proxies = createProxyServers([
      { port: proxyPort, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-upstream-marker')).toBe('yes');
    const json = await res.json() as { ok: boolean; echoedUrl: string };
    expect(json.ok).toBe(true);
    expect(json.echoedUrl).toBe('/v1/chat/completions?x=1');

    expect(upstream.captured).toHaveLength(1);
    const captured = upstream.captured[0];
    expect(captured.method).toBe('POST');
    expect(captured.url).toBe('/v1/chat/completions?x=1');
    expect(captured.body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('injects configured headers and overrides caller-supplied values of the same name', async () => {
    const proxyPort = await findFreePort();

    proxies = createProxyServers([
      {
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        headers: {
          'x-injected': 'from-proxy',
          authorization: 'Bearer configured-key',
        },
      },
    ]);
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/ping`, {
      headers: {
        authorization: 'Bearer caller-key',
        'x-caller-only': 'kept',
      },
    });

    expect(res.status).toBe(200);
    const captured = upstream.captured[0];
    expect(captured.headers['x-injected']).toBe('from-proxy');
    expect(captured.headers['authorization']).toBe('Bearer configured-key');
    expect(captured.headers['x-caller-only']).toBe('kept');
  });

  it('returns 502 when the upstream is unreachable', async () => {
    const proxyPort = await findFreePort();
    const deadPort = await findFreePort();

    proxies = createProxyServers([
      { port: proxyPort, baseUrl: `http://127.0.0.1:${deadPort}` },
    ]);
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/whatever`);
    expect(res.status).toBe(502);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('bad_gateway');
  });

  it('starts and stops multiple listeners independently', async () => {
    const port1 = await findFreePort();
    const port2 = await findFreePort();

    proxies = createProxyServers([
      { port: port1, baseUrl: `http://127.0.0.1:${upstream.port}` },
      { port: port2, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);
    await proxies.start();

    const [r1, r2] = await Promise.all([
      fetch(`http://127.0.0.1:${port1}/one`),
      fetch(`http://127.0.0.1:${port2}/two`),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    await proxies.stop();
    proxies = undefined;

    await expect(fetch(`http://127.0.0.1:${port1}/one`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${port2}/two`)).rejects.toThrow();
  });

  it('start() rejects when the port is already in use', async () => {
    const squatter = http.createServer();
    await new Promise<void>((r) => squatter.listen(0, r));
    const port = (squatter.address() as AddressInfo).port;

    proxies = createProxyServers([
      { port, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);

    await expect(proxies.start()).rejects.toThrow();
    await closeServer(squatter);
    proxies = undefined;
  });
});

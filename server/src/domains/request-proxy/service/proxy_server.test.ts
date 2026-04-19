import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProxyServers, type ProxyServers } from './proxy_server.js';
import type {
  ProxyApprovalOutcome,
  ProxyApprovalRequester,
  ProxyTokenValidator,
} from '../types/proxy_types.js';

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
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', r));
    const port = (squatter.address() as AddressInfo).port;

    proxies = createProxyServers([
      { port, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);

    await expect(proxies.start()).rejects.toThrow();
    await closeServer(squatter);
    proxies = undefined;
  });

  it('binds to loopback (127.0.0.1) by default so a credentialed proxy is not network-exposed', async () => {
    const proxyPort = await findFreePort();

    proxies = createProxyServers([
      { port: proxyPort, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);
    await proxies.start();

    // A second listener on the same port but bound to a *different*
    // interface must succeed — proves the first listener is NOT on 0.0.0.0.
    const coexistence = http.createServer((_req, res) => res.end('coexists'));
    await new Promise<void>((resolve, reject) => {
      coexistence.once('error', reject);
      coexistence.once('listening', () => resolve());
      coexistence.listen(proxyPort, '::1');
    });
    await closeServer(coexistence);
  });

  it('honors an explicit host when set to 0.0.0.0', async () => {
    const proxyPort = await findFreePort();

    proxies = createProxyServers([
      {
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        host: '0.0.0.0',
      },
    ]);
    await proxies.start();

    // Reachable via loopback (which is within 0.0.0.0) — proves the bind
    // succeeded on the requested host.
    const res = await fetch(`http://127.0.0.1:${proxyPort}/ok`);
    expect(res.status).toBe(200);
  });

  it('start() rolls back already-started listeners when a later one fails', async () => {
    const port1 = await findFreePort();
    const squatter = http.createServer();
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', r));
    const port2 = (squatter.address() as AddressInfo).port;

    proxies = createProxyServers([
      { port: port1, baseUrl: `http://127.0.0.1:${upstream.port}` },
      { port: port2, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);

    await expect(proxies.start()).rejects.toThrow();
    proxies = undefined;

    // Rollback proof: port1 is no longer bound by our proxy — a fresh
    // listener can grab it immediately.
    const claimant = http.createServer();
    await new Promise<void>((resolve, reject) => {
      claimant.once('error', reject);
      claimant.once('listening', () => resolve());
      claimant.listen(port1, '127.0.0.1');
    });
    await closeServer(claimant);
    await closeServer(squatter);
  });

  it('stop() tolerates listeners that never bound', async () => {
    const squatter = http.createServer();
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', r));
    const squattedPort = (squatter.address() as AddressInfo).port;

    proxies = createProxyServers([
      { port: squattedPort, baseUrl: `http://127.0.0.1:${upstream.port}` },
    ]);

    await expect(proxies.start()).rejects.toThrow();
    // stop() must not throw even though nothing ever bound.
    await expect(proxies.stop()).resolves.toBeUndefined();
    await closeServer(squatter);
    proxies = undefined;
  });

  // ---------------------------------------------------------------------------
  // Authentication modes
  // ---------------------------------------------------------------------------

  function validatorFor(tokenToIdentity: Record<string, { keyId: string; keyName: string }>): ProxyTokenValidator {
    return {
      validate(raw: string) {
        return tokenToIdentity[raw];
      },
    };
  }

  function fixedRequester(outcome: ProxyApprovalOutcome): ProxyApprovalRequester {
    return { request: vi.fn().mockResolvedValue(outcome) };
  }

  it('api-key mode accepts a valid Authorization: Bearer token (OpenAI shape) and strips it from the forwarded request', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_ok': { keyId: 'k1', keyName: 'openai' } });

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
        headers: { authorization: 'Bearer UPSTREAM-REAL-KEY' },
      }],
      { tokenValidator: validator },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer luc_ok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4' }),
    });

    expect(res.status).toBe(200);
    const captured = upstream.captured[0];
    // Upstream sees the real credential, NOT the caller's lucifer-gate token.
    expect(captured.headers['authorization']).toBe('Bearer UPSTREAM-REAL-KEY');
    expect(captured.headers['authorization']).not.toContain('luc_ok');
  });

  it('api-key mode accepts an x-api-key token (Anthropic shape, no prefix)', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_ant': { keyId: 'k2', keyName: 'anthropic' } });

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key',
        apiKeyHeader: 'x-api-key',
        headers: { 'x-api-key': 'sk-ant-REAL' },
      }],
      { tokenValidator: validator },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'luc_ant' },
    });

    expect(res.status).toBe(200);
    expect(upstream.captured[0].headers['x-api-key']).toBe('sk-ant-REAL');
  });

  it('api-key mode accepts an api-key token (Azure shape)', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_az': { keyId: 'k3', keyName: 'azure' } });

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key',
        apiKeyHeader: 'api-key',
        headers: { 'api-key': 'azure-REAL' },
      }],
      { tokenValidator: validator },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/openai/deployments/foo/chat/completions`, {
      method: 'POST',
      headers: { 'api-key': 'luc_az' },
    });

    expect(res.status).toBe(200);
    expect(upstream.captured[0].headers['api-key']).toBe('azure-REAL');
  });

  it('api-key mode returns 401 when the token is missing', async () => {
    const proxyPort = await findFreePort();

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
      }],
      { tokenValidator: validatorFor({}) },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, { method: 'POST' });

    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('unauthorized');
    expect(upstream.captured).toHaveLength(0);
  });

  it('api-key mode returns 401 when the token is wrong', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_good': { keyId: 'k1', keyName: 'n' } });

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
      }],
      { tokenValidator: validator },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer luc_bad' },
    });

    expect(res.status).toBe(401);
    expect(upstream.captured).toHaveLength(0);
  });

  it('api-key-telegram mode forwards on approval and reuses the cache on the second request', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_t': { keyId: 'kt', keyName: 'tele' } });
    const requester = fixedRequester('approved');

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key-telegram',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
        telegramApprovalTtlSeconds: 60,
        headers: { authorization: 'Bearer REAL' },
      }],
      { tokenValidator: validator, approvalRequester: requester },
    );
    await proxies.start();

    const r1 = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer luc_t' },
    });
    const r2 = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer luc_t' },
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(requester.request).toHaveBeenCalledTimes(1);
    expect(upstream.captured).toHaveLength(2);
  });

  it('api-key-telegram mode returns 403 when the approver denies', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_t': { keyId: 'kt', keyName: 'tele' } });

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key-telegram',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
      }],
      { tokenValidator: validator, approvalRequester: fixedRequester('denied') },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer luc_t' },
    });

    expect(res.status).toBe(403);
    expect(upstream.captured).toHaveLength(0);
  });

  it('api-key-telegram mode returns 408 when approval times out', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_t': { keyId: 'kt', keyName: 'tele' } });

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key-telegram',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
      }],
      { tokenValidator: validator, approvalRequester: fixedRequester('timeout') },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer luc_t' },
    });

    expect(res.status).toBe(408);
  });

  it('api-key-telegram mode returns 503 when the approval channel errors', async () => {
    const proxyPort = await findFreePort();
    const validator = validatorFor({ 'luc_t': { keyId: 'kt', keyName: 'tele' } });
    const requester: ProxyApprovalRequester = { request: vi.fn().mockRejectedValue(new Error('bot offline')) };

    proxies = createProxyServers(
      [{
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key-telegram',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
      }],
      { tokenValidator: validator, approvalRequester: requester },
    );
    await proxies.start();

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer luc_t' },
    });

    expect(res.status).toBe(503);
  });

  it('throws at construction when api-key mapping has no token validator', () => {
    expect(() => createProxyServers(
      [{
        port: 9999,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key',
        apiKeyHeader: 'authorization',
      }],
      {},
    )).toThrow(/no token validator/i);
  });

  it('throws at construction when api-key-telegram mapping has no approval channel', () => {
    expect(() => createProxyServers(
      [{
        port: 9999,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        authMode: 'api-key-telegram',
        apiKeyHeader: 'authorization',
        apiKeyPrefix: 'Bearer ',
      }],
      { tokenValidator: validatorFor({}) },
    )).toThrow(/no approval channel/i);
  });
});

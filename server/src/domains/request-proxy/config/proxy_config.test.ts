import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProxyConfig, validateProxyPorts } from './proxy_config.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `lucifer-proxy-config-test-${Date.now()}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeProxyFile(dir: string, body: unknown): string {
  const filePath = join(dir, 'proxy-config.json');
  writeFileSync(filePath, JSON.stringify(body));
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('loadProxyConfig', () => {
  it('returns undefined when configPath is undefined', () => {
    expect(loadProxyConfig(undefined)).toBeUndefined();
  });

  it('returns undefined when the file does not exist', () => {
    const dir = createTempDir();
    expect(loadProxyConfig(join(dir, 'proxy-config.json'))).toBeUndefined();
  });

  it('loads an empty proxies array', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, { proxies: [] });
    const config = loadProxyConfig(filePath);
    expect(config).toEqual({ proxies: [] });
  });

  it('loads a single mapping with headers', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [
        { port: 6060, baseUrl: 'https://api.openai.com', headers: { Authorization: 'Bearer x' } },
      ],
    });
    const config = loadProxyConfig(filePath);
    expect(config?.proxies).toHaveLength(1);
    expect(config?.proxies[0].port).toBe(6060);
    expect(config?.proxies[0].baseUrl).toBe('https://api.openai.com');
    expect(config?.proxies[0].headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('loads a mapping without headers', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 7070, baseUrl: 'http://localhost:9000' }],
    });
    const config = loadProxyConfig(filePath);
    expect(config?.proxies[0].headers).toBeUndefined();
  });

  it('loads an explicit host override', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 7070, baseUrl: 'http://localhost:9000', host: '0.0.0.0' }],
    });
    const config = loadProxyConfig(filePath);
    expect(config?.proxies[0].host).toBe('0.0.0.0');
  });

  it('leaves host undefined when omitted (caller applies loopback default)', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 7070, baseUrl: 'http://localhost:9000' }],
    });
    const config = loadProxyConfig(filePath);
    expect(config?.proxies[0].host).toBeUndefined();
  });

  it('rejects a non-string host', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 7070, baseUrl: 'http://localhost:9000', host: 123 }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects an empty host string', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 7070, baseUrl: 'http://localhost:9000', host: '' }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects a non-integer port', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 80.5, baseUrl: 'https://api.openai.com' }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects an out-of-range port', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 70000, baseUrl: 'https://api.openai.com' }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects a non-http baseUrl', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 6060, baseUrl: 'file:///tmp/not-a-proxy' }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects a malformed baseUrl', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 6060, baseUrl: 'not a url' }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects non-string header values', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {
      proxies: [{ port: 6060, baseUrl: 'https://api.openai.com', headers: { X: 1 } }],
    });
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });

  it('rejects a missing proxies array', () => {
    const dir = createTempDir();
    const filePath = writeProxyFile(dir, {});
    expect(() => loadProxyConfig(filePath)).toThrow('failed validation');
  });
});

describe('validateProxyPorts', () => {
  it('accepts disjoint ports', () => {
    expect(() =>
      validateProxyPorts(
        [
          { port: 6060, baseUrl: 'https://a' },
          { port: 7070, baseUrl: 'https://b' },
        ],
        3001,
      ),
    ).not.toThrow();
  });

  it('rejects collision with the gateway port', () => {
    expect(() =>
      validateProxyPorts([{ port: 3001, baseUrl: 'https://a' }], 3001),
    ).toThrow('collides with the main gateway port');
  });

  it('rejects two proxies on the same port', () => {
    expect(() =>
      validateProxyPorts(
        [
          { port: 6060, baseUrl: 'https://a' },
          { port: 6060, baseUrl: 'https://b' },
        ],
        3001,
      ),
    ).toThrow('Duplicate proxy port');
  });

  it('accepts an empty array', () => {
    expect(() => validateProxyPorts([], 3001)).not.toThrow();
  });
});

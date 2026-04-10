import { describe, it, expect, afterEach } from 'vitest';
import { hashApiKey, generateApiKey, createApiKeyStore } from './api_key_store.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDirs: string[] = [];

function createTestKeyConfig(keys: object[]): string {
  const dir = join(tmpdir(), `lucifer-apikey-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const path = join(dir, 'api-keys.json');
  writeFileSync(path, JSON.stringify({ keys }));
  return path;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

describe('hashApiKey', () => {
  it('is deterministic — same key + salt produces same hash', () => {
    const hash1 = hashApiKey('my-secret-key', 'my-salt');
    const hash2 = hashApiKey('my-secret-key', 'my-salt');
    expect(hash1).toBe(hash2);
  });

  it('produces different hash with different salt', () => {
    const hash1 = hashApiKey('my-secret-key', 'salt-a');
    const hash2 = hashApiKey('my-secret-key', 'salt-b');
    expect(hash1).not.toBe(hash2);
  });
});

describe('generateApiKey', () => {
  it('returns key starting with luc_', () => {
    const { key } = generateApiKey();
    expect(key.startsWith('luc_')).toBe(true);
  });

  it('returns object where hashApiKey(key, salt) equals keyHash', () => {
    const { key, salt, keyHash } = generateApiKey();
    expect(hashApiKey(key, salt)).toBe(keyHash);
  });
});

describe('createApiKeyStore', () => {
  it('findByKey returns matching config for a valid key', () => {
    const { key, salt, keyHash } = generateApiKey();
    const configPath = createTestKeyConfig([
      {
        id: 'key-1',
        name: 'test-key',
        keyHash,
        salt,
        createdAt: new Date().toISOString(),
        active: true,
      },
    ]);

    const store = createApiKeyStore(configPath);
    const found = store.findByKey(key);
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-key');
    expect(found!.id).toBe('key-1');
  });

  it('findByKey skips inactive key', () => {
    const { key, salt, keyHash } = generateApiKey();
    const configPath = createTestKeyConfig([
      {
        id: 'key-1',
        name: 'inactive-key',
        keyHash,
        salt,
        createdAt: new Date().toISOString(),
        active: false,
      },
    ]);

    const store = createApiKeyStore(configPath);
    const found = store.findByKey(key);
    expect(found).toBeUndefined();
  });

  it('findByKey returns undefined for unknown key', () => {
    const { salt, keyHash } = generateApiKey();
    const configPath = createTestKeyConfig([
      {
        id: 'key-1',
        name: 'test-key',
        keyHash,
        salt,
        createdAt: new Date().toISOString(),
        active: true,
      },
    ]);

    const store = createApiKeyStore(configPath);
    const found = store.findByKey('luc_completely_wrong_key');
    expect(found).toBeUndefined();
  });

  it('throws when config has malformed keys (not an array)', () => {
    const dir = join(tmpdir(), `lucifer-apikey-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    const path = join(dir, 'api-keys.json');
    writeFileSync(path, JSON.stringify({ keys: 'not-an-array' }));

    expect(() => createApiKeyStore(path)).toThrow();
  });
});

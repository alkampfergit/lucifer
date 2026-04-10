import { describe, it, expect, beforeEach } from 'vitest';
import { authenticateRequest, createRateLimiter } from './authenticate_request.js';
import type { ApiKeyStore } from '../types/store_interfaces.js';
import type { ApiKeyConfig } from '../types/command_types.js';

const testKey: ApiKeyConfig = {
  id: 'test-1',
  name: 'test-key',
  keyHash: 'abc123',
  salt: 'salt',
  allowedIps: [],
  createdAt: '2026-01-01T00:00:00Z',
  active: true,
};

const testKeyWithIps: ApiKeyConfig = {
  ...testKey,
  id: 'test-2',
  name: 'restricted-key',
  allowedIps: ['192.168.1.0/24', '10.0.0.1'],
};

function createMockStore(keys: ApiKeyConfig[]): ApiKeyStore {
  return {
    findByKey(rawKey: string) {
      if (rawKey === 'valid-key') return keys[0];
      if (rawKey === 'restricted-key') return keys[1];
      return undefined;
    },
    reload() {},
  };
}

describe('authenticateRequest', () => {
  let rateLimiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    rateLimiter = createRateLimiter(10);
  });

  it('returns error for missing key', () => {
    const store = createMockStore([testKey]);
    const result = authenticateRequest(store, rateLimiter, undefined, '1.2.3.4');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(401);
      expect(result.error.code).toBe('MISSING_API_KEY');
    }
  });

  it('returns error for invalid key', () => {
    const store = createMockStore([testKey]);
    const result = authenticateRequest(store, rateLimiter, 'wrong-key', '1.2.3.4');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(401);
      expect(result.error.code).toBe('INVALID_API_KEY');
    }
  });

  it('returns ok for valid key', () => {
    const store = createMockStore([testKey]);
    const result = authenticateRequest(store, rateLimiter, 'valid-key', '1.2.3.4');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyConfig.name).toBe('test-key');
    }
  });

  it('rejects IP not in allowlist', () => {
    const store = createMockStore([testKey, testKeyWithIps]);
    const result = authenticateRequest(store, rateLimiter, 'restricted-key', '8.8.8.8');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(403);
      expect(result.error.code).toBe('IP_NOT_ALLOWED');
    }
  });

  it('allows IP in CIDR range', () => {
    const store = createMockStore([testKey, testKeyWithIps]);
    const result = authenticateRequest(store, rateLimiter, 'restricted-key', '192.168.1.50');
    expect(result.ok).toBe(true);
  });

  it('allows exact IP match', () => {
    const store = createMockStore([testKey, testKeyWithIps]);
    const result = authenticateRequest(store, rateLimiter, 'restricted-key', '10.0.0.1');
    expect(result.ok).toBe(true);
  });

  it('enforces rate limits', () => {
    const store = createMockStore([testKey]);
    const limiter = createRateLimiter(3);

    for (let i = 0; i < 3; i++) {
      const result = authenticateRequest(store, limiter, 'valid-key', '1.2.3.4');
      expect(result.ok).toBe(true);
    }

    const result = authenticateRequest(store, limiter, 'valid-key', '1.2.3.4');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(429);
      expect(result.error.code).toBe('RATE_LIMITED');
    }
  });
});

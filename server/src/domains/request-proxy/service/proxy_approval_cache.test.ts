import { describe, it, expect } from 'vitest';
import { createProxyApprovalCache } from './proxy_approval_cache.js';

describe('createProxyApprovalCache', () => {
  it('returns false for an unknown key', () => {
    const cache = createProxyApprovalCache();
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(false);
  });

  it('returns true for a freshly stored key', () => {
    const cache = createProxyApprovalCache();
    cache.set({ keyId: 'k1', port: 6060 }, 60);
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(true);
  });

  it('isolates entries per (keyId, port)', () => {
    const cache = createProxyApprovalCache();
    cache.set({ keyId: 'k1', port: 6060 }, 60);

    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(true);
    expect(cache.has({ keyId: 'k2', port: 6060 })).toBe(false);
    expect(cache.has({ keyId: 'k1', port: 7070 })).toBe(false);
  });

  it('expires entries after the TTL elapses', () => {
    let nowMs = 1_000_000;
    const cache = createProxyApprovalCache(() => nowMs);
    cache.set({ keyId: 'k1', port: 6060 }, 60);

    nowMs += 59 * 1000;
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(true);

    nowMs += 2 * 1000; // total 61s elapsed
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(false);
  });

  it('refreshes the expiry when the same key is set again', () => {
    let nowMs = 1_000_000;
    const cache = createProxyApprovalCache(() => nowMs);
    cache.set({ keyId: 'k1', port: 6060 }, 30);

    nowMs += 20 * 1000;
    cache.set({ keyId: 'k1', port: 6060 }, 30); // refresh
    nowMs += 20 * 1000; // original would have expired; refreshed is still valid
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(true);
  });

  it('treats a zero or negative TTL as "do not cache"', () => {
    const cache = createProxyApprovalCache();
    cache.set({ keyId: 'k1', port: 6060 }, 0);
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(false);

    cache.set({ keyId: 'k1', port: 6060 }, -5);
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(false);
  });

  it('zero/negative TTL also evicts a previously cached entry', () => {
    const cache = createProxyApprovalCache();
    cache.set({ keyId: 'k1', port: 6060 }, 60);
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(true);

    cache.set({ keyId: 'k1', port: 6060 }, 0);
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(false);
  });

  it('clear() drops all entries', () => {
    const cache = createProxyApprovalCache();
    cache.set({ keyId: 'k1', port: 6060 }, 60);
    cache.set({ keyId: 'k2', port: 7070 }, 60);

    cache.clear();
    expect(cache.has({ keyId: 'k1', port: 6060 })).toBe(false);
    expect(cache.has({ keyId: 'k2', port: 7070 })).toBe(false);
  });
});

/**
 * In-memory TTL cache for "approved" proxy decisions, keyed by the tuple
 * `(api-key-id, port)`. A cache hit means the token-holder has an
 * unexpired Telegram approval for this specific proxy listener, so the
 * next request is forwarded without asking the approver again.
 *
 * Why in-memory (and not SQLite, like command approvals): proxy traffic is
 * expected to be high-volume and the approval is scoped to a running agent
 * session. Survival across restarts is a non-goal for v1 — an operator
 * restart should re-prompt, which is the conservative default. Persisting
 * proxy approvals can be added later without changing the cache API.
 */

export interface ProxyApprovalCacheKey {
  keyId: string;
  port: number;
}

export interface ProxyApprovalCache {
  /** Returns `true` when an unexpired approval exists for the key. */
  has(key: ProxyApprovalCacheKey): boolean;
  /** Store an approval, valid for `ttlSeconds` from now. */
  set(key: ProxyApprovalCacheKey, ttlSeconds: number): void;
  /** Clear all entries (used by tests and on stop()). */
  clear(): void;
}

/**
 * Construct a cache. `now` is injectable so tests can advance time
 * without using real timers.
 */
export function createProxyApprovalCache(now: () => number = Date.now): ProxyApprovalCache {
  const entries = new Map<string, number>();

  function cacheKey(key: ProxyApprovalCacheKey): string {
    return `${key.keyId}::${key.port}`;
  }

  return {
    has(key: ProxyApprovalCacheKey): boolean {
      const expiresAt = entries.get(cacheKey(key));
      if (expiresAt === undefined) return false;
      if (expiresAt <= now()) {
        entries.delete(cacheKey(key));
        return false;
      }
      return true;
    },

    set(key: ProxyApprovalCacheKey, ttlSeconds: number): void {
      if (ttlSeconds <= 0) {
        // A zero/negative TTL means "do not cache". Dropping the write is
        // simpler than surfacing an error — callers disable caching by
        // setting the config value to 0.
        entries.delete(cacheKey(key));
        return;
      }
      entries.set(cacheKey(key), now() + ttlSeconds * 1000);
    },

    clear(): void {
      entries.clear();
    },
  };
}

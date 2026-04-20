import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { ApiKeyConfig, ApiKeysConfig } from '../types/command_types.js';
import { loadJsonConfig } from '../../../lib/json_config_loader.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('api-key-store');

function isValidKeyEntry(key: unknown): boolean {
  if (typeof key !== 'object' || key === null) return false;
  const k = key as Record<string, unknown>;
  if (typeof k.id !== 'string') return false;
  if (typeof k.name !== 'string') return false;
  if (typeof k.keyHash !== 'string') return false;
  if (typeof k.salt !== 'string') return false;
  if (typeof k.createdAt !== 'string') return false;
  if (typeof k.active !== 'boolean') return false;
  return true;
}

function isApiKeysConfig(data: unknown): data is ApiKeysConfig {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.keys)) return false;
  return d.keys.every(isValidKeyEntry);
}

/**
 * Derive a 64-byte scrypt hash of `key` with `salt`, hex-encoded.
 *
 * Defends against: offline brute-force of a leaked `keyHash` (scrypt is memory-hard).
 * Does NOT defend against: leaking both `keyHash` AND `salt` together, online
 * guessing (that is the job of rate-limiting at the HTTP boundary), or disclosure
 * of the raw `key` — once the key is out, the hash is moot.
 */
export function hashApiKey(key: string, salt: string): string {
  return scryptSync(key, salt, 64).toString('hex');
}

/**
 * Generate a fresh API key + per-key salt + scrypt hash.
 *
 * The raw `key` exists only in memory at generation time and is never persisted;
 * only `salt` and `keyHash` are stored. Callers are responsible for delivering the
 * raw key to the operator over a secure channel (the CLI writes it once to stdout).
 */
export function generateApiKey(): { key: string; salt: string; keyHash: string } {
  const key = 'luc_' + randomBytes(24).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const keyHash = hashApiKey(key, salt);
  return { key, salt, keyHash };
}

/**
 * Generate a fresh admin bearer secret + salt + scrypt hash.
 *
 * Same shape as {@link generateApiKey} but with an `luc_admin_` prefix. The admin
 * secret gates the `/admin/*` surface (approval UI, SSE stream); it is NOT a valid
 * API-key for `/api/v1/execute`. Do not interchange the two.
 */
export function generateAdminSecret(): { secret: string; salt: string; secretHash: string } {
  const secret = 'luc_admin_' + randomBytes(24).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const secretHash = hashApiKey(secret, salt);
  return { secret, salt, secretHash };
}

/** Façade over the on-disk api-keys config; exposes lookup + hot reload. */
export interface ApiKeyStore {
  /** Constant-time lookup by raw key. Returns `undefined` for inactive or unknown keys. Never logs the raw key. */
  findByKey(rawKey: string): ApiKeyConfig | undefined;
  /** Re-read the backing config file. Does not lock; the caller is responsible for serialisation. */
  reload(): void;
}

/**
 * Construct an {@link ApiKeyStore} reading from `configPath`.
 *
 * `findByKey` iterates only `active: true` entries and compares with `timingSafeEqual`
 * over equal-length buffers, so lookup time does not leak which stored hash matched.
 * Does NOT defend against: a compromised config file (the salt + keyHash are enough
 * to run offline scrypt cracking) or a process-memory read during `hashApiKey`.
 */
export function createApiKeyStore(configPath: string): ApiKeyStore {
  let config: ApiKeysConfig;

  function load() {
    config = loadJsonConfig(configPath, isApiKeysConfig);
    log.info({ keyCount: config.keys.length }, 'API keys loaded');
  }

  load();

  return {
    findByKey(rawKey: string): ApiKeyConfig | undefined {
      for (const keyConfig of config.keys) {
        if (!keyConfig.active) continue;
        const hash = hashApiKey(rawKey, keyConfig.salt);
        if (hash.length === keyConfig.keyHash.length && timingSafeEqual(Buffer.from(hash), Buffer.from(keyConfig.keyHash))) {
          return keyConfig;
        }
      }
      return undefined;
    },

    reload() {
      load();
    },
  };
}

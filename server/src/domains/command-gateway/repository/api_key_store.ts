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

export function hashApiKey(key: string, salt: string): string {
  return scryptSync(key, salt, 64).toString('hex');
}

export function generateApiKey(): { key: string; salt: string; keyHash: string } {
  const key = 'luc_' + randomBytes(24).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const keyHash = hashApiKey(key, salt);
  return { key, salt, keyHash };
}

export interface ApiKeyStore {
  findByKey(rawKey: string): ApiKeyConfig | undefined;
  reload(): void;
}

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

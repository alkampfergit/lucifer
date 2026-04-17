import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProxyConfig, ProxyMapping } from '../types/proxy_types.js';
import { loadJsonConfig } from '../../../lib/json_config_loader.js';

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isValidBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidHeaders(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

function isProxyMapping(value: unknown): value is ProxyMapping {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (!isValidPort(m.port)) return false;
  if (!isValidBaseUrl(m.baseUrl)) return false;
  if (m.headers !== undefined && !isValidHeaders(m.headers)) return false;
  return true;
}

function isProxyConfig(value: unknown): value is ProxyConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.proxies)) return false;
  return v.proxies.every(isProxyMapping);
}

/**
 * Check that no two proxy mappings share a port, and that none collides with
 * the main gateway port. Throws a descriptive error on the first collision.
 */
export function validateProxyPorts(proxies: ProxyMapping[], gatewayPort: number): void {
  const seen = new Map<number, number>();
  for (const [index, proxy] of proxies.entries()) {
    if (proxy.port === gatewayPort) {
      throw new Error(
        `Proxy port ${proxy.port} (proxies[${index}]) collides with the main gateway port (${gatewayPort}).`,
      );
    }
    const prior = seen.get(proxy.port);
    if (prior !== undefined) {
      throw new Error(
        `Duplicate proxy port ${proxy.port} (proxies[${prior}] and proxies[${index}]).`,
      );
    }
    seen.set(proxy.port, index);
  }
}

/**
 * Load and validate the proxy config file. Returns `undefined` when the file
 * does not exist — the proxy feature is then disabled. Throws when the file
 * exists but is malformed.
 */
export function loadProxyConfig(configPath: string | undefined): ProxyConfig | undefined {
  if (!configPath) return undefined;
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) return undefined;
  return loadJsonConfig(resolved, isProxyConfig);
}

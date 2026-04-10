import type { ApiKeyStore } from '../types/store_interfaces.js';
import type { ApiKeyConfig, ErrorResponse } from '../types/command_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('auth');

interface RateLimitState {
  counts: Map<string, { count: number; windowStart: number }>;
  maxPerMinute: number;
}

export function createRateLimiter(maxPerMinute: number): RateLimitState {
  return { counts: new Map(), maxPerMinute };
}

export function checkRateLimit(state: RateLimitState, keyName: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = state.counts.get(keyName);

  if (!entry || now - entry.windowStart > windowMs) {
    state.counts.set(keyName, { count: 1, windowStart: now });
    return true;
  }

  entry.count++;
  return entry.count <= state.maxPerMinute;
}

export type AuthResult = {
  ok: true;
  keyConfig: ApiKeyConfig;
} | {
  ok: false;
  error: ErrorResponse;
  statusCode: number;
};

export function authenticateRequest(
  apiKeyStore: ApiKeyStore,
  rateLimiter: RateLimitState,
  rawKey: string | undefined,
  ip: string,
): AuthResult {
  if (!rawKey) {
    log.warn({ ip }, 'Missing API key');
    return {
      ok: false,
      statusCode: 401,
      error: { code: 'MISSING_API_KEY', message: 'x-api-key header is required', retryable: false },
    };
  }

  const keyConfig = apiKeyStore.findByKey(rawKey);
  if (!keyConfig) {
    log.warn({ ip }, 'Invalid API key');
    return {
      ok: false,
      statusCode: 401,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key', retryable: false },
    };
  }

  if (keyConfig.allowedIps && keyConfig.allowedIps.length > 0) {
    const allowed = keyConfig.allowedIps.some(allowedIp => {
      if (allowedIp.includes('/')) {
        return ipInCidr(ip, allowedIp);
      }
      return ip === allowedIp;
    });
    if (!allowed) {
      log.warn({ ip, keyName: keyConfig.name }, 'IP not in allowlist');
      return {
        ok: false,
        statusCode: 403,
        error: { code: 'IP_NOT_ALLOWED', message: 'IP address not in allowlist', retryable: false },
      };
    }
  }

  if (!checkRateLimit(rateLimiter, keyConfig.name)) {
    log.warn({ keyName: keyConfig.name, ip }, 'Rate limit exceeded');
    return {
      ok: false,
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Try again later.', retryable: true },
    };
  }

  return { ok: true, keyConfig };
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [network, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - Number(bits)) - 1);
  const ipNum = ipToInt(ip);
  const netNum = ipToInt(network);
  return (ipNum & mask) === (netNum & mask);
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

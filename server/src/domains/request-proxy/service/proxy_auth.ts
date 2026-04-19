import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  ProxyApprovalContext,
  ProxyApprovalRequester,
  ProxyAuditEvent,
  ProxyAuditEventType,
  ProxyAuditSink,
  ProxyMapping,
  ProxyTokenValidator,
} from '../types/proxy_types.js';
import { DEFAULT_PROXY_APPROVAL_TTL_SECONDS } from '../types/proxy_types.js';
import type { ProxyApprovalCache } from './proxy_approval_cache.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('proxy-auth');

export interface ProxyAuthDeps {
  mapping: ProxyMapping;
  validator?: ProxyTokenValidator;
  approvalRequester?: ProxyApprovalRequester;
  cache?: ProxyApprovalCache;
  audit?: ProxyAuditSink;
  now?: () => number;
  generateRequestId?: () => string;
}

export type ProxyAuthDecision =
  | { kind: 'pass'; requestId: string; keyId?: string; keyName?: string }
  | { kind: 'reject'; requestId: string; status: number; code: string; message: string };

/**
 * Authenticate and (optionally) request approval for a single proxy request.
 *
 * Pure logic — takes the incoming request and the per-mapping dependencies,
 * returns a decision. The proxy server is responsible for writing the 401/403
 * response and for deleting the caller's auth header from the forwarded
 * request when the decision is `pass`.
 */
export async function authorizeProxyRequest(
  req: http.IncomingMessage,
  deps: ProxyAuthDeps,
): Promise<ProxyAuthDecision> {
  const { mapping, validator, approvalRequester, cache, audit, generateRequestId } = deps;
  const requestId = generateRequestId ? generateRequestId() : randomUUID();
  const authMode = mapping.authMode ?? 'none';

  if (authMode === 'none') {
    return { kind: 'pass', requestId };
  }

  if (mapping.apiKeyHeader === undefined) {
    // Config loader should reject this, but fail closed if we ever see it.
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId, mapping, req,
      reason: 'apiKeyHeader not configured',
    });
    return {
      kind: 'reject', requestId,
      status: 500, code: 'misconfigured',
      message: 'Proxy mapping is misconfigured (apiKeyHeader missing).',
    };
  }

  if (!validator) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId, mapping, req,
      reason: 'no validator wired',
    });
    return {
      kind: 'reject', requestId,
      status: 500, code: 'misconfigured',
      message: 'Proxy auth is configured but no token validator is available.',
    };
  }

  const rawToken = extractToken(req, mapping.apiKeyHeader, mapping.apiKeyPrefix);
  if (rawToken === undefined) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId, mapping, req,
      reason: 'missing or malformed header',
    });
    return {
      kind: 'reject', requestId,
      status: 401, code: 'unauthorized',
      message: 'Missing or malformed authentication header.',
    };
  }

  const identity = validator.validate(rawToken);
  if (!identity) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId, mapping, req,
      reason: 'invalid token',
    });
    return {
      kind: 'reject', requestId,
      status: 401, code: 'unauthorized',
      message: 'Invalid authentication token.',
    };
  }

  if (authMode === 'api-key') {
    recordAudit(audit, {
      type: 'proxy_auth_ok', requestId, mapping, req, identity,
    });
    return { kind: 'pass', requestId, keyId: identity.keyId, keyName: identity.keyName };
  }

  // authMode === 'api-key-telegram'
  if (!approvalRequester) {
    recordAudit(audit, {
      type: 'proxy_approval_error', requestId, mapping, req, identity,
      reason: 'no approval requester wired',
    });
    return {
      kind: 'reject', requestId,
      status: 500, code: 'misconfigured',
      message: 'Telegram approval is configured but no approval channel is available.',
    };
  }

  const cacheKey = { keyId: identity.keyId, port: mapping.port };
  if (cache?.has(cacheKey)) {
    recordAudit(audit, {
      type: 'proxy_approval_approved', requestId, mapping, req, identity, source: 'cache',
    });
    return { kind: 'pass', requestId, keyId: identity.keyId, keyName: identity.keyName };
  }

  const approvalCtx: ProxyApprovalContext = {
    port: mapping.port,
    baseUrl: mapping.baseUrl,
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    keyId: identity.keyId,
    keyName: identity.keyName,
    ip: callerIp(req),
    requestId,
  };

  recordAudit(audit, { type: 'proxy_approval_requested', requestId, mapping, req, identity });

  let outcome;
  try {
    outcome = await approvalRequester.request(approvalCtx);
  } catch (err) {
    log.error({ err, requestId, port: mapping.port }, 'Approval requester threw');
    recordAudit(audit, {
      type: 'proxy_approval_error', requestId, mapping, req, identity,
      reason: err instanceof Error ? err.message : 'approval error',
    });
    return {
      kind: 'reject', requestId,
      status: 503, code: 'approval_error',
      message: 'Approval channel failed.',
    };
  }

  if (outcome === 'approved') {
    const ttl = mapping.telegramApprovalTtlSeconds ?? DEFAULT_PROXY_APPROVAL_TTL_SECONDS;
    cache?.set(cacheKey, ttl);
    recordAudit(audit, {
      type: 'proxy_approval_approved', requestId, mapping, req, identity, source: 'telegram',
    });
    return { kind: 'pass', requestId, keyId: identity.keyId, keyName: identity.keyName };
  }

  if (outcome === 'timeout') {
    recordAudit(audit, { type: 'proxy_approval_timeout', requestId, mapping, req, identity });
    return {
      kind: 'reject', requestId,
      status: 408, code: 'approval_timeout',
      message: 'Approval timed out.',
    };
  }

  if (outcome === 'error') {
    recordAudit(audit, {
      type: 'proxy_approval_error', requestId, mapping, req, identity,
      reason: 'approval channel error',
    });
    return {
      kind: 'reject', requestId,
      status: 503, code: 'approval_error',
      message: 'Approval channel failed.',
    };
  }

  // outcome === 'denied'
  recordAudit(audit, { type: 'proxy_approval_denied', requestId, mapping, req, identity });
  return {
    kind: 'reject', requestId,
    status: 403, code: 'forbidden',
    message: 'Approval denied.',
  };
}

/**
 * Extract the token value from the configured header (case-insensitive).
 * Returns `undefined` when missing, empty, or when a required prefix is
 * not present.
 */
function extractToken(
  req: http.IncomingMessage,
  headerName: string,
  prefix: string | undefined,
): string | undefined {
  const lower = headerName.toLowerCase();
  const raw = req.headers[lower];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) return undefined;

  if (prefix !== undefined && prefix.length > 0) {
    if (!value.startsWith(prefix)) return undefined;
    const stripped = value.slice(prefix.length);
    return stripped.length > 0 ? stripped : undefined;
  }
  return value;
}

/**
 * Best-effort remote address extraction. The proxy listeners bind to loopback
 * by default, so in production this is primarily used for audit context
 * rather than authorization.
 */
function callerIp(req: http.IncomingMessage): string {
  return req.socket?.remoteAddress ?? 'unknown';
}

interface AuditArgs {
  type: ProxyAuditEventType;
  requestId: string;
  mapping: ProxyMapping;
  req: http.IncomingMessage;
  identity?: { keyId: string; keyName: string };
  reason?: string;
  source?: 'telegram' | 'cache';
}

function recordAudit(sink: ProxyAuditSink | undefined, args: AuditArgs): void {
  if (!sink) return;
  const event: ProxyAuditEvent = {
    type: args.type,
    ts: new Date().toISOString(),
    requestId: args.requestId,
    port: args.mapping.port,
    method: args.req.method ?? 'GET',
    path: args.req.url ?? '/',
    keyId: args.identity?.keyId,
    keyName: args.identity?.keyName,
    ip: callerIp(args.req),
    reason: args.reason,
    source: args.source,
  };
  try {
    sink.record(event);
  } catch (err) {
    log.warn({ err, requestId: args.requestId }, 'Proxy audit sink threw; continuing');
  }
}

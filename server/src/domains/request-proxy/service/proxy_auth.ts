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

type Identity = { keyId: string; keyName: string };

// Shared primitives every step needs for logging/audit. Derived once from
// the incoming request so downstream code never re-reads the header-
// configuration fields on `mapping` (see note in `authorizeProxyRequest`).
interface StepCtx {
  requestId: string;
  port: number;
  method: string;
  path: string;
  ip: string;
}

// A step either decides the whole flow (terminal) or yields a typed value
// for the next link in the chain. Keeping this discriminated union small
// and local is the whole point of the refactor — the chain is linear and
// each step is individually testable by shape.
type StepResult<T> =
  | { kind: 'decided'; decision: ProxyAuthDecision }
  | { kind: 'continue'; value: T };

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

  // Extract non-sensitive primitives once. Downstream logging/audit reads
  // these locals, never the full mapping object — this keeps the taint-flow
  // analyzer from painting `port`/`method`/`path` as derived from the
  // header-configuration fields (`apiKeyHeader`, `apiKeyPrefix`), which are
  // only header *names*, not credentials.
  const ctx: StepCtx = {
    requestId,
    port: mapping.port,
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    ip: callerIp(req),
  };

  const headerCheck = stepAuthModeAndHeader(authMode, mapping, audit, ctx);
  if (headerCheck.kind === 'decided') return headerCheck.decision;

  const credentialCheck = stepExtractAndValidate(
    req, headerCheck.value.headerName, mapping.apiKeyPrefix, validator, audit, ctx,
  );
  if (credentialCheck.kind === 'decided') return credentialCheck.decision;

  const apiKeyGate = stepApiKeyShortCircuit(authMode, credentialCheck.value, audit, ctx);
  if (apiKeyGate.kind === 'decided') return apiKeyGate.decision;

  return stepApproval(apiKeyGate.value, mapping, approvalRequester, cache, audit, ctx);
}

/**
 * Step 1 — authMode + header config gate.
 *
 * - `authMode === 'none'` passes immediately (no credential required).
 * - Any auth mode requires `apiKeyHeader`; if it is missing, fail closed
 *   with a 500. The config loader should already have rejected this shape,
 *   but we double-check here because the cost of a silent pass is high.
 */
function stepAuthModeAndHeader(
  authMode: ProxyMapping['authMode'] | 'none',
  mapping: ProxyMapping,
  audit: ProxyAuditSink | undefined,
  ctx: StepCtx,
): StepResult<{ headerName: string }> {
  if (authMode === 'none') {
    return { kind: 'decided', decision: { kind: 'pass', requestId: ctx.requestId } };
  }

  const headerName = mapping.apiKeyHeader;
  if (headerName === undefined) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip,
      reason: 'apiKeyHeader not configured',
    });
    return {
      kind: 'decided',
      decision: {
        kind: 'reject', requestId: ctx.requestId,
        status: 500, code: 'misconfigured',
        message: 'Proxy mapping is misconfigured (apiKeyHeader missing).',
      },
    };
  }

  return { kind: 'continue', value: { headerName } };
}

/**
 * Step 2 — extract the credential and resolve it to an identity.
 *
 * Covers three failure modes:
 *  - no validator wired (misconfiguration → 500),
 *  - header missing/malformed (401),
 *  - token unknown to the validator (401).
 */
function stepExtractAndValidate(
  req: http.IncomingMessage,
  headerName: string,
  prefix: string | undefined,
  validator: ProxyTokenValidator | undefined,
  audit: ProxyAuditSink | undefined,
  ctx: StepCtx,
): StepResult<Identity> {
  if (!validator) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip,
      reason: 'no validator wired',
    });
    return {
      kind: 'decided',
      decision: {
        kind: 'reject', requestId: ctx.requestId,
        status: 500, code: 'misconfigured',
        message: 'Proxy auth is configured but no token validator is available.',
      },
    };
  }

  const rawToken = extractToken(req, headerName, prefix);
  if (rawToken === undefined) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip,
      reason: 'missing or malformed header',
    });
    return {
      kind: 'decided',
      decision: {
        kind: 'reject', requestId: ctx.requestId,
        status: 401, code: 'unauthorized',
        message: 'Missing or malformed authentication header.',
      },
    };
  }

  const identity = validator.validate(rawToken);
  if (!identity) {
    recordAudit(audit, {
      type: 'proxy_auth_denied', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip,
      reason: 'invalid token',
    });
    return {
      kind: 'decided',
      decision: {
        kind: 'reject', requestId: ctx.requestId,
        status: 401, code: 'unauthorized',
        message: 'Invalid authentication token.',
      },
    };
  }

  return { kind: 'continue', value: identity };
}

/**
 * Step 3 — `authMode === 'api-key'` passes as soon as the identity is known.
 * For `authMode === 'api-key-telegram'` we continue into the approval stage.
 */
function stepApiKeyShortCircuit(
  authMode: ProxyMapping['authMode'] | 'none',
  identity: Identity,
  audit: ProxyAuditSink | undefined,
  ctx: StepCtx,
): StepResult<Identity> {
  if (authMode === 'api-key') {
    recordAudit(audit, {
      type: 'proxy_auth_ok', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
    });
    return {
      kind: 'decided',
      decision: { kind: 'pass', requestId: ctx.requestId, keyId: identity.keyId, keyName: identity.keyName },
    };
  }
  return { kind: 'continue', value: identity };
}

/**
 * Step 4 — Telegram-based human approval.
 *
 * Terminal for every call: either returns a decision or throws never —
 * every approval outcome (approved / timeout / error / denied) and every
 * misconfiguration (no requester) maps to a concrete `ProxyAuthDecision`.
 * Cache hits bypass the approval channel entirely.
 */
async function stepApproval(
  identity: Identity,
  mapping: ProxyMapping,
  approvalRequester: ProxyApprovalRequester | undefined,
  cache: ProxyApprovalCache | undefined,
  audit: ProxyAuditSink | undefined,
  ctx: StepCtx,
): Promise<ProxyAuthDecision> {
  if (!approvalRequester) {
    recordAudit(audit, {
      type: 'proxy_approval_error', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
      reason: 'no approval requester wired',
    });
    return {
      kind: 'reject', requestId: ctx.requestId,
      status: 500, code: 'misconfigured',
      message: 'Telegram approval is configured but no approval channel is available.',
    };
  }

  const cacheKey = { keyId: identity.keyId, port: ctx.port };
  if (cache?.has(cacheKey)) {
    recordAudit(audit, {
      type: 'proxy_approval_approved', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity, source: 'cache',
    });
    return { kind: 'pass', requestId: ctx.requestId, keyId: identity.keyId, keyName: identity.keyName };
  }

  const approvalCtx: ProxyApprovalContext = {
    port: ctx.port,
    baseUrl: mapping.baseUrl,
    method: ctx.method,
    path: ctx.path,
    keyId: identity.keyId,
    keyName: identity.keyName,
    ip: ctx.ip,
    requestId: ctx.requestId,
  };

  recordAudit(audit, {
    type: 'proxy_approval_requested', requestId: ctx.requestId,
    port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
  });

  let outcome;
  try {
    outcome = await approvalRequester.request(approvalCtx);
  } catch (err) {
    log.error({ err, requestId: ctx.requestId, port: ctx.port }, 'Approval requester threw');
    recordAudit(audit, {
      type: 'proxy_approval_error', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
      reason: err instanceof Error ? err.message : 'approval error',
    });
    return {
      kind: 'reject', requestId: ctx.requestId,
      status: 503, code: 'approval_error',
      message: 'Approval channel failed.',
    };
  }

  if (outcome === 'approved') {
    const ttl = mapping.telegramApprovalTtlSeconds ?? DEFAULT_PROXY_APPROVAL_TTL_SECONDS;
    cache?.set(cacheKey, ttl);
    recordAudit(audit, {
      type: 'proxy_approval_approved', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity, source: 'telegram',
    });
    return { kind: 'pass', requestId: ctx.requestId, keyId: identity.keyId, keyName: identity.keyName };
  }

  if (outcome === 'timeout') {
    recordAudit(audit, {
      type: 'proxy_approval_timeout', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
    });
    return {
      kind: 'reject', requestId: ctx.requestId,
      status: 408, code: 'approval_timeout',
      message: 'Approval timed out.',
    };
  }

  if (outcome === 'error') {
    recordAudit(audit, {
      type: 'proxy_approval_error', requestId: ctx.requestId,
      port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
      reason: 'approval channel error',
    });
    return {
      kind: 'reject', requestId: ctx.requestId,
      status: 503, code: 'approval_error',
      message: 'Approval channel failed.',
    };
  }

  // outcome === 'denied'
  recordAudit(audit, {
    type: 'proxy_approval_denied', requestId: ctx.requestId,
    port: ctx.port, method: ctx.method, path: ctx.path, ip: ctx.ip, identity,
  });
  return {
    kind: 'reject', requestId: ctx.requestId,
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
  port: number;
  method: string;
  path: string;
  ip: string;
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
    port: args.port,
    method: args.method,
    path: args.path,
    keyId: args.identity?.keyId,
    keyName: args.identity?.keyName,
    ip: args.ip,
    reason: args.reason,
    source: args.source,
  };
  try {
    sink.record(event);
  } catch (err) {
    log.warn({ err, requestId: args.requestId }, 'Proxy audit sink threw; continuing');
  }
}

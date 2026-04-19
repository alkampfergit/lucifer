/**
 * A single transparent-proxy mapping. One mapping = one listener on its own
 * port that forwards every incoming request to `baseUrl`, preserving the
 * request path, method, query string and body, and injecting the configured
 * `headers` on the outgoing request.
 *
 * `host` controls the bind address. Defaults to `127.0.0.1` so a
 * credentialed proxy is not inadvertently exposed to the network — set it
 * explicitly (e.g. `"0.0.0.0"`) to opt into broader binding.
 *
 * Authentication:
 * - `authMode` controls per-request auth. Default `none` preserves legacy
 *   behavior (open proxy).
 * - `api-key` extracts a lucifer-gate token from the request header named
 *   `apiKeyHeader` (case-insensitive), optionally stripping `apiKeyPrefix`
 *   first (e.g. `Bearer `), and validates it against `api-keys.json`. On
 *   success the caller's header is stripped from the outgoing request so
 *   the lucifer-gate token never reaches the upstream — the upstream sees
 *   only the credentials injected via `headers`.
 * - `api-key-telegram` is `api-key` plus a Telegram approval gate. Approved
 *   decisions are cached per `(api-key-id, port)` for
 *   `telegramApprovalTtlSeconds` (default 3600) so a single agent session
 *   does not spam the chat.
 */
export type ProxyAuthMode = 'none' | 'api-key' | 'api-key-telegram';

export const DEFAULT_PROXY_AUTH_MODE: ProxyAuthMode = 'none';
export const DEFAULT_PROXY_APPROVAL_TTL_SECONDS = 3600;

export interface ProxyMapping {
  port: number;
  baseUrl: string;
  headers?: Record<string, string>;
  host?: string;
  authMode?: ProxyAuthMode;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  telegramApprovalTtlSeconds?: number;
}

export const DEFAULT_PROXY_HOST = '127.0.0.1';

export interface ProxyConfig {
  proxies: ProxyMapping[];
}

/**
 * Narrow contract the proxy layer uses to validate lucifer-gate tokens. The
 * bridge adapter in `create_app.ts` implements this over the command-gateway
 * `apiKeyStore`, so the proxy domain never imports command-gateway code
 * directly (Dependency Rules — no cross-domain imports).
 */
export interface ProxyTokenValidator {
  validate(rawToken: string): { keyId: string; keyName: string } | undefined;
}

/**
 * Context passed to the approval requester for a single proxy request.
 */
export interface ProxyApprovalContext {
  port: number;
  baseUrl: string;
  method: string;
  path: string;
  keyId: string;
  keyName: string;
  ip: string;
  requestId: string;
}

export type ProxyApprovalOutcome = 'approved' | 'denied' | 'timeout' | 'error';

/**
 * Narrow contract the proxy layer uses to ask for human approval. Bridged in
 * `create_app.ts` over the existing command-gateway `ApprovalChannel`.
 */
export interface ProxyApprovalRequester {
  request(ctx: ProxyApprovalContext): Promise<ProxyApprovalOutcome>;
}

export type ProxyAuditEventType =
  | 'proxy_auth_ok'
  | 'proxy_auth_denied'
  | 'proxy_approval_requested'
  | 'proxy_approval_approved'
  | 'proxy_approval_denied'
  | 'proxy_approval_timeout'
  | 'proxy_approval_error';

export interface ProxyAuditEvent {
  type: ProxyAuditEventType;
  ts: string;
  requestId: string;
  port: number;
  method: string;
  path: string;
  keyId?: string;
  keyName?: string;
  ip?: string;
  reason?: string;
  source?: 'telegram' | 'cache';
}

/**
 * Narrow contract the proxy layer uses to record auth/approval events so
 * operators can see them alongside command activity via `lucifer-gate log`.
 * Bridged in `create_app.ts` over the command-gateway `auditLog` repository.
 */
export interface ProxyAuditSink {
  record(event: ProxyAuditEvent): void;
}

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { AdminSessionAssertion, ApprovalMatchType, ApprovalDecision, ErrorResponse } from '../types/command_types.js';
import type { ApprovalStore, AuditLog } from '../types/store_interfaces.js';
import type { WebApprovalChannelHandle } from '../service/web_approval_channel.js';
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_CSRF_HEADER,
  ADMIN_SESSION_COOKIE,
  type AdminSessionSealer,
} from '../service/admin_session.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('admin-routes');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Rate limiter for admin auth failures
interface AuthRateLimit {
  failures: number;
  lockedUntil: number;
}

const authRateLimits = new Map<string, AuthRateLimit>();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

// Short-lived SSE tickets
interface SSETicket {
  token: string;
  createdAt: number;
}

const sseTickets = new Map<string, SSETicket>();
const TICKET_TTL_MS = 10_000;

// Clean up expired tickets periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, ticket] of sseTickets.entries()) {
    if (now - ticket.createdAt > TICKET_TTL_MS) {
      sseTickets.delete(token);
    }
  }
}, 5_000);

function verifyAdminSecret(rawSecret: string, hash: string, salt: string): boolean {
  const computed = scryptSync(rawSecret, salt, 64).toString('hex');
  if (computed.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

/** How the caller proved they are the admin on this request. */
type AdminAuthMethod = 'bearer' | 'cookie';

interface AdminAuth {
  method: AdminAuthMethod;
  /** Present only for `method: 'cookie'`; carries the sealed CSRF token. */
  assertion?: AdminSessionAssertion;
}

/** Read one cookie out of the raw `Cookie` header. Express 5 has no built-in parser. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * True when the request reached us over TLS, directly or via a trusted proxy.
 *
 * Deliberately `req.secure` alone: Express derives it from `X-Forwarded-Proto`
 * only when the operator has configured `trust proxy` (see `trustProxy` in
 * `lucifer.json`). Reading the header directly would let any client claim TLS
 * and be handed `Secure` cookies its plain-HTTP browser can never send back —
 * an instant lockout loop. Untrusted forwarding therefore degrades to a cookie
 * without `Secure`, which still works; it never yields an undeliverable one.
 */
function isSecureRequest(req: Request): boolean {
  return req.secure;
}

/**
 * The address the per-IP auth lockout is counted against.
 *
 * `req.ip` rather than a raw `X-Forwarded-For` read: Express resolves it
 * through the configured `trust proxy` policy (see `trustProxy` in
 * `lucifer.json`), so the header is honoured only from a proxy the operator
 * named. Reading it unconditionally would let a direct client rotate the header
 * to sidestep the five-failure lockout entirely, or pin the lockout on somebody
 * else's address.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function rejectUnauthorized(ip: string, res: Response): undefined {
  const current = authRateLimits.get(ip) ?? { failures: 0, lockedUntil: 0 };
  current.failures++;
  if (current.failures >= MAX_FAILURES) {
    current.lockedUntil = Date.now() + LOCKOUT_MS;
    current.failures = 0;
    log.warn({ ip }, 'Admin auth locked out after repeated failures');
  }
  authRateLimits.set(ip, current);

  res.status(401).json({
    code: 'UNAUTHORIZED',
    message: 'Invalid or missing admin secret',
    retryable: false,
  } satisfies ErrorResponse);
  return undefined;
}

/**
 * Authenticate an admin request, by bearer secret or by sealed session cookie.
 *
 * An `Authorization` header is treated as a deliberate bearer attempt and is
 * decided on its own: a wrong secret is a failed login even if the caller also
 * holds a valid cookie. That keeps the per-IP lockout meaningful and leaves the
 * CLI/curl path behaving exactly as it did before cookies existed. The cookie is
 * consulted only when no bearer header was sent; an expired or tampered cookie
 * falls through to the same 401 + lockout path as a bad secret.
 *
 * Returns `undefined` after having already written the error response.
 */
function checkAdminAuth(
  adminSecretHash: string,
  adminSecretSalt: string,
  sealer: AdminSessionSealer | undefined,
  req: Request,
  res: Response,
): AdminAuth | undefined {
  const ip = clientIp(req);

  // Check lockout
  const limit = authRateLimits.get(ip);
  if (limit && Date.now() < limit.lockedUntil) {
    const retryAfter = Math.ceil((limit.lockedUntil - Date.now()) / 1000);
    res.status(429).json({
      code: 'RATE_LIMITED',
      message: 'Too many failed auth attempts. Try again later.',
      retryable: true,
      details: `Locked out for ${retryAfter}s`,
    } satisfies ErrorResponse & { details: string });
    return undefined;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (authHeader !== undefined) {
    if (!token || !verifyAdminSecret(token, adminSecretHash, adminSecretSalt)) {
      return rejectUnauthorized(ip, res);
    }
    authRateLimits.delete(ip);
    return { method: 'bearer' };
  }

  const assertion = sealer?.open(readCookie(req, ADMIN_SESSION_COOKIE));
  if (!assertion) {
    return rejectUnauthorized(ip, res);
  }

  authRateLimits.delete(ip);
  return { method: 'cookie', assertion };
}

/**
 * Gate a state-changing route against cross-site request forgery.
 *
 * Only cookie-authenticated callers are checked: a bearer token is never
 * attached by the browser automatically, so those requests are not forgeable
 * from another origin. Cookie callers must echo the token sealed inside their
 * own session, which a plain double-submit (token mirrored from a cookie an
 * attacker can also set) would not catch.
 *
 * A CSRF failure deliberately does NOT count toward the per-IP auth lockout —
 * it is a wiring or origin problem, not a password guess.
 */
function enforceCsrf(
  sealer: AdminSessionSealer | undefined,
  auth: AdminAuth,
  req: Request,
  res: Response,
): boolean {
  if (auth.method !== 'cookie') return true;

  const header = req.headers[ADMIN_CSRF_HEADER];
  const presented = Array.isArray(header) ? header[0] : header;

  if (!sealer || !auth.assertion || !sealer.csrfMatches(auth.assertion, presented)) {
    res.status(403).json({
      code: 'CSRF_INVALID',
      message: `Missing or invalid CSRF token. Send the ${ADMIN_CSRF_COOKIE} cookie value in the X-Lucifer-CSRF header.`,
      retryable: false,
    } satisfies ErrorResponse);
    return false;
  }
  return true;
}

interface DecideInput {
  action: string;
  matchType?: string;
  duration?: string;
}

interface ValidatedDecision {
  decision: ApprovalDecision;
  matchType: ApprovalMatchType;
  duration: string;
}

function validateDecideInput(body: DecideInput): ValidatedDecision | ErrorResponse {
  const { action, matchType, duration } = body;

  if (!action || (action !== 'approve' && action !== 'deny')) {
    return { code: 'INVALID_ACTION', message: 'action must be "approve" or "deny"', retryable: false };
  }

  const decision: ApprovalDecision = action === 'approve' ? 'approved' : 'denied';

  if (decision === 'approved') {
    if (!matchType || (matchType !== 'exact' && matchType !== 'prefix')) {
      return { code: 'INVALID_MATCH_TYPE', message: 'matchType must be "exact" or "prefix" when approving', retryable: false };
    }
    if (!duration || !['2', '8', 'permanent'].includes(duration)) {
      return { code: 'INVALID_DURATION', message: 'duration must be "2", "8", or "permanent" when approving', retryable: false };
    }
  }

  return {
    decision,
    matchType: (matchType as ApprovalMatchType) ?? 'exact',
    duration: duration ?? '0',
  };
}

function isValidationError(result: ValidatedDecision | ErrorResponse): result is ErrorResponse {
  return 'code' in result;
}

export interface ApprovalRouteDeps {
  router: Router;
  adminSecretHash: string;
  adminSecretSalt: string;
  webChannel: WebApprovalChannelHandle;
  approvalStore: ApprovalStore;
  auditLog: AuditLog;
  /**
   * Seals/opens the `lucifer_admin` session cookie. Omit to run bearer-only:
   * the `/session` routes are then not registered and cookies are ignored.
   */
  adminSession?: AdminSessionSealer;
}

/**
 * The build mirrors runtime assets into `dist`, so the page files always sit
 * next to this module -- both under `tsx` in development and in the compiled
 * tree. When the web UI is the only approval channel a missing asset means
 * nobody can approve anything, so refuse to start instead of serving a stub
 * that looks like a working server.
 */
function readPageAsset(fileName: string): string {
  const assetPath = path.join(__dirname, fileName);
  if (!fs.existsSync(assetPath)) {
    throw new Error(
      `Approval page asset missing at ${assetPath}. ` +
      `The build did not copy ${fileName} into the output tree; run "npm run build".`,
    );
  }
  return fs.readFileSync(assetPath, 'utf8');
}

export function registerApprovalRoutes(deps: ApprovalRouteDeps): void {
  const { router, adminSecretHash, adminSecretSalt, webChannel, approvalStore, auditLog, adminSession } = deps;

  // Rate limiter middleware for admin API routes
  const adminRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', retryable: true },
  });

  // The build mirrors runtime assets into `dist`, so the page always sits next
  // to this module -- both under `tsx` in development and in the compiled tree.
  // When the web UI is the only approval channel a missing page means nobody can
  // approve anything, so refuse to start instead of serving a stub that looks
  // like a working server.
  const approvalPageHtml = readPageAsset('approval_page.html');
  const approvalAlertsJs = readPageAsset('approval_page_alerts.js');

  // Serve the admin HTML page (no auth - page handles login client-side)
  router.get('/admin/approvals', (_req: Request, res: Response) => {
    res.type('html').send(approvalPageHtml);
  });

  // The page's new-request alert script, kept out of the HTML to keep both legible.
  router.get('/admin/approvals/alerts.js', (_req: Request, res: Response) => {
    res.type('application/javascript').send(approvalAlertsJs);
  });

  // Cookie-backed sessions. Registered only when a sealer is wired in, so a
  // deployment that disables the feature has no session surface at all.
  if (adminSession) {
    const cookieBase = (req: Request) => ({
      sameSite: 'strict' as const,
      // `Secure` would make the cookie undeliverable over plain HTTP, which is
      // exactly how the UI is normally reached (http://localhost:3001).
      secure: isSecureRequest(req),
      path: '/',
    });

    // Exchange the admin bearer secret for a sealed session cookie.
    router.post('/api/v1/admin/approvals/session', adminRateLimiter, (req: Request, res: Response) => {
      const auth = checkAdminAuth(adminSecretHash, adminSecretSalt, adminSession, req, res);
      if (!auth) return;

      // Minting from a cookie would turn the 30-day absolute lifetime into a
      // sliding one, one renewal at a time. Re-authentication means the secret.
      if (auth.method !== 'bearer') {
        res.status(403).json({
          code: 'BEARER_REQUIRED',
          message: 'A session can only be created with the admin secret, not with an existing session cookie',
          retryable: false,
        } satisfies ErrorResponse);
        return;
      }

      const sealed = adminSession.seal();
      const base = cookieBase(req);
      res.cookie(ADMIN_SESSION_COOKIE, sealed.cookie, { ...base, httpOnly: true, maxAge: sealed.maxAgeSeconds * 1000 });
      // Readable on purpose: the page echoes it back in X-Lucifer-CSRF.
      res.cookie(ADMIN_CSRF_COOKIE, sealed.csrf, { ...base, httpOnly: false, maxAge: sealed.maxAgeSeconds * 1000 });

      log.info({ ip: clientIp(req) }, 'Admin session cookie issued');
      res.json({ ok: true, expiresInSeconds: sealed.maxAgeSeconds });
    });

    // Sign out: drop both cookies.
    router.delete('/api/v1/admin/approvals/session', adminRateLimiter, (req: Request, res: Response) => {
      const auth = checkAdminAuth(adminSecretHash, adminSecretSalt, adminSession, req, res);
      if (!auth) return;
      if (!enforceCsrf(adminSession, auth, req, res)) return;

      const base = cookieBase(req);
      res.clearCookie(ADMIN_SESSION_COOKIE, { ...base, httpOnly: true });
      res.clearCookie(ADMIN_CSRF_COOKIE, { ...base, httpOnly: false });
      res.json({ ok: true });
    });
  }

  // List pending requests
  router.get('/api/v1/admin/approvals/pending', adminRateLimiter, (req: Request, res: Response) => {
    if (!checkAdminAuth(adminSecretHash, adminSecretSalt, adminSession, req, res)) return;
    res.json({ pending: webChannel.getPendingRequests() });
  });

  // List durable command-call history independently of transient pending requests.
  router.get('/api/v1/admin/approvals/history', adminRateLimiter, (req: Request, res: Response) => {
    if (!checkAdminAuth(adminSecretHash, adminSecretSalt, adminSession, req, res)) return;
    res.json({ history: auditLog.queryRecentRequests(20) });
  });

  // Exchange bearer token for one-time SSE ticket
  router.post('/api/v1/admin/approvals/stream-ticket', adminRateLimiter, (req: Request, res: Response) => {
    const auth = checkAdminAuth(adminSecretHash, adminSecretSalt, adminSession, req, res);
    if (!auth) return;
    if (!enforceCsrf(adminSession, auth, req, res)) return;
    const token = randomUUID();
    sseTickets.set(token, { token, createdAt: Date.now() });
    res.json({ ticket: token, ttlSeconds: TICKET_TTL_MS / 1000 });
  });

  // SSE stream for real-time updates
  router.get('/api/v1/admin/approvals/stream', (req: Request, res: Response) => {
    const ticket = req.query.ticket as string | undefined;
    if (!ticket) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing SSE ticket', retryable: false } satisfies ErrorResponse);
      return;
    }

    const storedTicket = sseTickets.get(ticket);
    if (!storedTicket || Date.now() - storedTicket.createdAt > TICKET_TTL_MS) {
      sseTickets.delete(ticket);
      res.status(401).json({ code: 'TICKET_EXPIRED', message: 'SSE ticket expired or invalid', retryable: true } satisfies ErrorResponse);
      return;
    }

    // Consume ticket (one-time use)
    sseTickets.delete(ticket);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial pending list
    const pending = webChannel.getPendingRequests();
    res.write(`event: init\ndata: ${JSON.stringify({ pending })}\n\n`);

    webChannel.addSSEClient(res);

    // Heartbeat to detect broken connections
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      webChannel.removeSSEClient(res);
    });
  });

  // Approve or deny a request
  router.post('/api/v1/admin/approvals/:requestId/decide', adminRateLimiter, (req: Request, res: Response) => {
    const auth = checkAdminAuth(adminSecretHash, adminSecretSalt, adminSession, req, res);
    if (!auth) return;
    if (!enforceCsrf(adminSession, auth, req, res)) return;

    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
    const validated = validateDecideInput(req.body as DecideInput);
    if (isValidationError(validated)) {
      res.status(400).json(validated);
      return;
    }

    const { decision, matchType: resolvedMatchType, duration: resolvedDuration } = validated;

    // Try to resolve via web channel
    const pending = webChannel.getPendingRequests().find(p => p.requestId === requestId);
    if (!pending) {
      res.status(409).json({
        code: 'ALREADY_DECIDED',
        message: 'Request already decided or expired',
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    if (decision === 'approved') {
      const approvalCommand = resolvedMatchType === 'prefix'
        ? pending.command.split(/\s+/).slice(0, 2).join(' ')
        : pending.command;

      approvalStore.addApproval(
        approvalCommand,
        resolvedMatchType,
        resolvedDuration,
        'web:admin',
      );
    }

    auditLog.append({
      ts: new Date().toISOString(),
      type: decision === 'approved' ? 'approved' : 'denied',
      requestId,
      command: pending.command,
      duration: decision === 'approved' ? resolvedDuration : undefined,
      approvedBy: 'web:admin',
    });

    const resolved = webChannel.resolveRequest(requestId, decision, resolvedMatchType, resolvedDuration);
    if (!resolved) {
      res.status(409).json({
        code: 'ALREADY_DECIDED',
        message: 'Request was decided by another channel',
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    log.info({ requestId, decision, matchType: resolvedMatchType, duration: resolvedDuration }, 'Admin decision via web UI');
    res.json({ ok: true, requestId, decision });
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { ApprovalMatchType, ApprovalDecision, ErrorResponse } from '../types/command_types.js';
import type { ApprovalStore, AuditLog } from '../types/store_interfaces.js';
import type { WebApprovalChannelHandle } from '../service/web_approval_channel.js';
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

function checkAdminAuth(adminSecret: string, req: Request, res: Response): boolean {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';

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
    return false;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token || token !== adminSecret) {
    // Track failure
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
    return false;
  }

  // Reset failures on success
  authRateLimits.delete(ip);
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
  adminSecret: string;
  webChannel: WebApprovalChannelHandle;
  approvalStore: ApprovalStore;
  auditLog: AuditLog;
}

export function registerApprovalRoutes(deps: ApprovalRouteDeps): void {
  const { router, adminSecret, webChannel, approvalStore, auditLog } = deps;

  // Rate limiter middleware for admin API routes
  const adminRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', retryable: true },
  });

  // Load HTML page at startup -- try compiled location first, then source
  const possiblePaths = [
    path.join(__dirname, 'approval_page.html'),
    path.resolve(__dirname, '../../../../server/src/domains/command-gateway/api/approval_page.html'),
    path.resolve(process.cwd(), 'server/src/domains/command-gateway/api/approval_page.html'),
  ];
  const htmlPath = possiblePaths.find(p => fs.existsSync(p));
  const approvalPageHtml = htmlPath
    ? fs.readFileSync(htmlPath, 'utf8')
    : '<html><body><h1>Approval page not found</h1></body></html>';

  // Serve the admin HTML page (no auth - page handles login client-side)
  router.get('/admin/approvals', (_req: Request, res: Response) => {
    res.type('html').send(approvalPageHtml);
  });

  // List pending requests
  router.get('/api/v1/admin/approvals/pending', adminRateLimiter, (req: Request, res: Response) => {
    if (!checkAdminAuth(adminSecret, req, res)) return;
    res.json({ pending: webChannel.getPendingRequests() });
  });

  // Exchange bearer token for one-time SSE ticket
  router.post('/api/v1/admin/approvals/stream-ticket', adminRateLimiter, (req: Request, res: Response) => {
    if (!checkAdminAuth(adminSecret, req, res)) return;
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
    if (!checkAdminAuth(adminSecret, req, res)) return;

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

import { randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type {
  ApprovalChannel, ErrorResponse, LuciferConfig,
} from '../types/command_types.js';
import type { ApiKeyStore, CommandRulesStore, ApprovalStore, PendingRequestStore, AuditLog } from '../types/store_interfaces.js';
import { authenticateRequest, createRateLimiter } from '../service/authenticate_request.js';
import { executeAndAudit } from '../service/execute_and_audit.js';
import { handleManualApproval } from '../service/handle_manual_approval.js';
import { resolveExecutionPlan } from '../service/resolve_execution_plan.js';

interface ValidationError {
  statusCode: number;
  body: ErrorResponse;
}

function validateExecuteInput(command: unknown, cwd: unknown): ValidationError | null {
  if (!command || typeof command !== 'string') {
    return {
      statusCode: 400,
      body: { code: 'MISSING_COMMAND', message: 'Request body must include a "command" string', retryable: false },
    };
  }
  if (command.length > 4096) {
    return {
      statusCode: 400,
      body: { code: 'COMMAND_TOO_LONG', message: 'Command exceeds 4096 character limit', retryable: false },
    };
  }
  if (cwd !== undefined) {
    if (typeof cwd !== 'string' || cwd.includes('..') || !cwd.startsWith('/')) {
      return {
        statusCode: 400,
        body: { code: 'INVALID_CWD', message: 'cwd must be an absolute path without ".." components', retryable: false },
      };
    }
  }
  return null;
}

export interface ExecuteRouteDeps {
  router: Router;
  config: LuciferConfig;
  apiKeyStore: ApiKeyStore;
  commandRulesStore: CommandRulesStore;
  approvalStore: ApprovalStore;
  pendingStore: PendingRequestStore;
  auditLog: AuditLog;
  approvalChannel: ApprovalChannel;
}

function parseClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';
}

export function registerExecuteRoutes(deps: ExecuteRouteDeps): void {
  const { router, config, apiKeyStore, commandRulesStore, approvalStore, pendingStore, auditLog, approvalChannel } = deps;
  const perKeyLimit = config.rateLimitPerKeyPerMinute ?? config.rateLimitPerMinute;
  const perIpLimit = config.rateLimitPerIpPerMinute ?? config.rateLimitPerMinute;

  const rateLimiter = createRateLimiter(
    process.env.NODE_ENV === 'development' ? 1000 : perKeyLimit,
  );

  const ipRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: process.env.NODE_ENV === 'development' ? 10_000 : perIpLimit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: parseClientIp,
    message: { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Try again later.', retryable: true },
  });

  router.post('/api/v1/execute', ipRateLimiter, async (req: Request, res: Response) => {
    const rawKey = req.headers['x-api-key'] as string | undefined;
    const ip = parseClientIp(req);
    const { command: rawCommand, cwd } = req.body as { command?: string; cwd?: string };

    const validationError = validateExecuteInput(rawCommand, cwd);
    if (validationError) {
      res.status(validationError.statusCode).json(validationError.body);
      return;
    }

    // After validation, command is guaranteed to be a string
    const command = rawCommand!;

    const authResult = authenticateRequest(apiKeyStore, rateLimiter, rawKey, ip);
    if (!authResult.ok) {
      res.status(authResult.statusCode).json(authResult.error);
      return;
    }

    const requestId = randomUUID();
    const apiKeyName = authResult.keyConfig.name;

    auditLog.append({
      ts: new Date().toISOString(),
      type: 'request',
      requestId,
      command,
      apiKeyName,
      ip,
    });

    const plan = resolveExecutionPlan({
      command,
      aliases: config.aliases,
      commandRulesStore,
      approvalStore,
    });

    if (plan.kind === 'alias-args-bypass') {
      // ADR-009: reject commands that start with an alias name but are not an
      // exact alias invocation, before any rule match runs. Without this check
      // a prefix-based command rule on the alias name would shadow-bypass the
      // alias's shell-free execution guarantee.
      auditLog.append({
        ts: new Date().toISOString(),
        type: 'denied',
        requestId,
        command,
        error: `alias '${plan.alias}' does not accept arguments`,
      });
      res.status(403).json({
        code: 'ALIAS_ARGS_NOT_SUPPORTED',
        message: `Alias '${plan.alias}' does not accept arguments in this version. Send '${plan.alias}' exactly.`,
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    auditLog.append({
      ts: new Date().toISOString(),
      type: 'rule_match',
      requestId,
      command,
      ruleAction: plan.ruleAction,
    });

    const { aliasAudit } = plan;

    if (plan.kind === 'rule-deny') {
      auditLog.append({ ts: new Date().toISOString(), type: 'denied', requestId, command, ...aliasAudit });
      res.status(403).json({
        code: 'COMMAND_DENIED',
        message: 'Command is not permitted by policy',
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    if (plan.kind === 'always-approve') {
      auditLog.append({ ts: new Date().toISOString(), type: 'approved', requestId, command, duration: 'policy', ...aliasAudit });
      await executeAndAudit({ command, requestId, cwd, config, auditLog, aliasAudit, res });
      return;
    }

    if (plan.kind === 'cached-approval') {
      auditLog.append({
        ts: new Date().toISOString(),
        type: 'approval_check',
        requestId,
        command,
        duration: 'cached',
        ...aliasAudit,
      });
      await executeAndAudit({ command, requestId, cwd, config, auditLog, aliasAudit, res });
      return;
    }

    // plan.kind === 'manual-approve'
    await handleManualApproval({
      command, requestId, apiKeyName, ip, cwd, config,
      approvalChannel, pendingStore, auditLog, aliasAudit, res,
    });
  });
}

import { randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import type {
  ApprovalChannel, RequestStatus, ErrorResponse, LuciferConfig,
} from '../types/command_types.js';
import type { ApiKeyStore, CommandRulesStore, ApprovalStore, PendingRequestStore, AuditLog } from '../types/store_interfaces.js';
import { authenticateRequest, createRateLimiter } from '../service/authenticate_request.js';
import { analyzeCommandRisk } from '../service/analyze_command_risk.js';
import { executeCommand } from '../service/execute_command.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('routes');

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

export function registerExecuteRoutes(deps: ExecuteRouteDeps): void {
  const { router, config, apiKeyStore, commandRulesStore, approvalStore, pendingStore, auditLog, approvalChannel } = deps;
  const rateLimiter = createRateLimiter(
    process.env.NODE_ENV === 'development' ? 1000 : config.rateLimitPerMinute,
  );

  router.post('/api/v1/execute', async (req: Request, res: Response) => {
    const rawKey = req.headers['x-api-key'] as string | undefined;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
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

    // Match against command rules
    const ruleMatch = commandRulesStore.matchRule(command);
    auditLog.append({
      ts: new Date().toISOString(),
      type: 'rule_match',
      requestId,
      command,
      ruleAction: ruleMatch.action,
    });

    if (ruleMatch.action === 'always_deny') {
      auditLog.append({ ts: new Date().toISOString(), type: 'denied', requestId, command });
      res.status(403).json({
        code: 'COMMAND_DENIED',
        message: 'Command is not permitted by policy',
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    if (ruleMatch.action === 'always_approve') {
      auditLog.append({ ts: new Date().toISOString(), type: 'approved', requestId, command, duration: 'policy' });
      const result = await executeCommand({
        command,
        requestId,
        cwd,
        timeoutMs: config.executionTimeoutSeconds * 1000,
        maxOutputBytes: config.maxOutputBytes,
        maxConcurrent: config.maxConcurrentExecutions,
        aliases: config.aliases,
      });
      auditLog.append({
        ts: new Date().toISOString(),
        type: 'executed',
        requestId,
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        error: result.error,
      });
      res.json(result);
      return;
    }

    // manual_approve: check existing approval in SQLite
    const existingApproval = approvalStore.findApproval(command);
    if (existingApproval) {
      auditLog.append({
        ts: new Date().toISOString(),
        type: 'approval_check',
        requestId,
        command,
        duration: 'cached',
      });
      const result = await executeCommand({
        command,
        requestId,
        cwd,
        timeoutMs: config.executionTimeoutSeconds * 1000,
        maxOutputBytes: config.maxOutputBytes,
        maxConcurrent: config.maxConcurrentExecutions,
        aliases: config.aliases,
      });
      auditLog.append({
        ts: new Date().toISOString(),
        type: 'executed',
        requestId,
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        error: result.error,
      });
      res.json(result);
      return;
    }

    // Need manual approval (Telegram / web admin)
    const riskAnalysis = analyzeCommandRisk(command);
    const abortController = new AbortController();

    log.info({ requestId, command, ip }, 'Command requires manual approval, forwarding to approval channel');

    // Reject an identical command from the same API key that is still
    // awaiting an approval decision — two parallel prompts for the same
    // command would confuse the human approver. The pendingStore entry is
    // cleared as soon as a decision is reached (below), so this gate does
    // NOT apply while an approved command is executing; a concurrent caller
    // will fall through to the normal `findApproval` cached-approval path.
    if (pendingStore.findByCommand(command, apiKeyName)) {
      res.status(409).json({
        code: 'DUPLICATE_IN_FLIGHT',
        message: 'An identical command from this API key is already awaiting approval. Retry after it settles.',
        retryable: true,
      } satisfies ErrorResponse);
      return;
    }

    try {
      pendingStore.add({
        requestId,
        command,
        apiKeyName,
        ip,
        createdAt: new Date().toISOString(),
        resolve: () => {},
        reject: () => {},
        abortController,
      });

      // Abort execution if the client disconnects before we finish writing
      // the response. `res.on('close')` fires for both premature disconnects
      // and normal completion, so we gate on `res.writableEnded` to ignore
      // the normal-completion case.
      res.on('close', () => {
        if (res.writableEnded) return;
        abortController.abort();
        pendingStore.remove(requestId);
      });

      const approvalResult = await Promise.race([
        approvalChannel.requestApproval(command, apiKeyName, ip, requestId, riskAnalysis),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Approval timed out')), config.approvalTimeoutSeconds * 1000);
        }),
        // Bail out of the approval wait if the client disconnected. Otherwise
        // the handler would continue awaiting the channel until either the
        // approver acts or the approval timeout fires — orphaning work that
        // nobody is listening for.
        new Promise<never>((_, reject) => {
          if (abortController.signal.aborted) {
            reject(new Error('Request aborted'));
            return;
          }
          abortController.signal.addEventListener(
            'abort',
            () => reject(new Error('Request aborted')),
            { once: true },
          );
        }),
      ]);

      // Approval decision obtained — release the pending-store slot now so
      // DUPLICATE_IN_FLIGHT only gates *awaiting-approval* duplicates and
      // not in-flight execution. `release` (unlike `remove`) does not abort
      // the live AbortController, which still guards the upcoming execution.
      pendingStore.release(requestId);

      if (approvalResult.decision === 'denied') {
        res.status(403).json({
          requestId,
          status: 'denied' as RequestStatus,
          code: 'DENIED',
          message: 'Command was denied',
          retryable: false,
        });
        return;
      }

      const result = await executeCommand({
        command,
        requestId,
        cwd,
        timeoutMs: config.executionTimeoutSeconds * 1000,
        maxOutputBytes: config.maxOutputBytes,
        maxConcurrent: config.maxConcurrentExecutions,
        abortSignal: abortController.signal,
        aliases: config.aliases,
      });
      auditLog.append({
        ts: new Date().toISOString(),
        type: 'executed',
        requestId,
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        error: result.error,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('aborted')) {
        // Client disconnected before a decision landed. Ask the channel to
        // clean up any bot message / admin queue entry. No response to send.
        try { approvalChannel.cancel?.(requestId); } catch { /* best-effort */ }
        log.info({ requestId }, 'Approval wait aborted by client disconnect');
      } else if (message.includes('timed out')) {
        res.status(408).json({
          requestId,
          status: 'timed_out' as RequestStatus,
          code: 'APPROVAL_TIMEOUT',
          message: 'Approval timed out. No response from approver.',
          retryable: true,
        });
      } else {
        res.status(503).json({
          requestId,
          code: 'APPROVAL_ERROR',
          message: `Approval channel error: ${message}`,
          retryable: true,
        });
      }
    } finally {
      pendingStore.remove(requestId);
    }
  });
}

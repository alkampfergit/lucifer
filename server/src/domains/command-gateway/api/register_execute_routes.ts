import { randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import type {
  ApprovalChannel, ExecutionResult, RequestStatus, ErrorResponse, LuciferConfig,
} from '../types/command_types.js';
import type { ApiKeyStore, CommandRulesStore, ApprovalStore, PendingRequestStore, AuditLog } from '../types/store_interfaces.js';
import { authenticateRequest, createRateLimiter } from '../service/authenticate_request.js';
import { analyzeCommandRisk } from '../service/analyze_command_risk.js';
import { executeCommand } from '../service/execute_command.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('routes');

interface CompletedResult {
  result: ExecutionResult;
  completedAt: number;
}

const completedResults = new Map<string, CompletedResult>();

// Clean up completed results older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, entry] of completedResults.entries()) {
    if (entry.completedAt < cutoff) {
      completedResults.delete(id);
    }
  }
}, 60_000);

export function registerExecuteRoutes(
  router: Router,
  config: LuciferConfig,
  apiKeyStore: ApiKeyStore,
  commandRulesStore: CommandRulesStore,
  approvalStore: ApprovalStore,
  pendingStore: PendingRequestStore,
  auditLog: AuditLog,
  approvalChannel: ApprovalChannel,
): void {
  const rateLimiter = createRateLimiter(
    process.env.NODE_ENV === 'development' ? 1000 : config.rateLimitPerMinute,
  );

  router.post('/api/v1/execute', async (req: Request, res: Response) => {
    const rawKey = req.headers['x-api-key'] as string | undefined;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
    const { command, cwd } = req.body as { command?: string; cwd?: string };

    if (!command || typeof command !== 'string') {
      res.status(400).json({
        code: 'MISSING_COMMAND',
        message: 'Request body must include a "command" string',
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    if (command.length > 4096) {
      res.status(400).json({
        code: 'COMMAND_TOO_LONG',
        message: 'Command exceeds 4096 character limit',
        retryable: false,
      } satisfies ErrorResponse);
      return;
    }

    // Validate cwd if provided
    if (cwd !== undefined) {
      if (typeof cwd !== 'string' || cwd.includes('..') || !cwd.startsWith('/')) {
        res.status(400).json({
          code: 'INVALID_CWD',
          message: 'cwd must be an absolute path without ".." components',
          retryable: false,
        } satisfies ErrorResponse);
        return;
      }
    }

    const authResult = authenticateRequest(apiKeyStore, rateLimiter, rawKey, ip);
    if (!authResult.ok) {
      res.status(authResult.statusCode).json(authResult.error);
      return;
    }

    const requestId = randomUUID();
    const apiKeyName = authResult.keyConfig.name;
    const isSync = req.query.sync === 'true';

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

    // telegram_approve: check existing approval in SQLite
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

    // Need Telegram approval
    const riskAnalysis = analyzeCommandRisk(command);
    const abortController = new AbortController();

    // Coalesce: check if same command from same key is already pending
    const existingPending = pendingStore.findByCommand(command, apiKeyName);

    if (!isSync) {
      // Async mode (default): return requestId, process in background
      if (!existingPending) {
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

        // Fire and forget the approval request + execution
        processApprovalAsync(
          requestId, command, apiKeyName, ip, cwd, riskAnalysis,
          config, approvalChannel, pendingStore, auditLog, abortController,
        );
      }

      res.status(202).json({
        requestId: existingPending?.requestId ?? requestId,
        status: 'pending_approval' as RequestStatus,
      });
      return;
    }

    // Sync mode: block until decision
    if (existingPending) {
      // Wait for the existing pending request to resolve
      // For simplicity in sync mode, just wait for a bit then poll
      res.status(202).json({
        requestId: existingPending.requestId,
        status: 'pending_approval' as RequestStatus,
        message: 'Another request for the same command is pending. Poll for status.',
      });
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

      req.on('close', () => {
        abortController.abort();
        pendingStore.remove(requestId);
      });

      const approvalResult = await Promise.race([
        approvalChannel.requestApproval(command, apiKeyName, ip, requestId, riskAnalysis),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Approval timed out')), config.approvalTimeoutSeconds * 1000);
        }),
      ]);

      if (approvalResult.decision === 'denied') {
        res.status(403).json({
          requestId,
          status: 'denied' as RequestStatus,
          code: 'DENIED',
          message: 'Command was denied via Telegram',
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
      if (message.includes('timed out')) {
        res.status(408).json({
          requestId,
          status: 'timed_out' as RequestStatus,
          code: 'APPROVAL_TIMEOUT',
          message: 'Approval timed out. No response from Telegram.',
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

  router.get('/api/v1/status/:requestId', (req: Request, res: Response) => {
    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;

    // Auth check: require valid API key for status queries
    const rawKey = req.headers['x-api-key'] as string | undefined;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
    const authResult = authenticateRequest(apiKeyStore, rateLimiter, rawKey, ip);
    if (!authResult.ok) {
      res.status(authResult.statusCode).json(authResult.error);
      return;
    }

    // Check completed results cache
    const completed = completedResults.get(requestId);
    if (completed) {
      res.json(completed.result);
      return;
    }

    // Check pending store
    const pending = pendingStore.get(requestId);
    if (pending) {
      // Scope check: only the same API key can query status
      if (pending.apiKeyName !== authResult.keyConfig.name) {
        res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Request not found',
          retryable: false,
        } satisfies ErrorResponse);
        return;
      }
      res.json({ requestId, status: 'pending_approval' as RequestStatus });
      return;
    }

    res.status(404).json({
      code: 'NOT_FOUND',
      message: 'Request not found or expired',
      retryable: false,
    } satisfies ErrorResponse);
  });
}

async function processApprovalAsync(
  requestId: string,
  command: string,
  apiKeyName: string,
  ip: string,
  cwd: string | undefined,
  riskAnalysis: ReturnType<typeof analyzeCommandRisk>,
  config: LuciferConfig,
  approvalChannel: ApprovalChannel,
  pendingStore: PendingRequestStore,
  auditLog: AuditLog,
  abortController: AbortController,
): Promise<void> {
  try {
    const approvalResult = await Promise.race([
      approvalChannel.requestApproval(command, apiKeyName, ip, requestId, riskAnalysis),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Approval timed out')), config.approvalTimeoutSeconds * 1000);
      }),
    ]);

    if (approvalResult.decision === 'denied') {
      completedResults.set(requestId, {
        result: { requestId, status: 'denied' },
        completedAt: Date.now(),
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

    completedResults.set(requestId, { result, completedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ requestId, err: message }, 'Async approval/execution failed');

    completedResults.set(requestId, {
      result: {
        requestId,
        status: message.includes('timed out') ? 'timed_out' : 'failed',
        error: message,
      },
      completedAt: Date.now(),
    });
  } finally {
    pendingStore.remove(requestId);
  }
}

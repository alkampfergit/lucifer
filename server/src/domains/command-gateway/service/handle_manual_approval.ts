import type { Response } from 'express';
import type { ApprovalChannel, ErrorResponse, LuciferConfig, RequestStatus } from '../types/command_types.js';
import type { AuditLog, PendingRequestStore } from '../types/store_interfaces.js';
import { analyzeCommandRisk } from './analyze_command_risk.js';
import { executeAndAudit, type AliasAudit } from './execute_and_audit.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('routes');

export interface ManualApprovalArgs {
  command: string;
  requestId: string;
  apiKeyName: string;
  ip: string;
  cwd: string | undefined;
  config: LuciferConfig;
  approvalChannel: ApprovalChannel;
  pendingStore: PendingRequestStore;
  auditLog: AuditLog;
  aliasAudit: AliasAudit;
  res: Response;
}

/**
 * Handles the manual_approve branch: pending-store gating, abort-on-disconnect
 * wiring, approval channel race with timeout, and the final execute+audit or
 * decision-rejection response. Separated from `registerExecuteRoutes` because
 * it dominated the route handler's line count; behaviour is unchanged.
 */
export async function handleManualApproval(args: ManualApprovalArgs): Promise<void> {
  const {
    command, requestId, apiKeyName, ip, cwd, config,
    approvalChannel, pendingStore, auditLog, aliasAudit, res,
  } = args;

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

    await executeAndAudit({
      command, requestId, cwd, config, auditLog, aliasAudit,
      abortSignal: abortController.signal,
      res,
    });
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
}

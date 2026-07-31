import type { Response } from 'express';
import type { AliasType, LuciferConfig } from '../types/command_types.js';
import type { AuditLog } from '../types/store_interfaces.js';
import { executeCommand } from './execute_command.js';

export type AliasAudit = { aliasPath?: string; aliasType?: AliasType };

export interface ExecuteAndAuditArgs {
  command: string;
  requestId: string;
  cwd: string | undefined;
  config: LuciferConfig;
  auditLog: AuditLog;
  aliasAudit: AliasAudit;
  abortSignal?: AbortSignal;
  res: Response;
}

/**
 * Runs `executeCommand` with config-derived options, writes the `executed`
 * audit entry (carrying alias context when present), and returns the JSON
 * response. Shared across the always_approve, cached-approval, and
 * manual-approve branches so audit shape stays identical.
 */
export async function executeAndAudit(args: ExecuteAndAuditArgs): Promise<void> {
  const { command, requestId, cwd, config, auditLog, aliasAudit, abortSignal, res } = args;
  const result = await executeCommand({
    command,
    requestId,
    cwd,
    timeoutMs: config.executionTimeoutSeconds * 1000,
    maxOutputBytes: config.maxOutputBytes,
    maxConcurrent: config.maxConcurrentExecutions,
    abortSignal,
    aliases: config.aliases,
    toolsPath: config.toolsPath,
  });
  auditLog.append({
    ts: new Date().toISOString(),
    type: 'executed',
    requestId,
    command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    error: result.error,
    ...aliasAudit,
  });
  res.json(result);
}

import { spawn } from 'node:child_process';
import type { AliasesConfig, ExecutionResult } from '../types/command_types.js';
import { resolveAlias } from './resolve_alias.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('executor');

let activeExecutions = 0;

export interface ExecuteOptions {
  command: string;
  requestId: string;
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxConcurrent: number;
  abortSignal?: AbortSignal;
  aliases?: AliasesConfig;
}

export async function executeCommand(options: ExecuteOptions): Promise<ExecutionResult> {
  const { command, requestId, cwd, timeoutMs, maxOutputBytes, maxConcurrent, abortSignal, aliases } = options;

  if (activeExecutions >= maxConcurrent) {
    log.warn({ requestId, active: activeExecutions, max: maxConcurrent }, 'Max concurrent executions reached');
    return {
      requestId,
      status: 'failed',
      error: 'Too many concurrent commands. Try again later.',
    };
  }

  activeExecutions++;
  const startTime = Date.now();
  const resolved = resolveAlias(command, aliases);
  log.info(
    { requestId, command, cwd, alias: resolved ? { cwd: resolved.cwd, bin: resolved.spawnCommand } : undefined },
    'Executing command',
  );

  try {
    return await new Promise<ExecutionResult>((resolve) => {
      // This is a command gateway that intentionally executes user-supplied
      // commands. Access is gated by API-key auth and configurable command
      // rules (allow/deny lists). The spawn call below is by design.
      const child = resolved
        ? spawn(resolved.spawnCommand, resolved.spawnArgs, { cwd: resolved.cwd, detached: true })
        : spawn(command, { shell: true, cwd: cwd ?? process.cwd(), detached: true }); // NOSONAR -- intentional: this gateway executes user-supplied commands gated by API-key auth and command rules

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        log.warn({ requestId, timeoutMs }, 'Command timed out');
      }, timeoutMs);

      const onAbort = () => {
        killed = true;
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        clearTimeout(timer);
        log.info({ requestId }, 'Command aborted (client disconnected)');
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          clearTimeout(timer);
          resolve({ requestId, status: 'failed', error: 'Request aborted' });
          return;
        }
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= maxOutputBytes) {
          stdout += chunk.toString();
        } else if (!killed) {
          killed = true;
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          clearTimeout(timer);
          log.warn({ requestId, outputBytes, maxOutputBytes }, 'Output buffer exceeded');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= maxOutputBytes) {
          stderr += chunk.toString();
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }

        const durationMs = Date.now() - startTime;

        if (killed && outputBytes > maxOutputBytes) {
          resolve({
            requestId,
            status: 'failed',
            stdout: stdout.slice(0, maxOutputBytes),
            stderr,
            durationMs,
            error: `Output exceeded ${maxOutputBytes} bytes limit`,
          });
          return;
        }

        if (killed) {
          resolve({
            requestId,
            status: 'timed_out',
            stdout,
            stderr,
            durationMs,
            error: `Command timed out after ${timeoutMs}ms`,
          });
          return;
        }

        resolve({
          requestId,
          status: code === 0 ? 'completed' : 'failed',
          exitCode: code ?? undefined,
          stdout,
          stderr,
          durationMs,
        });

        log.info({ requestId, exitCode: code, durationMs }, 'Command completed');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }
        resolve({
          requestId,
          status: 'failed',
          error: `Failed to execute: ${err.message}`,
          durationMs: Date.now() - startTime,
        });
      });
    });
  } finally {
    activeExecutions--;
  }
}

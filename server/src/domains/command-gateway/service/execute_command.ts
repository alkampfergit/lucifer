import { spawn } from 'node:child_process';
import type { ExecutionResult } from '../types/command_types.js';
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
}

export async function executeCommand(options: ExecuteOptions): Promise<ExecutionResult> {
  const { command, requestId, cwd, timeoutMs, maxOutputBytes, maxConcurrent, abortSignal } = options;

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
  log.info({ requestId, command, cwd }, 'Executing command');

  try {
    return await new Promise<ExecutionResult>((resolve) => {
      const child = spawn(command, { shell: true, cwd: cwd ?? process.cwd(), detached: true });

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

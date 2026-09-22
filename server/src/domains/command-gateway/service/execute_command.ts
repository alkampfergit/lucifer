import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter as pathDelimiter, join as joinPath } from 'node:path';
import type { AliasesConfig, ExecutionResult } from '../types/command_types.js';
import { resolveAlias, type ResolvedAlias } from './resolve_alias.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('executor');

const IS_WINDOWS = process.platform === 'win32';

/**
 * `taskkill` resolved from `%SystemRoot%` rather than looked up on `PATH`:
 * this process terminates a command tree, so the search order must not be
 * able to decide which binary runs. Same reasoning as the absolute DLL paths
 * in the Windows certificate store reader.
 */
const TASKKILL_PATH = joinPath(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');

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
  /** Extra directories prepended to the child's PATH, in order. Operator-configured only; never derived from caller input. */
  toolsPath?: string[];
}

export async function executeCommand(options: ExecuteOptions): Promise<ExecutionResult> {
  const { command, requestId, cwd, maxConcurrent, aliases } = options;

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
    return await runChildProcess(options, resolved, startTime);
  } finally {
    activeExecutions--;
  }
}

/**
 * Build the child's environment, prepending operator-configured `toolsPath`
 * entries onto `PATH` so raw (non-alias) commands can resolve tools outside
 * the daemon's own PATH without a full path in every rule/command. Returns
 * `undefined` (inherit `process.env` unchanged) when no `toolsPath` is set.
 */
function buildChildEnv(toolsPath: string[] | undefined): NodeJS.ProcessEnv | undefined {
  if (!toolsPath || toolsPath.length === 0) return undefined;
  const existingPath = process.env.PATH ?? '';
  return { ...process.env, PATH: [...toolsPath, existingPath].filter(Boolean).join(pathDelimiter) };
}

/**
 * POSIX only. `detached` puts the child in its own process group so
 * `process.kill(-pid)` can take down the whole tree, which is how a timeout
 * or an aborted request reaches grandchildren.
 *
 * On Windows the same flag is actively harmful and buys nothing. libuv maps
 * it to `DETACHED_PROCESS`, so the child runs without a console; a shell
 * builtin still writes to the inherited pipe, but any external executable the
 * shell launches allocates a fresh console and its output is lost — commands
 * returned exit code 0 with empty stdout. Nor does it help with killing:
 * negative PIDs are meaningless on Windows, so the tree is torn down with
 * `taskkill /T` instead.
 */
const USE_PROCESS_GROUP = !IS_WINDOWS;

function spawnChild(options: ExecuteOptions, resolved: ResolvedAlias | null): ChildProcessWithoutNullStreams {
  const env = buildChildEnv(options.toolsPath);
  // This is a command gateway that intentionally executes user-supplied
  // commands. Access is gated by API-key auth and configurable command
  // rules (allow/deny lists). The spawn call below is by design.
  if (resolved) {
    return spawn(resolved.spawnCommand, resolved.spawnArgs, { cwd: resolved.cwd, detached: USE_PROCESS_GROUP, env });
  }
  return spawn(options.command, { shell: true, cwd: options.cwd ?? process.cwd(), detached: USE_PROCESS_GROUP, env }); // NOSONAR -- intentional: this gateway executes user-supplied commands gated by API-key auth and command rules
}

function killChildTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill('SIGKILL');
    return;
  }

  if (IS_WINDOWS) {
    // `/T` includes descendants, `/F` is unconditional. Failure is expected
    // and harmless when the tree has already exited between the timeout
    // firing and this call, so the exit code is deliberately not inspected.
    const killer = spawn(TASKKILL_PATH, ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('error', (err) => {
      log.warn({ pid, err: err.message }, 'taskkill failed; falling back to a direct kill');
      child.kill('SIGKILL');
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function runChildProcess(
  options: ExecuteOptions,
  resolved: ResolvedAlias | null,
  startTime: number,
): Promise<ExecutionResult> {
  const { requestId, timeoutMs, maxOutputBytes, abortSignal } = options;

  return new Promise<ExecutionResult>((resolve) => {
    const child = spawnChild(options, resolved);

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      killChildTree(child);
      log.warn({ requestId, timeoutMs }, 'Command timed out');
    }, timeoutMs);

    const onAbort = () => {
      killed = true;
      killChildTree(child);
      clearTimeout(timer);
      log.info({ requestId }, 'Command aborted (client disconnected)');
    };

    if (abortSignal?.aborted) {
      killChildTree(child);
      clearTimeout(timer);
      resolve({ requestId, status: 'failed', error: 'Request aborted' });
      return;
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    const handleStdoutChunk = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) {
        stdout += chunk.toString();
        return;
      }
      if (killed) return;
      killed = true;
      killChildTree(child);
      clearTimeout(timer);
      log.warn({ requestId, outputBytes, maxOutputBytes }, 'Output buffer exceeded');
    };

    const handleStderrChunk = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) {
        stderr += chunk.toString();
      }
    };

    const handleClose = (code: number | null) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);

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
    };

    const handleError = (err: Error) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      resolve({
        requestId,
        status: 'failed',
        error: `Failed to execute: ${err.message}`,
        durationMs: Date.now() - startTime,
      });
    };

    child.stdout.on('data', handleStdoutChunk);
    child.stderr.on('data', handleStderrChunk);
    child.on('close', handleClose);
    child.on('error', handleError);
  });
}

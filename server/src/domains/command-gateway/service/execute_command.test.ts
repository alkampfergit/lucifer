import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { executeCommand } from './execute_command.js';

const IS_WINDOWS = process.platform === 'win32';

/** Prints the shell's working directory. `cd` with no operand on cmd.exe. */
const PRINT_CWD = IS_WINDOWS ? 'cd' : 'pwd';

/**
 * Compare two paths that name the same directory but may differ in casing or
 * 8.3 short-name form — `tmpdir()` reports `C:\Users\RUNNER~1\...` on a
 * GitHub runner while the shell prints the expanded `C:\Users\runneradmin\...`.
 */
function samePath(a: string, b: string): boolean {
  return realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();
}

describe('executeCommand', () => {
  it('executes a simple command and returns output', async () => {
    const result = await executeCommand({
      command: 'echo hello',
      requestId: 'test-1',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.trim()).toBe('hello');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('captures stderr', async () => {
    const result = await executeCommand({
      command: 'echo error >&2',
      requestId: 'test-2',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('completed');
    expect(result.stderr?.trim()).toBe('error');
  });

  it('returns non-zero exit code as failed', async () => {
    const result = await executeCommand({
      command: 'exit 42',
      requestId: 'test-3',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(42);
  });

  it('kills command on timeout', async () => {
    const result = await executeCommand({
      command: 'node -e "setTimeout(()=>{},60000)"',
      requestId: 'test-4',
      timeoutMs: 500,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('timed_out');
    expect(result.error).toContain('timed out');
  }, 10000);

  it('rejects when max concurrent reached', async () => {
    const result = await executeCommand({
      command: 'echo x',
      requestId: 'test-5',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 0,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('concurrent');
  });

  it('kills command on abort signal', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);

    const result = await executeCommand({
      command: 'node -e "setTimeout(()=>{},60000)"',
      requestId: 'test-6',
      timeoutMs: 30000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
      abortSignal: ac.signal,
    });
    expect(['timed_out', 'failed'].includes(result.status)).toBe(true);
  }, 10000);

  it('respects cwd option', async () => {
    const sysTmp = tmpdir();
    const result = await executeCommand({
      command: PRINT_CWD,
      requestId: 'test-7',
      cwd: sysTmp,
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('completed');
    expect(samePath(result.stdout!.trim(), sysTmp)).toBe(true);
  });

  // Regression: the executor used to pass `detached: true` on every platform.
  // On Windows that means `DETACHED_PROCESS`, so the shell ran without a
  // console and any external executable it launched wrote to a fresh console
  // of its own instead of the inherited pipe — exit code 0, empty stdout.
  // Shell builtins were unaffected, which is why every other case here passed.
  it('captures stdout from an external executable, not only from shell builtins', async () => {
    const result = await executeCommand({
      command: 'node -e "process.stdout.write(\'from-a-real-binary\')"',
      requestId: 'test-external-binary',
      timeoutMs: 15000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('from-a-real-binary');
  }, 20000);

  it('runs a bash alias from the script directory, ignoring caller cwd', async () => {
    const dir = join(tmpdir(), `lucifer-alias-test-${Date.now()}-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const scriptPath = join(dir, 'mybuild.sh');
    // The script prints its working directory so the test can assert the
    // alias executor used the script's parent dir, not the caller-provided one.
    writeFileSync(scriptPath, '#!/bin/bash\npwd\n');
    chmodSync(scriptPath, 0o755);

    try {
      const result = await executeCommand({
        command: 'mybuild',
        requestId: 'alias-bash',
        cwd: tmpdir(), // should be ignored when alias matches
        timeoutMs: 5000,
        maxOutputBytes: 1024,
        maxConcurrent: 5,
        aliases: {
          mybuild: { path: scriptPath, type: 'bash' },
        },
      });
      expect(result.status).toBe('completed');
      // Compared by leaf name: on Windows the script runs under Git Bash,
      // which prints its cwd in POSIX form (`/tmp/<leaf>`) rather than the
      // `C:\...\Temp\<leaf>` the test created. The leaf is unique per run, so
      // it still distinguishes the script's own directory from the caller
      // cwd (`tmpdir()`) that the executor is required to ignore.
      expect(basename(result.stdout!.trim())).toBe(basename(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to shell execution when no alias matches', async () => {
    const result = await executeCommand({
      command: 'echo fallback',
      requestId: 'alias-miss',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
      aliases: {
        other: { path: join(tmpdir(), 'does-not-exist.sh'), type: 'bash' },
      },
    });
    expect(result.status).toBe('completed');
    expect(result.stdout?.trim()).toBe('fallback');
  });

  it('fails cleanly when an elf alias points to a missing file', async () => {
    const missingPath = join(tmpdir(), `lucifer-missing-${Date.now()}-${randomUUID()}`);
    const result = await executeCommand({
      command: 'ghost',
      requestId: 'alias-elf-missing',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
      aliases: {
        ghost: { path: missingPath, type: 'elf' },
      },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
    // spawn surfaces ENOENT via child 'error' event; the executor wraps it.
    expect(result.error).toMatch(/Failed to execute/);
  });

  it('prepends toolsPath directories onto the child PATH for a raw command', async () => {
    const dir = join(tmpdir(), `lucifer-toolspath-${Date.now()}-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    // Shell PATH lookup rules differ by platform (PATHEXT on Windows vs.
    // executable bit + shebang on POSIX), so the fixture and command name
    // must match the platform running the test.
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'mytool.cmd' : 'mytool.sh';
    const scriptPath = join(dir, scriptName);
    writeFileSync(scriptPath, isWindows ? '@echo found-mytool\n' : '#!/bin/bash\necho found-mytool\n');
    if (!isWindows) chmodSync(scriptPath, 0o755);

    try {
      const result = await executeCommand({
        command: scriptName,
        requestId: 'toolspath-1',
        timeoutMs: 5000,
        maxOutputBytes: 1024,
        maxConcurrent: 5,
        toolsPath: [dir],
      });
      expect(result.status).toBe('completed');
      expect(result.stdout?.trim()).toBe('found-mytool');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still resolves normally without toolsPath configured', async () => {
    const result = await executeCommand({
      command: 'echo no-toolspath',
      requestId: 'toolspath-2',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('completed');
    expect(result.stdout?.trim()).toBe('no-toolspath');
  });

  it('returns a non-zero exit when a bash alias points to a missing script', async () => {
    // bash itself runs; the missing script produces a non-zero exit code and
    // stderr. This exercises the bash-launcher branch's error surface rather
    // than the spawn-level 'error' event.
    const missingPath = join(tmpdir(), `lucifer-missing-${Date.now()}-${randomUUID()}.sh`);
    const result = await executeCommand({
      command: 'ghost',
      requestId: 'alias-bash-missing',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
      aliases: {
        ghost: { path: missingPath, type: 'bash' },
      },
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr ?? '').toMatch(/No such file|cannot|not found/i);
  });
});

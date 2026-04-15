import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCommand } from './execute_command.js';

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
    const result = await executeCommand({
      command: 'pwd',
      requestId: 'test-7',
      cwd: '/tmp',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxConcurrent: 5,
    });
    expect(result.status).toBe('completed');
    expect(result.stdout?.trim()).toBe('/tmp');
  });

  it('runs a bash alias from the script directory, ignoring caller cwd', async () => {
    const dir = join(tmpdir(), `lucifer-alias-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
        cwd: '/tmp', // should be ignored when alias matches
        timeoutMs: 5000,
        maxOutputBytes: 1024,
        maxConcurrent: 5,
        aliases: {
          mybuild: { path: scriptPath, type: 'bash' },
        },
      });
      expect(result.status).toBe('completed');
      expect(result.stdout?.trim()).toBe(dir);
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
        other: { path: '/tmp/does-not-exist.sh', type: 'bash' },
      },
    });
    expect(result.status).toBe('completed');
    expect(result.stdout?.trim()).toBe('fallback');
  });
});

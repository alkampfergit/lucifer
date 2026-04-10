import { describe, it, expect } from 'vitest';
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
});

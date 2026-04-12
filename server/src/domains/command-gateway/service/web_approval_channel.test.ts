import { describe, it, expect, vi } from 'vitest';
import { createWebApprovalChannel } from './web_approval_channel.js';
import type { ShellRiskAnalysis } from '../types/command_types.js';

const defaultRisk: ShellRiskAnalysis = { level: 'safe', warnings: [] };

describe('createWebApprovalChannel', () => {
  it('requestApproval blocks until resolveRequest is called', async () => {
    const channel = createWebApprovalChannel();

    const approvalPromise = channel.requestApproval('ls -la', 'key1', '127.0.0.1', 'req-1', defaultRisk);

    // Should be pending at this point
    const pending = channel.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe('req-1');

    // Resolve the request
    const resolved = channel.resolveRequest('req-1', 'approved', 'exact', '4');
    expect(resolved).toBe(true);

    const result = await approvalPromise;
    expect(result.decision).toBe('approved');
    expect(result.matchType).toBe('exact');
    expect(result.duration).toBe('4');
  });

  it('getPendingRequests returns correct list', async () => {
    const channel = createWebApprovalChannel();

    // Start multiple requests without resolving them
    channel.requestApproval('cmd1', 'key1', '10.0.0.1', 'req-a', defaultRisk);
    channel.requestApproval('cmd2', 'key2', '10.0.0.2', 'req-b', defaultRisk);

    const pending = channel.getPendingRequests();
    expect(pending).toHaveLength(2);

    const ids = pending.map(p => p.requestId);
    expect(ids).toContain('req-a');
    expect(ids).toContain('req-b');

    // Clean up
    channel.resolveRequest('req-a', 'denied', 'exact', '0');
    channel.resolveRequest('req-b', 'denied', 'exact', '0');
  });

  it('resolveRequest returns false for unknown requestId', () => {
    const channel = createWebApprovalChannel();
    const result = channel.resolveRequest('nonexistent', 'approved', 'exact', '2');
    expect(result).toBe(false);
  });

  it('cancel removes request from pending without resolving', async () => {
    const channel = createWebApprovalChannel();

    channel.requestApproval('echo test', 'key1', '127.0.0.1', 'req-cancel', defaultRisk);
    expect(channel.getPendingRequests()).toHaveLength(1);

    channel.cancel!('req-cancel');
    expect(channel.getPendingRequests()).toHaveLength(0);
  });

  it('SSE broadcast sends data to connected clients', async () => {
    const channel = createWebApprovalChannel();

    const mockRes = { write: vi.fn(), end: vi.fn() } as unknown as import('express').Response;
    channel.addSSEClient(mockRes);

    // requestApproval triggers a broadcast of 'new_request'
    channel.requestApproval('ls', 'key1', '127.0.0.1', 'req-sse', defaultRisk);

    expect(mockRes.write).toHaveBeenCalledOnce();
    const payload = vi.mocked(mockRes.write).mock.calls[0][0] as string;
    expect(payload).toContain('event: new_request');
    expect(payload).toContain('req-sse');

    // Clean up
    channel.resolveRequest('req-sse', 'approved', 'exact', '2');
    channel.removeSSEClient(mockRes);
  });

  it('stop rejects all pending callbacks and closes SSE connections', async () => {
    const channel = createWebApprovalChannel();

    const promise1 = channel.requestApproval('cmd1', 'key1', '10.0.0.1', 'req-stop-1', defaultRisk);
    const promise2 = channel.requestApproval('cmd2', 'key2', '10.0.0.2', 'req-stop-2', defaultRisk);

    const mockRes = { write: vi.fn(), end: vi.fn() } as unknown as import('express').Response;
    channel.addSSEClient(mockRes);

    await channel.stop();

    await expect(promise1).rejects.toThrow('shutting down');
    await expect(promise2).rejects.toThrow('shutting down');
    expect(mockRes.end).toHaveBeenCalledOnce();
  });
});

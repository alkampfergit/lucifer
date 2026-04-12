import { describe, it, expect, vi } from 'vitest';
import { createMultiApprovalChannel } from './multi_approval_channel.js';
import type { ApprovalChannel, ShellRiskAnalysis } from '../types/command_types.js';

function makeMockChannel(
  overrides: Partial<ApprovalChannel> = {},
): ApprovalChannel {
  return {
    requestApproval: vi.fn(() => Promise.resolve({ decision: 'approved' as const, matchType: 'exact' as const, duration: '2' })),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
    ...overrides,
  };
}

const defaultRisk: ShellRiskAnalysis = { level: 'safe', warnings: [] };

describe('createMultiApprovalChannel', () => {
  it('throws if channels array is empty', () => {
    expect(() => createMultiApprovalChannel([])).toThrow(
      'At least one approval channel is required',
    );
  });

  it('first channel to resolve wins the race', async () => {
    const fast = makeMockChannel({
      requestApproval: vi.fn(() =>
        Promise.resolve({ decision: 'approved' as const, matchType: 'exact' as const, duration: '4' }),
      ),
    });
    const slow = makeMockChannel({
      requestApproval: vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve({ decision: 'denied' as const, matchType: 'prefix' as const, duration: '1' }), 5000)),
      ),
    });

    const multi = createMultiApprovalChannel([fast, slow]);
    const result = await multi.requestApproval('ls', 'key1', '127.0.0.1', 'req-1', defaultRisk);

    expect(result.decision).toBe('approved');
    expect(result.duration).toBe('4');
  });

  it('cancel is called on all channels after the race resolves', async () => {
    const ch1 = makeMockChannel();
    const ch2 = makeMockChannel();

    const multi = createMultiApprovalChannel([ch1, ch2]);
    await multi.requestApproval('echo hi', 'key1', '127.0.0.1', 'req-2', defaultRisk);

    expect(ch1.cancel).toHaveBeenCalledWith('req-2');
    expect(ch2.cancel).toHaveBeenCalledWith('req-2');
  });

  it('start() calls start on all channels', async () => {
    const ch1 = makeMockChannel();
    const ch2 = makeMockChannel();
    const ch3 = makeMockChannel();

    const multi = createMultiApprovalChannel([ch1, ch2, ch3]);
    await multi.start();

    expect(ch1.start).toHaveBeenCalledOnce();
    expect(ch2.start).toHaveBeenCalledOnce();
    expect(ch3.start).toHaveBeenCalledOnce();
  });

  it('stop() calls stop on all channels', async () => {
    const ch1 = makeMockChannel();
    const ch2 = makeMockChannel();

    const multi = createMultiApprovalChannel([ch1, ch2]);
    await multi.stop();

    expect(ch1.stop).toHaveBeenCalledOnce();
    expect(ch2.stop).toHaveBeenCalledOnce();
  });
});

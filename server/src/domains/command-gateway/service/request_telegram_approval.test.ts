import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPendingRequestStore } from '../repository/pending_request_store.js';
import type { PendingRequestStore } from '../repository/pending_request_store.js';
import type { ApprovalStore } from '../repository/approval_store.js';
import type { AuditLog } from '../repository/audit_log.js';
import type { ShellRiskAnalysis } from '../types/command_types.js';

// Capture the callback_query handler registered by the source module
let callbackHandler: (ctx: Record<string, unknown>) => Promise<void>;

const mockSendMessage = vi.fn().mockResolvedValue({});
const mockBot = {
  on: vi.fn((event: string, handler: (ctx: Record<string, unknown>) => Promise<void>) => {
    if (event === 'callback_query') callbackHandler = handler;
  }),
  launch: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  telegram: { sendMessage: mockSendMessage },
};

vi.mock('telegraf', () => {
  // Must use a real function (not arrow) so it can be called with `new`
  function MockTelegraf() {
    return mockBot;
  }
  return {
    Telegraf: MockTelegraf,
    Markup: {
      inlineKeyboard: vi.fn((rows: unknown[]) => ({ reply_markup: { inline_keyboard: rows } })),
      button: {
        callback: vi.fn((text: string, data: string) => ({ text, callback_data: data })),
      },
    },
  };
});

// Import after vi.mock so the mock is in place
import { createTelegramApprovalChannel } from './request_telegram_approval.js';
import { Markup } from 'telegraf';

const TOKEN = 'test-token';
const CHAT_ID = '12345';

/** Flush pending microtasks so async continuations (after await) run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createMockApprovalStore(): ApprovalStore {
  return {
    addApproval: vi.fn(),
    findApproval: vi.fn(),
    removeExpired: vi.fn().mockReturnValue(0),
    listAll: vi.fn().mockReturnValue([]),
    revokeById: vi.fn().mockReturnValue(false),
  } as unknown as ApprovalStore;
}

function createMockAuditLog(): AuditLog {
  return {
    append: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    queryByRequestId: vi.fn().mockReturnValue([]),
  } as unknown as AuditLog;
}

function addPendingRequest(
  store: PendingRequestStore,
  requestId: string,
  command = 'git pull origin main',
) {
  const resolveFn = vi.fn();
  const rejectFn = vi.fn();
  store.add({
    requestId,
    command,
    apiKeyName: 'test-key',
    ip: '1.2.3.4',
    createdAt: new Date().toISOString(),
    resolve: resolveFn,
    reject: rejectFn,
    abortController: new AbortController(),
  });
  return { resolveFn, rejectFn };
}

function createCtx(data: string | undefined, chatId: number = 12345, fromId: number = 67890) {
  return {
    callbackQuery: {
      ...(data !== undefined ? { data } : {}),
      message: { chat: { id: chatId } },
      from: { id: fromId },
    },
    answerCbQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createTelegramApprovalChannel', () => {
  let pendingStore: PendingRequestStore;
  let approvalStore: ReturnType<typeof createMockApprovalStore>;
  let auditLog: ReturnType<typeof createMockAuditLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    pendingStore = createPendingRequestStore();
    approvalStore = createMockApprovalStore();
    auditLog = createMockAuditLog();

    // Re-wire the on() mock so the handler is captured on each channel creation
    mockBot.on.mockImplementation((event: string, handler: (ctx: Record<string, unknown>) => Promise<void>) => {
      if (event === 'callback_query') callbackHandler = handler;
    });

    // Create the channel so the callback handler is registered
    createTelegramApprovalChannel(TOKEN, CHAT_ID, pendingStore, approvalStore, auditLog);
  });

  // ── Callback handler tests ──────────────────────────────────────────

  describe('callback handler', () => {
    it('returns without side effects when callback data is missing', async () => {
      const ctx = createCtx(undefined);
      await callbackHandler(ctx);

      expect(ctx.answerCbQuery).not.toHaveBeenCalled();
      expect(ctx.editMessageText).not.toHaveBeenCalled();
      expect(approvalStore.addApproval).not.toHaveBeenCalled();
      expect(auditLog.append).not.toHaveBeenCalled();
    });

    it('answers Unauthorized when callback comes from wrong chat', async () => {
      const ctx = createCtx('approve:req-123:exact:8', 99999);
      await callbackHandler(ctx);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Unauthorized');
      expect(approvalStore.addApproval).not.toHaveBeenCalled();
    });

    it('returns without side effects for malformed callback data (too few parts)', async () => {
      const ctx = createCtx('approve:req-123');
      await callbackHandler(ctx);

      expect(ctx.answerCbQuery).not.toHaveBeenCalled();
      expect(ctx.editMessageText).not.toHaveBeenCalled();
      expect(approvalStore.addApproval).not.toHaveBeenCalled();
    });

    it('approves with exact match and stores full command', async () => {
      addPendingRequest(pendingStore, 'req-123', 'git pull origin main');
      const ctx = createCtx('approve:req-123:exact:8');
      await callbackHandler(ctx);

      expect(approvalStore.addApproval).toHaveBeenCalledWith(
        'git pull origin main',
        'exact',
        '8',
        'telegram:67890',
      );
      expect(pendingStore.get('req-123')).toBeUndefined();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('Approved'));
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('\u2705'),
      );
    });

    it('approves with prefix match and stores shortened command (first 2 words)', async () => {
      addPendingRequest(pendingStore, 'req-456', 'git pull origin main');
      const ctx = createCtx('approve:req-456:prefix:2');
      await callbackHandler(ctx);

      expect(approvalStore.addApproval).toHaveBeenCalledWith(
        'git pull',
        'prefix',
        '2',
        'telegram:67890',
      );
      expect(pendingStore.get('req-456')).toBeUndefined();
    });

    it('denies and edits message with deny emoji', async () => {
      addPendingRequest(pendingStore, 'req-789');
      const ctx = createCtx('deny:req-789:exact:0');
      await callbackHandler(ctx);

      expect(approvalStore.addApproval).not.toHaveBeenCalled();
      expect(pendingStore.get('req-789')).toBeUndefined();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Denied');
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('\u274c'),
      );
    });

    it('handles expired or unknown request gracefully', async () => {
      // No pending request added for req-unknown
      const ctx = createCtx('approve:req-unknown:exact:8');
      await callbackHandler(ctx);

      expect(ctx.answerCbQuery).toHaveBeenCalledWith('Request expired or already decided');
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith(undefined);
      expect(approvalStore.addApproval).not.toHaveBeenCalled();
    });

    it('writes audit log entry with type approved on approve', async () => {
      addPendingRequest(pendingStore, 'req-audit-a', 'npm install');
      const ctx = createCtx('approve:req-audit-a:exact:8');
      await callbackHandler(ctx);

      expect(auditLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approved',
          requestId: 'req-audit-a',
          command: 'npm install',
          duration: '8',
          approvedBy: 'telegram:67890',
        }),
      );
    });

    it('writes audit log entry with type denied on deny', async () => {
      addPendingRequest(pendingStore, 'req-audit-d', 'rm -rf /');
      const ctx = createCtx('deny:req-audit-d:exact:0');
      await callbackHandler(ctx);

      expect(auditLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'denied',
          requestId: 'req-audit-d',
          command: 'rm -rf /',
          approvedBy: 'telegram:67890',
        }),
      );
    });

    it('treats second callback for same request as expired', async () => {
      addPendingRequest(pendingStore, 'req-dup');

      // First callback approves
      const ctx1 = createCtx('approve:req-dup:exact:8');
      await callbackHandler(ctx1);
      expect(ctx1.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('Approved'));

      // Second callback for the same request should be treated as expired
      const ctx2 = createCtx('approve:req-dup:exact:8');
      await callbackHandler(ctx2);
      expect(ctx2.answerCbQuery).toHaveBeenCalledWith('Request expired or already decided');
      expect(ctx2.editMessageReplyMarkup).toHaveBeenCalledWith(undefined);
    });
  });

  // ── requestApproval tests ───────────────────────────────────────────

  describe('requestApproval', () => {
    it('sends a Markdown message with the command in a code block', async () => {
      const channel = createTelegramApprovalChannel(
        TOKEN, CHAT_ID, pendingStore, approvalStore, auditLog,
      );
      addPendingRequest(pendingStore, 'req-msg', 'ls -la');

      const promise = channel.requestApproval(
        'ls -la', 'test-key', '1.2.3.4', 'req-msg',
        { level: 'safe', warnings: [] },
      );

      // Let the async function reach the Promise executor (after the await on sendMessage)
      await flushMicrotasks();

      // Now resolve the pending request so the returned promise completes
      pendingStore.resolve('req-msg', 'approved');
      await promise;

      expect(mockSendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('```\nls -la\n```'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });

    it('includes risk warnings in the message when present', async () => {
      const channel = createTelegramApprovalChannel(
        TOKEN, CHAT_ID, pendingStore, approvalStore, auditLog,
      );
      addPendingRequest(pendingStore, 'req-warn', 'rm -rf /tmp');

      const riskAnalysis: ShellRiskAnalysis = {
        level: 'danger',
        warnings: ['Dangerous recursive delete', 'Targets system directory'],
      };

      const promise = channel.requestApproval(
        'rm -rf /tmp', 'test-key', '1.2.3.4', 'req-warn', riskAnalysis,
      );

      await flushMicrotasks();
      pendingStore.resolve('req-warn', 'approved');
      await promise;

      const sentText = mockSendMessage.mock.calls[0][1] as string;
      expect(sentText).toContain('DANGER');
      expect(sentText).toContain('Dangerous recursive delete');
      expect(sentText).toContain('Targets system directory');
    });

    it('creates 6 inline keyboard buttons: 3 exact, 2 prefix, 1 deny', async () => {
      const channel = createTelegramApprovalChannel(
        TOKEN, CHAT_ID, pendingStore, approvalStore, auditLog,
      );
      addPendingRequest(pendingStore, 'req-kb', 'git status');

      const promise = channel.requestApproval(
        'git status', 'test-key', '1.2.3.4', 'req-kb',
        { level: 'safe', warnings: [] },
      );

      await flushMicrotasks();
      pendingStore.resolve('req-kb', 'approved');
      await promise;

      // Markup.inlineKeyboard should have been called with 3 rows
      expect(Markup.inlineKeyboard).toHaveBeenCalledWith([
        // Row 1: 3 exact buttons
        expect.arrayContaining([
          expect.objectContaining({ callback_data: 'approve:req-kb:exact:2' }),
          expect.objectContaining({ callback_data: 'approve:req-kb:exact:8' }),
          expect.objectContaining({ callback_data: 'approve:req-kb:exact:permanent' }),
        ]),
        // Row 2: 2 prefix buttons
        expect.arrayContaining([
          expect.objectContaining({ callback_data: 'approve:req-kb:prefix:2' }),
          expect.objectContaining({ callback_data: 'approve:req-kb:prefix:8' }),
        ]),
        // Row 3: 1 deny button
        expect.arrayContaining([
          expect.objectContaining({ callback_data: 'deny:req-kb:exact:0' }),
        ]),
      ]);

      // Also verify Markup.button.callback was called 6 times
      expect(Markup.button.callback).toHaveBeenCalledTimes(6);
    });
  });

  // ── Lifecycle tests ─────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() launches the bot and sends a health check message', async () => {
      const channel = createTelegramApprovalChannel(
        TOKEN, CHAT_ID, pendingStore, approvalStore, auditLog,
      );

      await channel.start();

      expect(mockBot.launch).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Lucifer started'),
      );
    });

    it('stop() calls bot.stop with Shutdown reason', async () => {
      const channel = createTelegramApprovalChannel(
        TOKEN, CHAT_ID, pendingStore, approvalStore, auditLog,
      );

      await channel.stop();

      expect(mockBot.stop).toHaveBeenCalledWith('Shutdown');
    });
  });
});

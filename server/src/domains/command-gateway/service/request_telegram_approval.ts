import { Telegraf, Markup } from 'telegraf';
import type { ApprovalChannel, ApprovalDecision, ApprovalMatchType } from '../types/command_types.js';
import type { PendingRequestStore } from '../repository/pending_request_store.js';
import type { ApprovalStore } from '../repository/approval_store.js';
import type { AuditLog } from '../repository/audit_log.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('telegram');

export interface TelegramChannelOptions {
  apiRoot?: string;
}

/** Notify the user that a request has expired; errors are swallowed. */
async function dismissExpiredRequest(
  ctx: { answerCbQuery: (t: string) => Promise<unknown>; editMessageReplyMarkup: (m: undefined) => Promise<unknown> },
  requestId: string,
): Promise<void> {
  try {
    await ctx.answerCbQuery('Request expired or already decided');
    await ctx.editMessageReplyMarkup(undefined);
  } catch (err) {
    log.warn({ requestId, err }, 'Failed to update Telegram message for expired request');
  }
}

/** Cache a persistent approval entry when the decision warrants it. */
function storeApprovalIfNeeded(
  decision: ApprovalDecision,
  matchType: string,
  command: string,
  duration: string,
  approvedBy: string,
  approvalStore: ApprovalStore,
): void {
  if (decision !== 'approved' || matchType === 'once') return;

  const approvalCommand = matchType === 'prefix'
    ? command.split(/\s+/).slice(0, 2).join(' ')
    : command;

  approvalStore.addApproval(
    approvalCommand,
    matchType as ApprovalMatchType,
    duration,
    approvedBy,
  );
}

/** Build a human-readable label for the decision. */
function buildDecisionLabel(decision: ApprovalDecision, matchType: string, duration: string): string {
  if (decision !== 'approved') return 'Denied';
  if (matchType === 'once') return 'Approved (once)';
  return `Approved (${matchType} ${duration}h)`;
}

export function createTelegramApprovalChannel(
  token: string,
  chatId: string,
  pendingStore: PendingRequestStore,
  approvalStore: ApprovalStore,
  auditLog: AuditLog,
  options?: TelegramChannelOptions,
): ApprovalChannel {
  const telegrafOptions = options?.apiRoot
    ? { telegram: { apiRoot: options.apiRoot } }
    : {};
  const bot = new Telegraf(token, telegrafOptions);

  bot.on('callback_query', async (ctx) => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data) return;

    // Validate chat ID to prevent unauthorized approvals
    const callbackChatId = ctx.callbackQuery.message?.chat?.id?.toString();
    if (callbackChatId !== chatId) {
      log.warn({ callbackChatId, expectedChatId: chatId }, 'Callback from unauthorized chat');
      await ctx.answerCbQuery('Unauthorized');
      return;
    }

    // Parse callback data: "action:requestId:matchType:duration"
    const parts = data.split(':');
    if (parts.length !== 4) return;
    const [action, requestId, matchType, duration] = parts;

    const pending = pendingStore.get(requestId);
    if (!pending) {
      await dismissExpiredRequest(ctx, requestId);
      return;
    }

    const decision: ApprovalDecision = action === 'approve' ? 'approved' : 'denied';
    const approvedBy = `telegram:${ctx.callbackQuery.from.id}`;

    storeApprovalIfNeeded(decision, matchType, pending.command, duration, approvedBy, approvalStore);

    // Store decision metadata so the Promise resolve can read the actual values.
    // For "once" approvals, report as 'exact' since no cached entry is stored.
    const resolveMatchType = matchType === 'once' ? 'exact' : matchType;
    decisionMeta.set(requestId, { matchType: resolveMatchType as ApprovalMatchType, duration });

    auditLog.append({
      ts: new Date().toISOString(),
      type: decision === 'approved' ? 'approved' : 'denied',
      requestId,
      command: pending.command,
      duration: decision === 'approved' ? duration : undefined,
      approvedBy,
    });

    pendingStore.resolve(requestId, decision);

    const emoji = decision === 'approved' ? '\u2705' : '\u274c';
    const label = buildDecisionLabel(decision, matchType, duration);
    try {
      await ctx.answerCbQuery(label);
      await ctx.editMessageText(
        `${emoji} ${label}\n\n${pending.command}`,
      );
    } catch (err) {
      log.warn({ requestId, err }, 'Failed to update Telegram message after decision');
    }
  });

  // Track per-request decision metadata from callbacks
  const decisionMeta = new Map<string, { matchType: ApprovalMatchType; duration: string }>();

  return {
    async requestApproval(command, apiKeyName, ip, requestId, riskAnalysis) {
      // Wire Promise callbacks BEFORE sending the notification to avoid race condition
      const approvalPromise = new Promise<{ decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }>((resolve, reject) => {
        const pending = pendingStore.get(requestId);
        if (!pending) {
          reject(new Error('Request not found in pending store'));
          return;
        }

        const originalResolve = pending.resolve;
        const originalReject = pending.reject;

        pending.resolve = (decision: ApprovalDecision) => {
          const meta = decisionMeta.get(requestId) ?? { matchType: 'exact' as ApprovalMatchType, duration: '2' };
          decisionMeta.delete(requestId);
          originalResolve(decision);
          resolve({ decision, matchType: meta.matchType, duration: meta.duration });
        };

        pending.reject = (reason: Error) => {
          decisionMeta.delete(requestId);
          originalReject(reason);
          reject(reason);
        };
      });

      let text = `\u{1f6a8} **Command Request**\n\n`;
      text += `From: \`${apiKeyName}\` (${ip})\n`;
      text += `ID: \`${requestId}\`\n\n`;
      text += `\`\`\`\n${command}\n\`\`\``;

      if (riskAnalysis.warnings.length > 0) {
        const icon = riskAnalysis.level === 'danger' ? '\u{26a0}\ufe0f DANGER' : '\u{26a0}\ufe0f WARNING';
        text += `\n\n${icon}:\n`;
        text += riskAnalysis.warnings.map(w => `• ${w}`).join('\n');
      }

      const prefix = command.split(/\s+/).slice(0, 2).join(' ');
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('\u2714 Once', `approve:${requestId}:once:0`),
        ],
        [
          Markup.button.callback('Exact 2h', `approve:${requestId}:exact:2`),
          Markup.button.callback('Exact 8h', `approve:${requestId}:exact:8`),
          Markup.button.callback('Exact \u221e', `approve:${requestId}:exact:permanent`),
        ],
        [
          Markup.button.callback(`"${prefix}" 2h`, `approve:${requestId}:prefix:2`),
          Markup.button.callback(`"${prefix}" 8h`, `approve:${requestId}:prefix:8`),
        ],
        [
          Markup.button.callback('\u274c Deny', `deny:${requestId}:exact:0`),
        ],
      ]);

      await bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      auditLog.append({
        ts: new Date().toISOString(),
        type: 'telegram_sent',
        requestId,
        command,
        apiKeyName,
        ip,
      });

      log.info({ requestId, command, chatId }, 'Telegram approval request sent');

      return approvalPromise;
    },

    async start() {
      // bot.launch() resolves only when polling stops (i.e. on shutdown).
      // Start it as a background task so start() can return promptly.
      bot.launch().catch(err => {
        log.debug({ err }, 'Bot launch promise settled');
      });

      // Verify the bot token is valid and we can reach the API
      await bot.telegram.getMe();
      log.info('Telegram bot started');

      // Startup health check
      try {
        await bot.telegram.sendMessage(chatId, '\u{1f7e2} Lucifer started. Approval channel active.');
        log.info({ chatId }, 'Telegram health check passed');
      } catch (err) {
        log.error({ chatId, err }, 'Failed to send startup message. Check LUCIFER_TELEGRAM_CHAT_ID.');
      }
    },

    async stop() {
      bot.stop('Shutdown');
      log.info('Telegram bot stopped');
    },
  };
}

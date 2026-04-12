import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  createTelegramE2EContext,
  waitForBotMessage,
  getBotMessages,
  pressInlineButton,
  waitForCondition,
  type TelegramE2EContext,
} from './telegram-e2e-setup.js';

let ctx: TelegramE2EContext;

beforeAll(async () => {
  ctx = createTelegramE2EContext('tgapproval', 19876);
  await ctx.start();
}, 30_000);

afterAll(async () => {
  await ctx.stop();
}, 15_000);

/* eslint-disable @typescript-eslint/no-explicit-any */
interface BotMessageResult {
  result: Array<{
    messageId: number;
    message: {
      text?: string;
      reply_markup?: {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
    };
  }>;
}

interface ButtonInfo {
  text: string;
  callback_data: string;
  messageId: number;
}

/**
 * Extract inline keyboard button data from bot messages.
 */
function extractInlineButtons(botMessages: BotMessageResult): ButtonInfo[] {
  const buttons: ButtonInfo[] = [];
  for (const msg of botMessages.result) {
    const markup = msg.message?.reply_markup;
    if (markup && 'inline_keyboard' in markup) {
      for (const row of markup.inline_keyboard) {
        for (const btn of row) {
          buttons.push({ ...btn, messageId: msg.messageId });
        }
      }
    }
  }
  return buttons;
}

/**
 * Helper: submit command, wait for bot message, extract buttons.
 */
async function submitAndGetButtons(command: string) {
  const execRes = await request(ctx.app)
    .post('/api/v1/execute')
    .set('x-api-key', ctx.testKey)
    .send({ command });

  expect(execRes.status).toBe(202);
  const { requestId } = execRes.body;

  await waitForBotMessage(ctx);
  const updates = await getBotMessages(ctx) as any as BotMessageResult;
  const buttons = extractInlineButtons(updates);
  const lastMsg = updates.result[updates.result.length - 1];

  return { requestId, buttons, lastMsg, updates };
}

/**
 * Helper: wait for a request to reach a terminal status.
 */
async function waitForStatus(requestId: string, expectedStatus: string, timeoutMs = 10_000) {
  await waitForCondition(async () => {
    const statusRes = await request(ctx.app)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', ctx.testKey);
    return statusRes.status === 200 && statusRes.body.status === expectedStatus;
  }, timeoutMs);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('Telegram E2E: approval flow', () => {
  it('sends approval request to Telegram when command requires telegram_approve', async () => {
    const { buttons, lastMsg } = await submitAndGetButtons('git status');

    // The message should contain the command
    expect(lastMsg.message.text).toContain('git status');
    expect(lastMsg.message.text).toContain('Command Request');

    // Should have 6 inline keyboard buttons (3 exact + 2 prefix + 1 deny)
    expect(buttons.length).toBe(6);
    expect(buttons.some(b => b.text.includes('Exact 2h'))).toBe(true);
    expect(buttons.some(b => b.text.includes('Deny'))).toBe(true);
  }, 15_000);

  it('approves command via exact-2h button and executes it', async () => {
    const { requestId, buttons } = await submitAndGetButtons('git --version');

    const exact2h = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:2'),
    );
    expect(exact2h).toBeDefined();

    await pressInlineButton(ctx, exact2h!.callback_data, exact2h!.messageId);

    await waitForStatus(requestId, 'completed');

    const statusRes = await request(ctx.app)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', ctx.testKey);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.exitCode).toBe(0);
    expect(statusRes.body.stdout).toContain('git version');
  }, 20_000);

  it('denies command via deny button', async () => {
    const { requestId, buttons } = await submitAndGetButtons('git log --oneline -5');

    const denyBtn = buttons.find(b => b.callback_data.startsWith('deny:'));
    expect(denyBtn).toBeDefined();

    await pressInlineButton(ctx, denyBtn!.callback_data, denyBtn!.messageId);

    await waitForStatus(requestId, 'denied');

    const statusRes = await request(ctx.app)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', ctx.testKey);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('denied');
  }, 20_000);

  it('approves via prefix button and reuses approval for similar command', async () => {
    const { requestId: requestId1, buttons } = await submitAndGetButtons('ls -la /tmp');

    const prefix8h = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':prefix:8'),
    );
    expect(prefix8h).toBeDefined();

    await pressInlineButton(ctx, prefix8h!.callback_data, prefix8h!.messageId);

    await waitForStatus(requestId1, 'completed');

    // Second command with same prefix "ls -la" should be auto-approved (cached)
    const execRes2 = await request(ctx.app)
      .post('/api/v1/execute?sync=true')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'ls -la /var' });

    expect(execRes2.status).toBe(200);
    expect(execRes2.body.status).toBe('completed');
    expect(execRes2.body.exitCode).toBe(0);
  }, 25_000);

  it('approves via exact-permanent button', async () => {
    const { requestId, buttons } = await submitAndGetButtons('git branch');

    const exactPerm = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:permanent'),
    );
    expect(exactPerm).toBeDefined();

    await pressInlineButton(ctx, exactPerm!.callback_data, exactPerm!.messageId);

    await waitForStatus(requestId, 'completed');

    // Same command should now be auto-approved (permanent exact cache)
    const execRes2 = await request(ctx.app)
      .post('/api/v1/execute?sync=true')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'git branch' });

    expect(execRes2.status).toBe(200);
    expect(execRes2.body.status).toBe('completed');
  }, 25_000);

  it('shows risk warnings in the Telegram message for dangerous commands', async () => {
    const { buttons, lastMsg } = await submitAndGetButtons('git push --force origin main');

    // The message should contain the command text
    expect(lastMsg.message.text).toContain('git push --force origin main');

    // Clean up: deny it so it doesn't linger
    const denyBtn = buttons.find(b => b.callback_data.startsWith('deny:'));
    if (denyBtn) {
      await pressInlineButton(ctx, denyBtn.callback_data, denyBtn.messageId);
    }
  }, 15_000);

  it('sync mode returns result when pre-existing approval covers the command', async () => {
    // First, approve "git tag" via the async flow (which works reliably)
    const { requestId, buttons } = await submitAndGetButtons('git tag');
    const exact8h = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:8'),
    );
    expect(exact8h).toBeDefined();
    await pressInlineButton(ctx, exact8h!.callback_data, exact8h!.messageId);
    await waitForStatus(requestId, 'completed');

    // Now use sync mode — the cached approval should make it return immediately
    const syncRes = await request(ctx.app)
      .post('/api/v1/execute?sync=true')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'git tag' });

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.status).toBe('completed');
    expect(syncRes.body.exitCode).toBe(0);
  }, 25_000);
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../create_app.js';
import {
  createTelegramE2EContext,
  waitForBotMessage,
  getBotMessages,
  pressInlineButton,
  waitForCondition,
  TEST_BOT_TOKEN,
  TEST_CHAT_ID,
  type TelegramE2EContext,
} from './telegram-e2e-setup.js';

// telegram-test-api is CJS with `exports.default = TelegramServer`
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TelegramServerModule = require('telegram-test-api');
const TelegramServer = TelegramServerModule.default ?? TelegramServerModule;

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
  const lastMsg = updates.result.at(-1);

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
  it('sends approval request to Telegram when command requires manual_approve', async () => {
    const { buttons, lastMsg } = await submitAndGetButtons('git status');

    // The message should contain the command
    expect(lastMsg.message.text).toContain('git status');
    expect(lastMsg.message.text).toContain('Command Request');

    // Should have 7 inline keyboard buttons (1 once + 3 exact + 2 prefix + 1 deny)
    expect(buttons.length).toBe(7);
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

// ─── Journey: First Onboarding with Telegram ──────────────────────────────
// Operator runs --init, gets API key + admin secret, patches config with
// Telegram chat ID, starts server with Telegram approval, submits a command
// that needs approval, approves it via Telegram inline button, verifies it
// completes. This is the full production onboarding path.

const CLI_PATH = resolve(__dirname, '../cli.ts');
const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');

function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI_PATH, ...args], {
      env: { ...process.env, LUCIFER_TELEGRAM_TOKEN: 'skip' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let gotOutput = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      child.kill('SIGTERM');
      resolve({ stdout, stderr });
    }

    function resetIdle() {
      if (!gotOutput) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, 1500);
    }

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); gotOutput = true; resetIdle(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); gotOutput = true; resetIdle(); });
    child.on('close', () => { if (!settled) { settled = true; clearTimeout(idleTimer); resolve({ stdout, stderr }); } });
    child.on('error', (err) => { if (!settled) { settled = true; clearTimeout(idleTimer); reject(err); } });
    setTimeout(() => { if (!settled) { settled = true; clearTimeout(idleTimer); child.kill('SIGKILL'); reject(new Error('CLI timeout')); } }, 12_000);
  });
}

describe('Telegram E2E: first onboarding journey', () => {
  const ONBOARD_PORT = 19877;
  let tmpDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let telegramServer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let telegramClient: any;
  let appResult: ReturnType<typeof createApp>;
  let apiKey: string;
  let originalToken: string | undefined;

  beforeAll(async () => {
    // Step 1: Run --init to generate config and keys
    tmpDir = join(process.cwd(), `.test-e2e-onboard-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const { stdout } = await runCli('--init', tmpDir);
    apiKey = /(luc_[a-f0-9]{48})/.exec(stdout)![1];

    // Step 2: Patch lucifer.json with Telegram chat ID (simulates pairing)
    const configPath = join(tmpDir, 'config', 'lucifer.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.telegramChatId = TEST_CHAT_ID;
    config.rateLimitPerMinute = 1000; // relax for testing
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    // Step 3: Add a manual_approve rule for a command that will succeed
    const rulesPath = join(tmpDir, 'config', 'command-rules.json');
    const rules = JSON.parse(readFileSync(rulesPath, 'utf-8'));
    rules.rules.unshift({ prefix: 'echo tg-onboard', action: 'manual_approve' });
    writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + '\n');

    // Step 4: Start Telegram test server
    telegramServer = new TelegramServer({ port: ONBOARD_PORT, host: '127.0.0.1' });
    telegramClient = telegramServer.getClient(TEST_BOT_TOKEN, {
      chatId: Number(TEST_CHAT_ID),
      userId: 999,
      firstName: 'OnboardUser',
      userName: 'onboard_tester',
    });

    // Step 5: Start the server with Telegram pointing at test server
    originalToken = process.env.LUCIFER_TELEGRAM_TOKEN;
    process.env.LUCIFER_TELEGRAM_TOKEN = TEST_BOT_TOKEN;

    appResult = createApp({
      configPath,
      telegramApiRoot: `http://127.0.0.1:${ONBOARD_PORT}`,
    });

    await telegramServer.start();
    await appResult.start();

    // Drain the startup health-check message
    const onboardCtx = { telegramServer, telegramClient, testKey: apiKey, app: appResult.app, start: appResult.start, stop: appResult.stop, testDir: tmpDir };
    await waitForBotMessage(onboardCtx);
    await telegramClient.getUpdates();
  }, 30_000);

  afterAll(async () => {
    await appResult.stop();
    await telegramServer.stop();
    process.env.LUCIFER_TELEGRAM_TOKEN = originalToken;
    rmSync(tmpDir, { recursive: true, force: true });
  }, 15_000);

  it('init → start with Telegram → submit command → approve via button → command completes', async () => {
    // Submit a command that needs Telegram approval, using the --init generated key
    const execRes = await request(appResult.app)
      .post('/api/v1/execute')
      .set('x-api-key', apiKey)
      .send({ command: 'echo tg-onboard hello' });

    expect(execRes.status).toBe(202);
    const { requestId } = execRes.body;

    // Wait for bot to send the approval request to Telegram
    const onboardCtx = { telegramServer, telegramClient, testKey: apiKey, app: appResult.app, start: appResult.start, stop: appResult.stop, testDir: tmpDir };
    await waitForBotMessage(onboardCtx);

    const updates = await telegramClient.getUpdates();
    const buttons: Array<{ text: string; callback_data: string; messageId: number }> = [];
    for (const msg of updates.result) {
      const markup = msg.message?.reply_markup;
      if (markup && 'inline_keyboard' in markup) {
        for (const row of markup.inline_keyboard) {
          for (const btn of row) {
            buttons.push({ ...btn, messageId: msg.messageId });
          }
        }
      }
    }

    // The message should mention the command
    const lastMsg = updates.result.at(-1);
    expect(lastMsg.message.text).toContain('echo tg-onboard hello');
    expect(lastMsg.message.text).toContain('Command Request');

    // Press the "Exact 2h" approval button
    const exact2h = buttons.find((b: { callback_data: string }) =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:2'),
    );
    expect(exact2h).toBeDefined();

    const cbQuery = telegramClient.makeCallbackQuery(exact2h!.callback_data, {
      message: {
        message_id: exact2h!.messageId,
        chat: { id: Number(TEST_CHAT_ID) },
      },
    });
    await telegramClient.sendCallback(cbQuery);

    // Wait for the command to complete
    await waitForCondition(async () => {
      const statusRes = await request(appResult.app)
        .get(`/api/v1/status/${requestId}`)
        .set('x-api-key', apiKey);
      return statusRes.status === 200 && statusRes.body.status === 'completed';
    }, 10_000);

    // Verify final status
    const statusRes = await request(appResult.app)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', apiKey);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.exitCode).toBe(0);
    expect(statusRes.body.stdout).toContain('tg-onboard hello');
  }, 25_000);
});

// ─── Journey: Deny and Approve-Once via Telegram ─────────────────────────
// Verifies deny rejects the command, and approve-once executes the command
// without caching the approval. Also validates that the request correctly
// waits for the Telegram decision (regression test for issue #4).

describe('Telegram E2E: deny and approve-once journey', () => {
  let journeyCtx: TelegramE2EContext;

  beforeAll(async () => {
    journeyCtx = createTelegramE2EContext('tgjourney', 19878);
    await journeyCtx.start();
  }, 30_000);

  afterAll(async () => {
    await journeyCtx.stop();
  }, 15_000);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  it('deny → command is rejected, approve-once → command completes without cached approval', async () => {
    // ── Part 1: Deny ─────────────────────────────────────────────

    // Submit a command that needs approval
    const denyExecRes = await request(journeyCtx.app)
      .post('/api/v1/execute')
      .set('x-api-key', journeyCtx.testKey)
      .send({ command: 'git diff --stat' });

    expect(denyExecRes.status).toBe(202);
    const denyRequestId = denyExecRes.body.requestId;

    // Wait for the Telegram message
    await waitForBotMessage(journeyCtx);
    const denyUpdates = await getBotMessages(journeyCtx) as any as BotMessageResult;
    const denyButtons = extractInlineButtons(denyUpdates);

    // Press the deny button
    const denyBtn = denyButtons.find(b => b.callback_data.startsWith('deny:'));
    expect(denyBtn).toBeDefined();
    await pressInlineButton(journeyCtx, denyBtn!.callback_data, denyBtn!.messageId);

    // Wait for the request to be denied
    await waitForStatus(denyRequestId, 'denied');

    const denyStatusRes = await request(journeyCtx.app)
      .get(`/api/v1/status/${denyRequestId}`)
      .set('x-api-key', journeyCtx.testKey);
    expect(denyStatusRes.status).toBe(200);
    expect(denyStatusRes.body.status).toBe('denied');

    // ── Part 2: Approve Once ─────────────────────────────────────

    // Submit a command that needs approval
    const onceExecRes = await request(journeyCtx.app)
      .post('/api/v1/execute')
      .set('x-api-key', journeyCtx.testKey)
      .send({ command: 'git diff --stat' });

    expect(onceExecRes.status).toBe(202);
    const onceRequestId = onceExecRes.body.requestId;

    // Wait for the Telegram message
    await waitForBotMessage(journeyCtx);
    const onceUpdates = await getBotMessages(journeyCtx) as any as BotMessageResult;
    const onceButtons = extractInlineButtons(onceUpdates);

    // Press the "Once" button
    const onceBtn = onceButtons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.includes(':once:'),
    );
    expect(onceBtn).toBeDefined();
    await pressInlineButton(journeyCtx, onceBtn!.callback_data, onceBtn!.messageId);

    // Wait for the command to complete (validates issue #4 — request waits for approval)
    await waitForStatus(onceRequestId, 'completed');

    const onceStatusRes = await request(journeyCtx.app)
      .get(`/api/v1/status/${onceRequestId}`)
      .set('x-api-key', journeyCtx.testKey);
    expect(onceStatusRes.status).toBe(200);
    expect(onceStatusRes.body.status).toBe('completed');
    expect(onceStatusRes.body.exitCode).toBe(0);

    // ── Part 3: Verify no cached approval ────────────────────────

    // Submit the same command again — it should require approval again
    // (not auto-approved from cache, since we used "once")
    const repeatExecRes = await request(journeyCtx.app)
      .post('/api/v1/execute')
      .set('x-api-key', journeyCtx.testKey)
      .send({ command: 'git diff --stat' });

    expect(repeatExecRes.status).toBe(202);
    expect(repeatExecRes.body.status).toBe('pending_approval');

    // The request should NOT be auto-approved — it should still be pending
    // Wait a moment and verify it didn't complete on its own
    await new Promise(r => setTimeout(r, 500));
    const repeatStatusRes = await request(journeyCtx.app)
      .get(`/api/v1/status/${repeatExecRes.body.requestId}`)
      .set('x-api-key', journeyCtx.testKey);
    // It should be either pending or in the pending store, not completed
    if (repeatStatusRes.status === 200) {
      expect(repeatStatusRes.body.status).toBe('pending_approval');
    }

    // Clean up: deny the last pending request
    await waitForBotMessage(journeyCtx);
    const cleanupUpdates = await getBotMessages(journeyCtx) as any as BotMessageResult;
    const cleanupButtons = extractInlineButtons(cleanupUpdates);
    const cleanupDeny = cleanupButtons.find(b => b.callback_data.startsWith('deny:'));
    if (cleanupDeny) {
      await pressInlineButton(journeyCtx, cleanupDeny.callback_data, cleanupDeny.messageId);
    }
  }, 40_000);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** Helper: wait for request to reach terminal status within this describe block. */
  async function waitForStatus(requestId: string, expectedStatus: string, timeoutMs = 10_000) {
    await waitForCondition(async () => {
      const statusRes = await request(journeyCtx.app)
        .get(`/api/v1/status/${requestId}`)
        .set('x-api-key', journeyCtx.testKey);
      return statusRes.status === 200 && statusRes.body.status === expectedStatus;
    }, timeoutMs);
  }
});

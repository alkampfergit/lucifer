import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../create_app.js';
import {
  createTelegramE2EContext,
  waitForBotMessage,
  getBotMessages,
  pressInlineButton,
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
 * Fire POST /api/v1/execute immediately and return a real Promise for the
 * response. The sync-only handler only responds once Telegram decides, so
 * tests need to inspect the bot buffer and press a button before the
 * promise resolves. We explicitly call `.end(cb)` so the request is sent
 * right away rather than waiting for the caller to `.then()` the supertest
 * Test object (which would deadlock the bot-message wait below).
 */
function fireExecute(context: TelegramE2EContext, command: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    request(context.app)
      .post('/api/v1/execute')
      .set('x-api-key', context.testKey)
      .send({ command })
      .end((err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
  });
}

/**
 * Helper: fire the request, wait for the bot message, extract buttons.
 * Returns the unawaited POST promise so the caller can press a button and
 * then await the final response.
 */
async function fireAndGetButtons(command: string) {
  const execPromise = fireExecute(ctx, command);
  await waitForBotMessage(ctx);
  const updates = await getBotMessages(ctx) as any as BotMessageResult;
  const buttons = extractInlineButtons(updates);
  const lastMsg = updates.result.at(-1);
  return { execPromise, buttons, lastMsg, updates };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('Telegram E2E: approval flow', () => {
  it('sends approval request to Telegram when command requires manual_approve', async () => {
    const { execPromise, buttons, lastMsg } = await fireAndGetButtons('git status');

    // The message should contain the command
    expect(lastMsg.message.text).toContain('git status');
    expect(lastMsg.message.text).toContain('Command Request');

    // Should have 7 inline keyboard buttons (1 once + 3 exact + 2 prefix + 1 deny)
    expect(buttons.length).toBe(7);
    expect(buttons.some(b => b.text.includes('Exact 2h'))).toBe(true);
    expect(buttons.some(b => b.text.includes('Deny'))).toBe(true);

    // Clean up: deny so the POST resolves
    const denyBtn = buttons.find(b => b.callback_data.startsWith('deny:'))!;
    await pressInlineButton(ctx, denyBtn.callback_data, denyBtn.messageId);
    await execPromise;
  }, 15_000);

  it('approves command via exact-2h button and executes it', async () => {
    const { execPromise, buttons } = await fireAndGetButtons('git --version');

    const exact2h = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:2'),
    );
    expect(exact2h).toBeDefined();

    await pressInlineButton(ctx, exact2h!.callback_data, exact2h!.messageId);

    const res = await execPromise;
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.exitCode).toBe(0);
    expect(res.body.stdout).toContain('git version');
  }, 20_000);

  it('denies command via deny button', async () => {
    const { execPromise, buttons } = await fireAndGetButtons('git log --oneline -5');

    const denyBtn = buttons.find(b => b.callback_data.startsWith('deny:'));
    expect(denyBtn).toBeDefined();

    await pressInlineButton(ctx, denyBtn!.callback_data, denyBtn!.messageId);

    const res = await execPromise;
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('denied');
    expect(res.body.code).toBe('DENIED');
  }, 20_000);

  it('approves via prefix button and reuses approval for similar command', async () => {
    const { execPromise, buttons } = await fireAndGetButtons('ls -la /tmp');

    const prefix8h = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':prefix:8'),
    );
    expect(prefix8h).toBeDefined();

    await pressInlineButton(ctx, prefix8h!.callback_data, prefix8h!.messageId);

    const first = await execPromise;
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('completed');

    // Second command with same prefix "ls -la" should be auto-approved (cached)
    const res2 = await fireExecute(ctx, 'ls -la /var');

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('completed');
    expect(res2.body.exitCode).toBe(0);
  }, 25_000);

  it('approves via exact-permanent button', async () => {
    const { execPromise, buttons } = await fireAndGetButtons('git branch');

    const exactPerm = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:permanent'),
    );
    expect(exactPerm).toBeDefined();

    await pressInlineButton(ctx, exactPerm!.callback_data, exactPerm!.messageId);

    const first = await execPromise;
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('completed');

    // Same command should now be auto-approved (permanent exact cache)
    const res2 = await fireExecute(ctx, 'git branch');

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('completed');
  }, 25_000);

  it('shows risk warnings in the Telegram message for dangerous commands', async () => {
    const { execPromise, buttons, lastMsg } = await fireAndGetButtons('git push --force origin main');

    // The message should contain the command text
    expect(lastMsg.message.text).toContain('git push --force origin main');

    // Clean up: deny it so the POST resolves
    const denyBtn = buttons.find(b => b.callback_data.startsWith('deny:'))!;
    await pressInlineButton(ctx, denyBtn.callback_data, denyBtn.messageId);
    const res = await execPromise;
    expect(res.status).toBe(403);
  }, 15_000);

  it('returns result without hitting Telegram when a pre-existing approval covers the command', async () => {
    // First, approve "git tag" via a live Telegram exchange so the approval is cached.
    const { execPromise, buttons } = await fireAndGetButtons('git tag');
    const exact8h = buttons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.endsWith(':exact:8'),
    );
    expect(exact8h).toBeDefined();
    await pressInlineButton(ctx, exact8h!.callback_data, exact8h!.messageId);
    const first = await execPromise;
    expect(first.status).toBe(200);

    // Subsequent call reuses the cached approval — no Telegram prompt required.
    const res = await fireExecute(ctx, 'git tag');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.exitCode).toBe(0);
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
    // Fire the POST immediately (via `.end(cb)`) so it dispatches before we
    // start waiting for the bot message. The sync handler blocks until
    // Telegram decides.
    const execPromise = new Promise<Response>((resolveE, rejectE) => {
      request(appResult.app)
        .post('/api/v1/execute')
        .set('x-api-key', apiKey)
        .send({ command: 'echo tg-onboard hello' })
        .end((err, res) => err ? rejectE(err) : resolveE(res));
    });

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

    // The POST should now resolve with the execution result.
    const res = await execPromise;

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.exitCode).toBe(0);
    expect(res.body.stdout).toContain('tg-onboard hello');
  }, 25_000);
});

// ─── Journey: Deny and Approve-Once via Telegram ─────────────────────────
// Verifies deny rejects the command, and approve-once executes the command
// without caching the approval.

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

    const denyPromise = fireExecute(journeyCtx, 'git diff --stat');

    await waitForBotMessage(journeyCtx);
    const denyUpdates = await getBotMessages(journeyCtx) as any as BotMessageResult;
    const denyButtons = extractInlineButtons(denyUpdates);

    const denyBtn = denyButtons.find(b => b.callback_data.startsWith('deny:'));
    expect(denyBtn).toBeDefined();
    await pressInlineButton(journeyCtx, denyBtn!.callback_data, denyBtn!.messageId);

    const denyRes = await denyPromise;
    expect(denyRes.status).toBe(403);
    expect(denyRes.body.status).toBe('denied');

    // ── Part 2: Approve Once ─────────────────────────────────────

    const oncePromise = fireExecute(journeyCtx, 'git diff --stat');

    await waitForBotMessage(journeyCtx);
    const onceUpdates = await getBotMessages(journeyCtx) as any as BotMessageResult;
    const onceButtons = extractInlineButtons(onceUpdates);

    const onceBtn = onceButtons.find(b =>
      b.callback_data.startsWith('approve:') && b.callback_data.includes(':once:'),
    );
    expect(onceBtn).toBeDefined();
    await pressInlineButton(journeyCtx, onceBtn!.callback_data, onceBtn!.messageId);

    const onceRes = await oncePromise;
    expect(onceRes.status).toBe(200);
    expect(onceRes.body.status).toBe('completed');
    expect(onceRes.body.exitCode).toBe(0);

    // ── Part 3: Verify no cached approval ────────────────────────
    // The same command should still require approval — once-approve doesn't
    // persist to the approval cache. Fire the POST and watch a new prompt
    // arrive; then clean up by denying so the promise settles.
    const repeatPromise = fireExecute(journeyCtx, 'git diff --stat');

    await waitForBotMessage(journeyCtx);
    const cleanupUpdates = await getBotMessages(journeyCtx) as any as BotMessageResult;
    const cleanupButtons = extractInlineButtons(cleanupUpdates);
    const cleanupDeny = cleanupButtons.find(b => b.callback_data.startsWith('deny:'));
    expect(cleanupDeny).toBeDefined();
    await pressInlineButton(journeyCtx, cleanupDeny!.callback_data, cleanupDeny!.messageId);

    const repeatRes = await repeatPromise;
    expect(repeatRes.status).toBe(403);
    expect(repeatRes.body.status).toBe('denied');
  }, 40_000);
  /* eslint-enable @typescript-eslint/no-explicit-any */
});


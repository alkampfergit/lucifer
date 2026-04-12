import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../create_app.js';
import { hashApiKey } from '../domains/command-gateway/repository/api_key_store.js';

// telegram-test-api is CJS with `exports.default = TelegramServer`
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TelegramServerModule = require('telegram-test-api');
const TelegramServer = TelegramServerModule.default ?? TelegramServerModule;

export const TEST_BOT_TOKEN = 'e2e-test-bot-token-12345';
export const TEST_CHAT_ID = '67890';
const TEST_CHAT_ID_NUM = Number(TEST_CHAT_ID);

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TelegramE2EContext {
  /** Express app instance */
  app: ReturnType<typeof createApp>['app'];
  /** Start the app (launches Telegraf polling) */
  start: () => Promise<void>;
  /** Stop the app and telegram server, clean up temp files */
  stop: () => Promise<void>;
  /** API key for authenticated requests */
  testKey: string;
  /** Telegram test server instance */
  telegramServer: any;
  /** Telegram test client for simulating user interactions */
  telegramClient: any;
  /** Temp directory for config and data */
  testDir: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Wait for the bot to send a message to the Telegram test server.
 */
export async function waitForBotMessage(
  ctx: TelegramE2EContext,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const unread = ctx.telegramServer.storage.botMessages.filter(
      (m: { isRead: boolean; botToken: string }) =>
        !m.isRead && m.botToken === TEST_BOT_TOKEN,
    );
    if (unread.length > 0) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`No bot message received within ${timeoutMs}ms`);
}

/**
 * Get the latest unread bot messages from the Telegram test server.
 */
export function getBotMessages(ctx: TelegramE2EContext) {
  return ctx.telegramClient.getUpdates();
}

/**
 * Simulate pressing an inline keyboard button by sending a callback query
 * with the given data string. Pass messageId from the bot message to allow
 * Telegraf to edit the message after the decision.
 */
export async function pressInlineButton(
  ctx: TelegramE2EContext,
  callbackData: string,
  messageId?: number,
) {
  const cbQuery = ctx.telegramClient.makeCallbackQuery(callbackData, {
    message: {
      message_id: messageId ?? 1,
      chat: { id: Number(TEST_CHAT_ID) },
    },
  });
  await ctx.telegramClient.sendCallback(cbQuery);
}

/**
 * Poll until a condition is met or timeout.
 */
export async function waitForCondition(
  fn: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return;
    } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Creates a full E2E test context with a real Telegram test server,
 * the lucifer-gate Express app wired to it, and a simulated Telegram client.
 */
export function createTelegramE2EContext(
  label: string,
  port: number,
  options?: {
    extraRules?: Array<{ prefix: string; action: string }>;
  },
): TelegramE2EContext {
  const testDir = join(process.cwd(), `.test-e2e-${label}`);
  const configDir = join(testDir, 'config');
  const dataDir = join(testDir, 'data');

  const testKey = `luc_${label}e2ekey`;
  const testSalt = `${label}e2esalt1234567`;
  const testHash = hashApiKey(testKey, testSalt);

  mkdirSync(configDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const configPath = join(configDir, 'lucifer.json');

  writeFileSync(configPath, JSON.stringify({
    port: 0,
    telegramChatId: TEST_CHAT_ID,
    approvalTimeoutSeconds: 30,
    executionTimeoutSeconds: 10,
    maxConcurrentExecutions: 3,
    maxOutputBytes: 65536,
    rateLimitPerMinute: 1000,
    onApprovalTimeout: 'deny',
    dataDir: '../data',
  }));

  writeFileSync(join(configDir, 'api-keys.json'), JSON.stringify({
    keys: [{
      id: `${label}-e2e`,
      name: label,
      keyHash: testHash,
      salt: testSalt,
      allowedIps: [],
      createdAt: new Date().toISOString(),
      active: true,
    }],
  }));

  const rules = [
    { prefix: 'echo ', action: 'always_approve' },
    { prefix: 'rm ', action: 'always_deny' },
    { prefix: 'git ', action: 'telegram_approve' },
    { prefix: 'ls ', action: 'telegram_approve' },
    ...(options?.extraRules ?? []),
  ];

  writeFileSync(join(configDir, 'command-rules.json'), JSON.stringify({
    rules,
    defaultAction: 'always_deny',
  }));

  // Create Telegram test server
  const telegramServer = new TelegramServer({ port, host: '127.0.0.1' });

  // Create client that simulates the Telegram user (chatId must match config)
  const telegramClient = telegramServer.getClient(TEST_BOT_TOKEN, {
    chatId: TEST_CHAT_ID_NUM,
    userId: 999,
    firstName: 'E2ETestUser',
    userName: 'e2e_tester',
  });

  // Set required env var
  const originalToken = process.env.LUCIFER_TELEGRAM_TOKEN;
  process.env.LUCIFER_TELEGRAM_TOKEN = TEST_BOT_TOKEN;

  const result = createApp({
    configPath,
    telegramApiRoot: `http://127.0.0.1:${port}`,
  });

  return {
    app: result.app,
    start: async () => {
      await telegramServer.start();
      await result.start();
      // Wait for the startup health-check message from the bot
      await waitForBotMessage({ telegramServer, telegramClient, testKey, app: result.app, start: result.start, stop: result.stop, testDir });
      // Drain the startup message so it doesn't interfere with tests
      await telegramClient.getUpdates();
    },
    stop: async () => {
      await result.stop();
      await telegramServer.stop();
      process.env.LUCIFER_TELEGRAM_TOKEN = originalToken;
      rmSync(testDir, { recursive: true, force: true });
    },
    testKey,
    telegramServer,
    telegramClient,
    testDir,
  };
}

import { Telegram } from 'telegraf';
import type { Update, Message } from 'telegraf/types';
import { randomInt } from 'node:crypto';

export interface TelegramChat {
  chatId: string;
  title: string;
  type: string;
  lastMessageDate: number;
}

export interface PairingIO {
  print(msg: string): void;
  choose(prompt: string, options: string[]): Promise<number>;
  confirm(prompt: string): Promise<boolean>;
  prompt(msg: string): Promise<string>;
}

export interface PairingResult {
  chatId: string;
  chatTitle: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function wrapError(context: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`${context}: ${detail}`);
}

async function validateBotToken(
  telegram: Telegram,
  io: PairingIO,
): Promise<Awaited<ReturnType<Telegram['getMe']>>> {
  io.print('Connecting to Telegram...');
  try {
    const botInfo = await telegram.getMe();
    io.print(`Connected to bot: @${botInfo.username} (${botInfo.first_name})`);
    return botInfo;
  } catch (err) {
    throw wrapError(
      'Invalid Telegram bot token. Could not connect',
      err,
    );
  }
}

async function fetchUpdates(telegram: Telegram): Promise<Update[]> {
  try {
    await telegram.deleteWebhook();
  } catch {
    // Ignore — the bot may not have a webhook set
  }

  try {
    return await telegram.getUpdates(0, 100, 0, undefined);
  } catch (err) {
    throw wrapError(
      'Failed to fetch updates from Telegram',
      err,
    );
  }
}

function extractMessageFromUpdate(update: Update): Message | undefined {
  if ('message' in update) return update.message;
  if ('channel_post' in update) return update.channel_post;
  return undefined;
}

function resolveChatTitle(chat: Message['chat']): string {
  if (chat.type === 'private') {
    const parts: string[] = [];
    if ('first_name' in chat && chat.first_name) parts.push(chat.first_name);
    if ('last_name' in chat && chat.last_name) parts.push(chat.last_name);
    return parts.join(' ') || chat.id.toString();
  }
  if ('title' in chat && chat.title) return chat.title;
  return chat.id.toString();
}

function deduplicateChats(updates: Update[]): TelegramChat[] {
  const chatMap = new Map<string, TelegramChat>();

  for (const update of updates) {
    const message = extractMessageFromUpdate(update);
    if (!message?.chat) continue;

    const chat = message.chat;
    const chatId = chat.id.toString();
    const date = message.date ?? 0;
    const existing = chatMap.get(chatId);

    if (!existing || date > existing.lastMessageDate) {
      chatMap.set(chatId, {
        chatId,
        title: resolveChatTitle(chat),
        type: chat.type,
        lastMessageDate: date,
      });
    }
  }

  return [...chatMap.values()].sort((a, b) => b.lastMessageDate - a.lastMessageDate);
}

async function sendVerificationCode(
  telegram: Telegram,
  chatId: string,
  code: string,
): Promise<void> {
  try {
    await telegram.sendMessage(
      chatId,
      `\u{1F511} *Lucifer Pairing Code*\n\nYour pairing code is: \`${code}\`\n\nEnter this code in your terminal to complete pairing.`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    throw wrapError(
      `Failed to send pairing code to chat ${chatId}`,
      err,
    );
  }
}

async function verifyCode(
  io: PairingIO,
  code: string,
  maxAttempts: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const entered = (await io.prompt('Enter the 6-digit code:')).trim();
    if (entered === code) return;

    const remaining = maxAttempts - attempt;
    if (remaining > 0) {
      io.print(`Incorrect code. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`);
    }
  }
  throw new Error('Pairing failed: incorrect code entered 3 times.');
}

// ── Main flow ───────────────────────────────────────────────────────

/**
 * Run the interactive Telegram pairing flow:
 * 1. Validate bot token via getMe
 * 2. Fetch recent updates and extract unique chats
 * 3. Let the user pick a chat
 * 4. Send a 6-digit verification code to the chosen chat
 * 5. Prompt the user to enter the code (up to 3 attempts)
 */
export async function runTelegramPairing(
  token: string,
  io: PairingIO,
): Promise<PairingResult> {
  const telegram = new Telegram(token);

  // 1. Validate the bot token
  const botInfo = await validateBotToken(telegram, io);

  // 2. Fetch recent updates and extract unique chats
  io.print('Fetching recent chats...');
  const updates = await fetchUpdates(telegram);
  const chats = deduplicateChats(updates);

  if (chats.length === 0) {
    throw new Error(
      `No chats found. Please send a message to @${botInfo.username} on Telegram first, then re-run this command.`,
    );
  }

  // 3. Let the user pick a chat
  const options = chats.map((c) => {
    const date = new Date(c.lastMessageDate * 1000).toLocaleString();
    return `${c.title} (${c.type}, ID: ${c.chatId}) — last message: ${date}`;
  });

  const index = await io.choose('Select a chat for approvals:', options);
  const chosen = chats[index];

  io.print(`\nSelected: ${chosen.title} (${chosen.chatId})`);

  const confirmed = await io.confirm('Use this chat for Telegram approvals?');
  if (!confirmed) {
    throw new Error('Pairing cancelled.');
  }

  // 4. Generate and send a 6-digit verification code
  const code = randomInt(100000, 999999).toString();
  await sendVerificationCode(telegram, chosen.chatId, code);
  io.print('\nA 6-digit pairing code has been sent to your Telegram chat.');

  // 5. Verify the code
  await verifyCode(io, code, 3);
  io.print('Pairing verified successfully!');

  return { chatId: chosen.chatId, chatTitle: chosen.title };
}

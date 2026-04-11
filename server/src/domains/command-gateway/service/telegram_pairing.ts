import { Telegram } from 'telegraf';
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
  io.print('Connecting to Telegram...');
  let botInfo: Awaited<ReturnType<Telegram['getMe']>>;
  try {
    botInfo = await telegram.getMe();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid Telegram bot token. Could not connect: ${msg}\n` +
      'Check your LUCIFER_TELEGRAM_TOKEN environment variable.',
    );
  }
  io.print(`Connected to bot: @${botInfo.username} (${botInfo.first_name})`);

  // 2. Fetch recent updates and extract unique chats
  io.print('Fetching recent chats...');

  // Delete any active webhook first — getUpdates and webhooks are mutually exclusive
  try {
    await telegram.deleteWebhook();
  } catch {
    // Ignore — the bot may not have a webhook set
  }

  let updates: Awaited<ReturnType<Telegram['getUpdates']>>;
  try {
    updates = await telegram.getUpdates(0, 100, 0, undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch updates from Telegram: ${msg}\n` +
      'If the bot is in webhook mode, the webhook has been removed. Please retry.',
    );
  }

  // Deduplicate chats, keeping the most recent message date per chat
  const chatMap = new Map<string, TelegramChat>();
  for (const update of updates) {
    const message = 'message' in update ? update.message
      : 'channel_post' in update ? update.channel_post
      : undefined;
    if (!message?.chat) continue;

    const chat = message.chat;
    const chatId = chat.id.toString();
    const existing = chatMap.get(chatId);
    const date = message.date ?? 0;

    if (!existing || date > existing.lastMessageDate) {
      const title =
        chat.type === 'private'
          ? [('first_name' in chat ? chat.first_name : ''), ('last_name' in chat ? chat.last_name : '')].filter(Boolean).join(' ')
          : ('title' in chat ? chat.title : undefined) ?? chatId;

      chatMap.set(chatId, {
        chatId,
        title,
        type: chat.type,
        lastMessageDate: date,
      });
    }
  }

  const chats = [...chatMap.values()].sort((a, b) => b.lastMessageDate - a.lastMessageDate);

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

  try {
    await telegram.sendMessage(
      chosen.chatId,
      `🔑 *Lucifer Pairing Code*\n\nYour pairing code is: \`${code}\`\n\nEnter this code in your terminal to complete pairing.`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to send pairing code to chat ${chosen.chatId}: ${msg}\n` +
      'Make sure the bot can send messages to this chat.',
    );
  }

  io.print('\nA 6-digit pairing code has been sent to your Telegram chat.');

  // 5. Verify the code (up to 3 attempts)
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const entered = (await io.prompt('Enter the 6-digit code:')).trim();

    if (entered === code) {
      io.print('Pairing verified successfully!');
      return { chatId: chosen.chatId, chatTitle: chosen.title };
    }

    const remaining = maxAttempts - attempt;
    if (remaining > 0) {
      io.print(`Incorrect code. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`);
    }
  }

  throw new Error('Pairing failed: incorrect code entered 3 times.');
}

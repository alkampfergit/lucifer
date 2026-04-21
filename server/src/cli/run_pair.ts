import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runTelegramPairing } from '../domains/command-gateway/service/telegram_pairing.js';
import { getTelegramToken } from '../domains/command-gateway/config/gateway_config.js';
import { updateJsonConfig } from '../lib/json_config_writer.js';
import type { PairingIO } from '../domains/command-gateway/service/telegram_pairing.js';

function createReadlinePairingIO(): PairingIO & { close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return {
    print(msg: string) {
      console.log(msg);
    },

    async choose(prompt: string, options: string[]): Promise<number> {
      console.log(`\n${prompt}`);
      for (let i = 0; i < options.length; i++) {
        console.log(`  ${i + 1}. ${options[i]}`);
      }

      while (true) {
        const answer = await rl.question(`\nEnter number (1-${options.length}): `);
        const num = Number.parseInt(answer.trim(), 10);
        if (num >= 1 && num <= options.length) return num - 1;
        console.log(`Please enter a number between 1 and ${options.length}.`);
      }
    },

    async confirm(prompt: string): Promise<boolean> {
      const answer = await rl.question(`${prompt} [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    },

    async prompt(msg: string): Promise<string> {
      return rl.question(`${msg} `);
    },

    close() {
      rl.close();
    },
  };
}

export async function runPair(configPath: string) {
  const resolvedConfigPath = resolve(configPath);

  let token: string;
  try {
    token = getTelegramToken();
  } catch {
    console.error(
      'LUCIFER_TELEGRAM_TOKEN environment variable is required for pairing.\n' +
      'Create a bot via @BotFather on Telegram and set the token:\n\n' +
      '  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate pair',
    );
    process.exit(1);
  }

  const io = createReadlinePairingIO();
  try {
    const result = await runTelegramPairing(token, io, { waitForChats: true });
    updateJsonConfig(resolvedConfigPath, { telegramChatId: result.chatId });
    console.log(`\nChat ID ${result.chatId} saved to ${resolvedConfigPath}`);
    console.log('You can now start Lucifer without LUCIFER_TELEGRAM_CHAT_ID:');
    console.log(`\n  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate start --config ${resolvedConfigPath}`);
  } finally {
    io.close();
  }
}

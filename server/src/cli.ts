#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createApp } from './create_app.js';
import { generateApiKey, generateAdminSecret } from './domains/command-gateway/repository/api_key_store.js';
import { getDatabase } from './domains/command-gateway/repository/database.js';
import { createAuditLog } from './domains/command-gateway/repository/audit_log.js';
import { createApprovalStore } from './domains/command-gateway/repository/approval_store.js';
import { runTelegramPairing } from './domains/command-gateway/service/telegram_pairing.js';
import { redactApiKeyName } from './domains/command-gateway/service/redact_api_key_name.js';
import { getTelegramToken } from './domains/command-gateway/config/gateway_config.js';
import { updateJsonConfig } from './lib/json_config_writer.js';
import { logger } from './lib/logger.js';
import type { PairingIO } from './domains/command-gateway/service/telegram_pairing.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
lucifer-gate - AI Agent Command Firewall

Usage:
  lucifer-gate start [options]        Start the server (explicit form)
  lucifer-gate [options]              Start the server (implicit, same as 'start')
  lucifer-gate --init [dir]           Generate starter config files
  lucifer-gate pair [--config <path>] Pair a Telegram chat for approvals
  lucifer-gate log [--limit N]        Query audit log
  lucifer-gate stats                  Show approval statistics

Server options:
  --config <path>    Path to lucifer.json (default: ./config/lucifer.json)
  --port <number>    Server port (default: 3001, or PORT env var)
  --data-dir <path>  Directory for SQLite database (default: ./data)
  --auto-approve     Auto-approve all commands (dev mode, no Telegram needed)
  --help             Show this help

Environment variables:
  LUCIFER_TELEGRAM_TOKEN   Telegram bot token (required for production)
  LUCIFER_TELEGRAM_CHAT_ID Telegram chat ID for approvals (or use 'pair' command)
  PORT                     Server port (default: 3001)
  LOG_LEVEL                Log level: debug, info, warn, error (default: debug / info in production)
`);
}

function initConfig(targetDir: string) {
  const configDir = resolve(targetDir, 'config');
  const dataDir = resolve(targetDir, 'data');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const luciferJsonPath = join(configDir, 'lucifer.json');
  const apiKeysPath = join(configDir, 'api-keys.json');
  const commandRulesPath = join(configDir, 'command-rules.json');
  const proxyConfigPath = join(configDir, 'proxy-config.json');

  if (existsSync(luciferJsonPath)) {
    console.log(`Config already exists: ${luciferJsonPath}`);
    console.log('Delete it first if you want to regenerate.');
    return;
  }

  const { key, salt, keyHash } = generateApiKey();
  const { secret: adminSecret, salt: adminSalt, secretHash: adminHash } = generateAdminSecret();

  writeFileSync(luciferJsonPath, JSON.stringify({
    port: 3001,
    adminSecretHash: adminHash,
    adminSecretSalt: adminSalt,
    approvalTimeoutSeconds: 300,
    executionTimeoutSeconds: 120,
    maxConcurrentExecutions: 5,
    maxOutputBytes: 10485760,
    rateLimitPerMinute: 10,
    onApprovalTimeout: 'deny',
    dataDir: '../data',
    logFile: 'lucifer.log',
  }, null, 2) + '\n');

  writeFileSync(apiKeysPath, JSON.stringify({
    keys: [{
      id: crypto.randomUUID(),
      name: 'default',
      keyHash,
      salt,
      allowedIps: [],
      createdAt: new Date().toISOString(),
      active: true,
    }],
  }, null, 2) + '\n');

  writeFileSync(commandRulesPath, JSON.stringify({
    rules: [
      { prefix: 'echo ', action: 'always_approve' },
      { prefix: 'git status', action: 'always_approve' },
      { prefix: 'git pull', action: 'manual_approve' },
      { prefix: 'git push', action: 'manual_approve' },
      { prefix: 'npm test', action: 'always_approve' },
      { prefix: 'npm run', action: 'manual_approve' },
      { prefix: 'rm ', action: 'always_deny' },
    ],
    defaultAction: 'always_deny',
  }, null, 2) + '\n');

  writeFileSync(proxyConfigPath, JSON.stringify({
    proxies: [],
  }, null, 2) + '\n');

  console.log('Config files generated:');
  console.log(`  ${luciferJsonPath}`);
  console.log(`  ${apiKeysPath}`);
  console.log(`  ${commandRulesPath}`);
  console.log(`  ${proxyConfigPath}`);
  console.log('');
  console.log('Your API key (save this, it cannot be recovered):');
  console.log(`  ${key}`);
  console.log('');
  console.log('Your admin secret for the web approval UI (save this, it cannot be recovered):');
  console.log(`  ${adminSecret}`);
  console.log('');
  console.log('Quick start:');
  console.log('  # Dev mode (no Telegram needed):');
  console.log(`  LUCIFER_TELEGRAM_TOKEN=skip lucifer-gate --config ${luciferJsonPath} --auto-approve`);
  console.log('');
  console.log('  # Production — pair your Telegram chat first:');
  console.log(`  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate pair --config ${luciferJsonPath}`);
  console.log('');
  console.log('  # Then start the server:');
  console.log(`  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate --config ${luciferJsonPath}`);
}

async function runLog(limit: number) {
  const dataDir = getArgValue('--data-dir') ?? './data';
  const db = getDatabase(dataDir);
  const auditLog = createAuditLog(db);
  const entries = auditLog.query(limit);

  if (entries.length === 0) {
    console.log('No audit log entries found.');
    return;
  }

  const reversed = [...entries].reverse();
  for (const entry of reversed) {
    const time = entry.ts.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
    const parts = [time, entry.type.toUpperCase().padEnd(16)];
    if (entry.command) parts.push(entry.command);
    if (entry.apiKeyName) parts.push(`key=${redactApiKeyName(entry.apiKeyName)}`);
    if (entry.exitCode !== undefined && entry.exitCode !== null) parts.push(`exit=${entry.exitCode}`);
    if (entry.durationMs !== undefined && entry.durationMs !== null) parts.push(`${entry.durationMs}ms`);
    if (entry.error) parts.push(`error: ${entry.error}`);
    console.log(parts.join('  '));
  }
}

async function runStats() {
  const dataDir = getArgValue('--data-dir') ?? './data';
  const db = getDatabase(dataDir);
  const auditLog = createAuditLog(db);
  const approvalStore = createApprovalStore(db);

  const allEntries = auditLog.query(10000);
  const requests = allEntries.filter(e => e.type === 'request');
  const approvals = allEntries.filter(e => e.type === 'approved');
  const denials = allEntries.filter(e => e.type === 'denied');
  const executions = allEntries.filter(e => e.type === 'executed');

  const activeApprovals = approvalStore.listAll(10000);
  const expired = activeApprovals.filter(a => a.expiresAt && new Date(a.expiresAt) < new Date());

  console.log('Lucifer Stats');
  console.log('=============');
  console.log(`Total requests:     ${requests.length}`);
  console.log(`Approved:           ${approvals.length}`);
  console.log(`Denied:             ${denials.length}`);
  console.log(`Executed:           ${executions.length}`);
  console.log(`Active approvals:   ${activeApprovals.length - expired.length}`);
  console.log(`Expired approvals:  ${expired.length}`);

  if (executions.length > 0) {
    const durations = executions.filter(e => e.durationMs != null).map(e => e.durationMs!);
    if (durations.length > 0) {
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      const max = Math.max(...durations);
      console.log(`Avg exec time:      ${avg}ms`);
      console.log(`Max exec time:      ${max}ms`);
    }
  }

  // Top commands
  const cmdCounts = new Map<string, number>();
  for (const r of requests) {
    if (r.command) {
      const cmd = r.command.split(/\s+/).slice(0, 2).join(' ');
      cmdCounts.set(cmd, (cmdCounts.get(cmd) ?? 0) + 1);
    }
  }
  const topCmds = [...cmdCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topCmds.length > 0) {
    console.log('\nTop commands:');
    for (const [cmd, count] of topCmds) {
      console.log(`  ${count.toString().padStart(5)}  ${cmd}`);
    }
  }
}

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

async function runPair() {
  const configPath = resolve(getArgValue('--config') ?? './config/lucifer.json');

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
    updateJsonConfig(configPath, { telegramChatId: result.chatId });
    console.log(`\nChat ID ${result.chatId} saved to ${configPath}`);
    console.log('You can now start Lucifer without LUCIFER_TELEGRAM_CHAT_ID:');
    console.log(`\n  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate start --config ${configPath}`);
  } finally {
    io.close();
  }
}

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx >= args.length - 1) return undefined;
  return args[idx + 1];
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args[0] === '--init' || args[0] === 'init') {
    const dir = args[1] ?? '.';
    initConfig(dir);
    process.exit(0);
  }

  if (args[0] === 'pair') {
    await runPair();
    process.exit(0);
  }

  if (args[0] === 'log') {
    const limitStr = getArgValue('--limit');
    await runLog(limitStr ? parseInt(limitStr, 10) : 50);
    process.exit(0);
  }

  if (args[0] === 'stats') {
    await runStats();
    process.exit(0);
  }

  // Server mode — either `start` (explicit) or no subcommand (implicit).
  // Any stray unrecognised positional is treated as an error to avoid
  // silently starting the server when the user meant a subcommand.
  const first = args[0];
  if (first && first !== 'start' && !first.startsWith('-')) {
    console.error(`Unknown command: ${first}`);
    console.error(`Run 'lucifer-gate --help' for usage.`);
    process.exit(1);
  }

  const configPath = getArgValue('--config') ?? './config/lucifer.json';
  const port = getArgValue('--port');
  const autoApprove = args.includes('--auto-approve');

  if (port) {
    process.env.PORT = port;
  }

  const { app, config, start, stop } = createApp({
    configPath,
    autoApprove,
  });

  const server = app.listen(config.port, async () => {
    logger.info({ port: config.port, autoApprove }, 'Lucifer listening');
    await start();
  });

  const shutdown = async () => {
    logger.info('Shutting down');
    await stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  await main();
} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}

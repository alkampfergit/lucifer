import { resolve } from 'node:path';
import type { LuciferConfig } from '../types/command_types.js';
import { loadJsonConfig } from '../../../lib/json_config_loader.js';

function isLuciferConfig(data: unknown): data is LuciferConfig {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.port !== 'undefined' && typeof d.port !== 'number') return false;
  if (typeof d.approvalTimeoutSeconds !== 'undefined' && typeof d.approvalTimeoutSeconds !== 'number') return false;
  if (typeof d.executionTimeoutSeconds !== 'undefined' && typeof d.executionTimeoutSeconds !== 'number') return false;
  if (typeof d.maxConcurrentExecutions !== 'undefined' && typeof d.maxConcurrentExecutions !== 'number') return false;
  if (typeof d.maxOutputBytes !== 'undefined' && typeof d.maxOutputBytes !== 'number') return false;
  if (typeof d.rateLimitPerMinute !== 'undefined' && typeof d.rateLimitPerMinute !== 'number') return false;
  if (typeof d.onApprovalTimeout !== 'undefined' && d.onApprovalTimeout !== 'deny' && d.onApprovalTimeout !== 'approve-with-warning') return false;
  if (typeof d.dataDir !== 'undefined' && typeof d.dataDir !== 'string') return false;
  return true;
}

const defaults: LuciferConfig = {
  port: Number(process.env.PORT) || 3001,
  telegramChatId: process.env.LUCIFER_TELEGRAM_CHAT_ID,
  approvalTimeoutSeconds: 300,
  executionTimeoutSeconds: 120,
  maxConcurrentExecutions: 5,
  maxOutputBytes: 10 * 1024 * 1024,
  rateLimitPerMinute: 10,
  onApprovalTimeout: 'deny',
  dataDir: './data',
};

export function loadGatewayConfig(configPath?: string): LuciferConfig {
  if (!configPath) {
    return { ...defaults };
  }

  const resolvedPath = resolve(configPath);
  const loaded = loadJsonConfig(resolvedPath, isLuciferConfig);

  return {
    ...defaults,
    ...loaded,
    port: loaded.port ?? defaults.port,
    dataDir: loaded.dataDir ?? defaults.dataDir,
  };
}

export function getTelegramToken(): string {
  const token = process.env.LUCIFER_TELEGRAM_TOKEN;
  if (!token) {
    throw new Error(
      'LUCIFER_TELEGRAM_TOKEN environment variable is required. ' +
      'Create a bot via @BotFather on Telegram and set the token.',
    );
  }
  return token;
}

export function getAdminSecret(): string | undefined {
  return process.env.LUCIFER_ADMIN_SECRET;
}

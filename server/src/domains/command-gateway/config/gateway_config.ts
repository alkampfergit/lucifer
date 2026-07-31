import { dirname, resolve } from 'node:path';
import type { AliasesConfig, LuciferConfig } from '../types/command_types.js';
import { loadJsonConfig } from '../../../lib/json_config_loader.js';

function checkOptionalType(d: Record<string, unknown>, key: string, expectedType: string): boolean {
  return d[key] === undefined || typeof d[key] === expectedType;
}

function isAliasesConfig(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string' || e.path.length === 0) return false;
    if (e.type !== 'bash' && e.type !== 'elf') return false;
    if (e.args !== undefined && (!Array.isArray(e.args) || !e.args.every((a) => typeof a === 'string'))) return false;
    if (e.allowArgs !== undefined && typeof e.allowArgs !== 'boolean') return false;
  }
  return true;
}

const optionalNumberKeys = [
  'port', 'approvalTimeoutSeconds', 'executionTimeoutSeconds',
  'maxConcurrentExecutions', 'maxOutputBytes', 'rateLimitPerMinute',
  'rateLimitPerIpPerMinute', 'rateLimitPerKeyPerMinute',
] as const;

const optionalStringKeys = [
  'dataDir', 'telegramChatId', 'adminSecretHash', 'adminSecretSalt', 'logFile',
] as const;

function isToolsPath(value: unknown): boolean {
  return Array.isArray(value) && value.every((p) => typeof p === 'string' && p.length > 0);
}

function isLuciferConfig(data: unknown): data is LuciferConfig {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;

  const numbersValid = optionalNumberKeys.every((k) => checkOptionalType(d, k, 'number'));
  const stringsValid = optionalStringKeys.every((k) => checkOptionalType(d, k, 'string'));
  if (!numbersValid || !stringsValid) return false;

  if (d.onApprovalTimeout !== undefined && d.onApprovalTimeout !== 'deny' && d.onApprovalTimeout !== 'approve-with-warning') return false;
  if (d.aliases !== undefined && !isAliasesConfig(d.aliases)) return false;
  if (d.toolsPath !== undefined && !isToolsPath(d.toolsPath)) return false;
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

/**
 * Resolve each alias `path` against the config file's directory so relative
 * paths in `lucifer.json` are stable regardless of the daemon's working
 * directory. Absolute paths are returned unchanged.
 */
function normalizeAliasPaths(aliases: AliasesConfig, configDir: string): AliasesConfig {
  const out: AliasesConfig = {};
  for (const [name, alias] of Object.entries(aliases)) {
    out[name] = { ...alias, path: resolve(configDir, alias.path) };
  }
  return out;
}

/**
 * Resolve each `toolsPath` entry against the config file's directory, same
 * rationale as `normalizeAliasPaths`. Absolute entries are returned unchanged.
 */
function normalizeToolsPath(toolsPath: string[], configDir: string): string[] {
  return toolsPath.map((p) => resolve(configDir, p));
}

export function loadGatewayConfig(configPath?: string): LuciferConfig {
  if (!configPath) {
    return { ...defaults };
  }

  const resolvedPath = resolve(configPath);
  const loaded = loadJsonConfig(resolvedPath, isLuciferConfig);
  const configDir = dirname(resolvedPath);

  const result: LuciferConfig = {
    ...defaults,
    ...loaded,
    port: loaded.port ?? defaults.port,
    dataDir: loaded.dataDir ?? defaults.dataDir,
  };
  // Only set `aliases`/`toolsPath` when present so the config shape for
  // projects that don't use them stays identical to pre-feature behavior.
  if (loaded.aliases) {
    result.aliases = normalizeAliasPaths(loaded.aliases, configDir);
  }
  if (loaded.toolsPath) {
    result.toolsPath = normalizeToolsPath(loaded.toolsPath, configDir);
  }
  return result;
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

/** @deprecated Admin secret is now stored as a hash in lucifer.json. Use config.adminSecretHash instead. */
export function getAdminSecret(): string | undefined {
  return process.env.LUCIFER_ADMIN_SECRET;
}

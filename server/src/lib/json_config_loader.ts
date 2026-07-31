import { readFileSync } from 'node:fs';
import { createChildLogger } from './logger.js';

const log = createChildLogger('config-loader');

export function loadJsonConfig<T>(filePath: string, validate: (data: unknown) => data is T): T {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const backupPath = filePath + '.bak';
    log.warn({ filePath, backupPath, err }, 'Failed to read config, trying backup');
    try {
      raw = readFileSync(backupPath, 'utf-8');
    } catch {
      throw new Error(`Cannot read config file: ${filePath} (backup also missing)`);
    }
  }

  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutBom);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config file: ${filePath} (${reason})`);
  }

  if (!validate(parsed)) {
    throw new Error(`Config file failed validation: ${filePath}`);
  }

  return parsed;
}

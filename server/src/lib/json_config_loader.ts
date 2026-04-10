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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${filePath}`);
  }

  if (!validate(parsed)) {
    throw new Error(`Config file failed validation: ${filePath}`);
  }

  return parsed;
}

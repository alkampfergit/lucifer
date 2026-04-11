import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Read-modify-write a JSON config file, merging the given updates
 * into the existing object. Only top-level keys are merged (shallow).
 */
export function updateJsonConfig(filePath: string, updates: Record<string, unknown>): void {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Config file not found: ${filePath}. Run \`lucifer-gate --init\` first.`);
    }
    throw new Error(`Cannot read config file: ${filePath} (${code})`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in config file: ${filePath}`);
  }

  const merged = { ...parsed, ...updates };
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
}

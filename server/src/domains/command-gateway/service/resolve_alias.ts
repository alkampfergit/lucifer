import { dirname, resolve as resolvePath } from 'node:path';
import type { AliasesConfig } from '../types/command_types.js';

/**
 * A command that has been resolved to an on-disk alias.
 *
 * `spawnCommand` and `spawnArgs` are intended for `child_process.spawn` with
 * `shell: false`, which bypasses any shell interpretation of the path.
 * `cwd` is the alias script's parent directory.
 */
export interface ResolvedAlias {
  spawnCommand: string;
  spawnArgs: string[];
  cwd: string;
}

/**
 * Look up the given command in the aliases config. Exact match on the full
 * command string. Returns null when no alias matches (or no aliases are
 * configured), which signals the caller to fall back to normal shell
 * execution.
 */
export function resolveAlias(
  command: string,
  aliases: AliasesConfig | undefined,
): ResolvedAlias | null {
  if (!aliases) return null;
  const alias = aliases[command];
  if (!alias) return null;

  const absolutePath = resolvePath(alias.path);
  const cwd = dirname(absolutePath);

  if (alias.type === 'bash') {
    return { spawnCommand: 'bash', spawnArgs: [absolutePath], cwd };
  }
  // 'elf': execute the file directly
  return { spawnCommand: absolutePath, spawnArgs: [], cwd };
}

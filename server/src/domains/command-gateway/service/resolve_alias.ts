import { dirname, resolve as resolvePath } from 'node:path';
import type { AliasesConfig, AliasType } from '../types/command_types.js';

/**
 * A command that has been resolved to an on-disk alias.
 *
 * `spawnCommand` and `spawnArgs` are intended for `child_process.spawn` with
 * `shell: false`, which bypasses any shell interpretation of the path.
 * `cwd` is the alias script's parent directory. `path` and `type` carry the
 * original alias metadata so callers can include them in audit entries.
 */
export interface ResolvedAlias {
  path: string;
  type: AliasType;
  spawnCommand: string;
  spawnArgs: string[];
  cwd: string;
}

/**
 * Look up the given command in the aliases config. Exact match on the trimmed
 * command string. Returns null when no alias matches (or no aliases are
 * configured), which signals the caller to fall back to normal shell
 * execution. `Object.hasOwn` guards against matching prototype properties
 * like `constructor` or `toString`.
 */
export function resolveAlias(
  command: string,
  aliases: AliasesConfig | undefined,
): ResolvedAlias | null {
  if (!aliases) return null;
  const key = command.trim();
  if (!Object.hasOwn(aliases, key)) return null;
  const alias = aliases[key];

  const absolutePath = resolvePath(alias.path);
  const cwd = dirname(absolutePath);

  if (alias.type === 'bash') {
    // `--` ends bash option parsing so a script path can never be
    // misinterpreted as a flag. `resolvePath` always returns an absolute path,
    // which makes this defense-in-depth rather than load-bearing, but cheap.
    return {
      path: absolutePath,
      type: 'bash',
      spawnCommand: 'bash',
      spawnArgs: ['--', absolutePath],
      cwd,
    };
  }
  // 'elf': execute the file directly
  return {
    path: absolutePath,
    type: 'elf',
    spawnCommand: absolutePath,
    spawnArgs: [],
    cwd,
  };
}

// The leading run of identifier-like characters. Anything that a shell would
// treat as a word terminator (whitespace, `;`, `|`, `&`, `<`, `>`, `$`,
// backtick, quote, paren, backslash, newline) is not matched, so a caller
// cannot smuggle shell metacharacters into the first word.
const ALIAS_NAME_PREFIX = /^[A-Za-z0-9_.-]+/;

/**
 * Detect whether a caller's command targets a configured alias but contains
 * additional arguments or shell metacharacters beyond the alias name. Used by
 * the route layer to refuse such requests outright.
 *
 * Without this check, a caller could bypass the alias's shell-free execution
 * guarantee by sending `"<aliasName> --arg"` or `"<aliasName>; rm -rf /"`:
 * exact alias resolution would fail, the command would fall through to the
 * shell, and any prefix-based command rule matching the alias name would
 * still grant approval. This function exposes the offending alias name so the
 * route can audit and return a precise error code.
 *
 * Returns the alias name when a bypass is detected, or null otherwise.
 */
export function findAliasArgsBypass(
  command: string,
  aliases: AliasesConfig | undefined,
): string | null {
  if (!aliases) return null;
  const trimmed = command.trim();
  const match = ALIAS_NAME_PREFIX.exec(trimmed);
  const firstWord = match?.[0];
  if (!firstWord) return null;
  if (!Object.hasOwn(aliases, firstWord)) return null;
  if (trimmed === firstWord) return null; // exact invocation, not a bypass
  return firstWord;
}

import { describe, it, expect } from 'vitest';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import type { AliasesConfig } from '../types/command_types.js';
import { findAliasArgsBypass, resolveAlias } from './resolve_alias.js';

/** Base directory for fixture paths so tests avoid hard-coded /tmp literals. */
const fixtureDir = join(tmpdir(), 'scripts');
const fixtureBuildSh = join(fixtureDir, 'build.sh');

describe('resolveAlias', () => {
  it('returns null when aliases is undefined', () => {
    expect(resolveAlias('anything', undefined)).toBeNull();
  });

  it('returns null when no alias matches the command', () => {
    const aliases: AliasesConfig = {
      build: { path: fixtureBuildSh, type: 'bash' },
    };
    expect(resolveAlias('deploy', aliases)).toBeNull();
  });

  it('resolves a bash alias to bash + script path with parent dir as cwd', () => {
    const aliases: AliasesConfig = {
      build: { path: fixtureBuildSh, type: 'bash' },
    };
    const resolved = resolveAlias('build', aliases);
    expect(resolved).not.toBeNull();
    expect(resolved?.path).toBe(fixtureBuildSh);
    expect(resolved?.type).toBe('bash');
    expect(resolved?.spawnCommand).toBe('bash');
    // `--` ends bash option parsing so a path-looking-like-a-flag can never
    // be misinterpreted as an option.
    expect(resolved?.spawnArgs).toEqual(['--', fixtureBuildSh]);
    expect(resolved?.cwd).toBe(fixtureDir);
  });

  it('resolves an elf alias to a direct exec with parent dir as cwd', () => {
    const aliases: AliasesConfig = {
      hello: { path: '/opt/bin/hello', type: 'elf' },
    };
    const resolved = resolveAlias('hello', aliases);
    expect(resolved).not.toBeNull();
    expect(resolved?.path).toBe('/opt/bin/hello');
    expect(resolved?.type).toBe('elf');
    expect(resolved?.spawnCommand).toBe('/opt/bin/hello');
    expect(resolved?.spawnArgs).toEqual([]);
    expect(resolved?.cwd).toBe('/opt/bin');
  });

  it('resolves a relative alias path against the current working directory', () => {
    const aliases: AliasesConfig = {
      local: { path: 'scripts/local.sh', type: 'bash' },
    };
    const resolved = resolveAlias('local', aliases);
    const expectedPath = resolvePath('scripts/local.sh');
    expect(resolved?.path).toBe(expectedPath);
    expect(resolved?.spawnArgs).toEqual(['--', expectedPath]);
    expect(resolved?.cwd).toBe(dirname(expectedPath));
  });

  it('does not match when the command has extra tokens', () => {
    // Exact-string match; "build --verbose" is not the alias "build".
    const aliases: AliasesConfig = {
      build: { path: fixtureBuildSh, type: 'bash' },
    };
    expect(resolveAlias('build --verbose', aliases)).toBeNull();
  });

  it('tolerates leading/trailing whitespace on the command', () => {
    const aliases: AliasesConfig = {
      build: { path: fixtureBuildSh, type: 'bash' },
    };
    expect(resolveAlias('  build  ', aliases)).not.toBeNull();
  });

  it('does not match prototype properties like "constructor" or "toString"', () => {
    // Without an own-property guard `aliases['constructor']` would return
    // Object's constructor and crash the alias spawn.
    const aliases: AliasesConfig = {
      build: { path: fixtureBuildSh, type: 'bash' },
    };
    expect(resolveAlias('constructor', aliases)).toBeNull();
    expect(resolveAlias('toString', aliases)).toBeNull();
  });

  it('appends configured fixed args after the script path for a bash alias', () => {
    const aliases: AliasesConfig = {
      build: { path: fixtureBuildSh, type: 'bash', args: ['--release', '--verbose'] },
    };
    const resolved = resolveAlias('build', aliases);
    expect(resolved?.spawnArgs).toEqual(['--', fixtureBuildSh, '--release', '--verbose']);
  });

  it('passes configured fixed args directly for an elf alias', () => {
    const aliases: AliasesConfig = {
      hello: { path: '/opt/bin/hello', type: 'elf', args: ['summary'] },
    };
    const resolved = resolveAlias('hello', aliases);
    expect(resolved?.spawnArgs).toEqual(['summary']);
  });

  it('defaults to no args when args is not configured', () => {
    const aliases: AliasesConfig = {
      hello: { path: '/opt/bin/hello', type: 'elf' },
    };
    const resolved = resolveAlias('hello', aliases);
    expect(resolved?.spawnArgs).toEqual([]);
  });

  it('still requires an exact command match when args are configured but allowArgs is not set', () => {
    const aliases: AliasesConfig = {
      hello: { path: '/opt/bin/hello', type: 'elf', args: ['summary'] },
    };
    expect(resolveAlias('hello extra', aliases)).toBeNull();
  });

  describe('allowArgs', () => {
    it('tokenizes and appends caller-supplied arguments after any fixed args', () => {
      const aliases: AliasesConfig = {
        smtp: { path: '/opt/bin/smtp', type: 'elf', args: ['summary'], allowArgs: true },
      };
      const resolved = resolveAlias('smtp --unread --limit 10', aliases);
      expect(resolved?.spawnArgs).toEqual(['summary', '--unread', '--limit', '10']);
      expect(resolved?.cwd).toBe(dirname(resolvePath('/opt/bin/smtp')));
    });

    it('still resolves the exact-name invocation with no caller args', () => {
      const aliases: AliasesConfig = {
        smtp: { path: '/opt/bin/smtp', type: 'elf', args: ['summary'], allowArgs: true },
      };
      const resolved = resolveAlias('smtp', aliases);
      expect(resolved?.spawnArgs).toEqual(['summary']);
    });

    it('collapses repeated whitespace between caller arguments', () => {
      const aliases: AliasesConfig = {
        smtp: { path: '/opt/bin/smtp', type: 'elf', allowArgs: true },
      };
      const resolved = resolveAlias('smtp   --unread   now', aliases);
      expect(resolved?.spawnArgs).toEqual(['--unread', 'now']);
    });

    it('does not match a longer word starting with the alias name', () => {
      const aliases: AliasesConfig = {
        smtp: { path: '/opt/bin/smtp', type: 'elf', allowArgs: true },
      };
      expect(resolveAlias('smtptool --unread', aliases)).toBeNull();
    });

    it('does not treat shell-metacharacter smuggling as an args invocation', () => {
      const aliases: AliasesConfig = {
        smtp: { path: '/opt/bin/smtp', type: 'elf', allowArgs: true },
      };
      // No whitespace immediately after the alias name: not a valid
      // "<name> <args>" invocation, so it does not resolve at all.
      expect(resolveAlias('smtp;rm -rf /', aliases)).toBeNull();
    });

    it('places caller arguments after the script path for a bash alias', () => {
      const aliases: AliasesConfig = {
        build: { path: fixtureBuildSh, type: 'bash', allowArgs: true },
      };
      const resolved = resolveAlias('build --release', aliases);
      expect(resolved?.spawnArgs).toEqual(['--', fixtureBuildSh, '--release']);
    });
  });
});

describe('findAliasArgsBypass', () => {
  const aliases: AliasesConfig = {
    deploy: { path: '/opt/deploy.sh', type: 'bash' },
  };

  it('returns null when aliases is undefined', () => {
    expect(findAliasArgsBypass('deploy --dry-run', undefined)).toBeNull();
  });

  it('returns null when the first word is not a configured alias', () => {
    expect(findAliasArgsBypass('echo hi', aliases)).toBeNull();
  });

  it('returns null for an exact alias invocation', () => {
    expect(findAliasArgsBypass('deploy', aliases)).toBeNull();
  });

  it('returns null for an exact alias invocation with surrounding whitespace', () => {
    expect(findAliasArgsBypass('  deploy  ', aliases)).toBeNull();
  });

  it('flags "<alias> --arg" as a bypass', () => {
    expect(findAliasArgsBypass('deploy --dry-run', aliases)).toBe('deploy');
  });

  it('flags shell-metacharacter smuggling that starts with an alias name', () => {
    expect(findAliasArgsBypass('deploy; rm -rf /', aliases)).toBe('deploy');
    expect(findAliasArgsBypass('deploy|cat /etc/passwd', aliases)).toBe('deploy');
    expect(findAliasArgsBypass('deploy$(whoami)', aliases)).toBe('deploy');
    expect(findAliasArgsBypass('deploy`id`', aliases)).toBe('deploy');
  });

  it('does not false-positive on a longer alphanumeric word starting with the alias name', () => {
    // `deployment-status` is a different word, not the alias `deploy` followed
    // by an argument. The leading-identifier regex captures the whole word.
    expect(findAliasArgsBypass('deployment-status', aliases)).toBeNull();
  });

  it('does not match prototype properties', () => {
    expect(findAliasArgsBypass('constructor --arg', aliases)).toBeNull();
  });

  describe('with allowArgs: true', () => {
    const allowArgsAliases: AliasesConfig = {
      smtp: { path: '/opt/bin/smtp', type: 'elf', allowArgs: true },
    };

    it('does not flag a legitimate "<alias> <args>" invocation', () => {
      expect(findAliasArgsBypass('smtp --unread', allowArgsAliases)).toBeNull();
    });

    it('still flags shell-metacharacter smuggling with no whitespace boundary', () => {
      expect(findAliasArgsBypass('smtp;rm -rf /', allowArgsAliases)).toBe('smtp');
      expect(findAliasArgsBypass('smtp$(whoami)', allowArgsAliases)).toBe('smtp');
    });
  });
});

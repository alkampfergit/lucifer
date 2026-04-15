import { describe, it, expect } from 'vitest';
import { dirname, resolve as resolvePath } from 'node:path';
import type { AliasesConfig } from '../types/command_types.js';
import { resolveAlias } from './resolve_alias.js';

describe('resolveAlias', () => {
  it('returns null when aliases is undefined', () => {
    expect(resolveAlias('anything', undefined)).toBeNull();
  });

  it('returns null when no alias matches the command', () => {
    const aliases: AliasesConfig = {
      build: { path: '/tmp/scripts/build.sh', type: 'bash' },
    };
    expect(resolveAlias('deploy', aliases)).toBeNull();
  });

  it('resolves a bash alias to bash + script path with parent dir as cwd', () => {
    const aliases: AliasesConfig = {
      build: { path: '/tmp/scripts/build.sh', type: 'bash' },
    };
    const resolved = resolveAlias('build', aliases);
    expect(resolved).not.toBeNull();
    expect(resolved?.spawnCommand).toBe('bash');
    expect(resolved?.spawnArgs).toEqual(['/tmp/scripts/build.sh']);
    expect(resolved?.cwd).toBe('/tmp/scripts');
  });

  it('resolves an elf alias to a direct exec with parent dir as cwd', () => {
    const aliases: AliasesConfig = {
      hello: { path: '/opt/bin/hello', type: 'elf' },
    };
    const resolved = resolveAlias('hello', aliases);
    expect(resolved).not.toBeNull();
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
    expect(resolved?.spawnArgs).toEqual([expectedPath]);
    expect(resolved?.cwd).toBe(dirname(expectedPath));
  });

  it('does not match when the command has extra tokens', () => {
    // v1 is exact-string match; "build --verbose" is not the alias "build".
    const aliases: AliasesConfig = {
      build: { path: '/tmp/scripts/build.sh', type: 'bash' },
    };
    expect(resolveAlias('build --verbose', aliases)).toBeNull();
  });
});

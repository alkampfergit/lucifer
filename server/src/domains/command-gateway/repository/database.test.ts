import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDatabase, closeDatabase } from './database.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lucifer-db-'));
}

/** Permission bits only, as an octal string like `600`. */
function mode(filePath: string): string {
  return (statSync(filePath).mode & 0o777).toString(8);
}

describe('getDatabase', () => {
  const dirs: string[] = [];

  afterEach(() => {
    closeDatabase();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function open(): string {
    const dir = createTempDir();
    dirs.push(dir);
    getDatabase(dir);
    return join(dir, 'lucifer.db');
  }

  it('getDatabase_newDatabase_restrictsTheMainFileToOwnerOnly', () => {
    expect(mode(open())).toBe('600');
  });

  // `server_secrets` holds the admin session sealing key, and in WAL mode every
  // write lands in `-wal` before the main file. A sidecar left at the ambient
  // umask (0644 by default) would hand that key to any other local user no
  // matter how tight `lucifer.db` itself is.
  it.each(['-wal', '-shm'])('getDatabase_newDatabase_restrictsThe%sSidecarToOwnerOnly', (suffix) => {
    expect(mode(`${open()}${suffix}`)).toBe('600');
  });

  it('getDatabase_newDatabase_isInWalModeSoTheSidecarsExistAtAll', () => {
    const dir = createTempDir();
    dirs.push(dir);

    expect(getDatabase(dir).pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('getDatabase_calledTwiceForTheSameProcess_returnsTheSameHandle', () => {
    const dir = createTempDir();
    dirs.push(dir);

    expect(getDatabase(dir)).toBe(getDatabase(dir));
  });
});

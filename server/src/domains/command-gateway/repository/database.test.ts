import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
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

// Windows has no POSIX mode: `chmod` there only toggles the read-only flag, so
// a file asked for `0600` still reads back as `666`. `restrictToOwner` is
// documented as best-effort for exactly that reason, so the owner-only
// assertions below are a POSIX contract. What Windows *can* be held to — that
// an unenforceable mode degrades instead of failing the open — is pinned by
// `getDatabase_platformWithoutPosixModes_stillOpens` at the end of this block.
const HAS_POSIX_MODES = process.platform !== 'win32';

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

  it.skipIf(!HAS_POSIX_MODES)('getDatabase_newDatabase_restrictsTheMainFileToOwnerOnly', () => {
    expect(mode(open())).toBe('600');
  });

  // `server_secrets` holds the admin session sealing key, and in WAL mode every
  // write lands in `-wal` before the main file. A sidecar left at the ambient
  // umask (0644 by default) would hand that key to any other local user no
  // matter how tight `lucifer.db` itself is.
  it.skipIf(!HAS_POSIX_MODES).each(['-wal', '-shm'])('getDatabase_newDatabase_restrictsThe%sSidecarToOwnerOnly', (suffix) => {
    expect(mode(`${open()}${suffix}`)).toBe('600');
  });

  // The permission tightening must never become a precondition for opening the
  // database. On a filesystem that cannot honour the mode — Windows, and some
  // bind mounts — a `restrictToOwner` that threw would take startup with it.
  it('getDatabase_platformWithoutPosixModes_stillOpens', () => {
    const dbPath = open();

    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(`${dbPath}-wal`)).toBe(true);
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

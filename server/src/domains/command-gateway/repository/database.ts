import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('database');

let db: Database.Database | null = null;

/**
 * Make one database file owner-only.
 *
 * Best-effort: not every filesystem (notably Windows and some bind mounts)
 * honours POSIX modes, and the WAL sidecars do not exist until SQLite creates
 * them. A missing file is therefore not worth a warning.
 */
function restrictToOwner(filePath: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    log.warn({ err, filePath }, 'Could not restrict database file permissions to owner-only');
  }
}

/**
 * Absolute path of the SQLite file for a data directory.
 *
 * Exported because it doubles as the deployment's identity: `deriveInstanceId`
 * hashes it to scope the admin session key and cookie audience.
 */
export function resolveDatabasePath(dataDir: string): string {
  return resolve(dataDir, 'lucifer.db');
}

export function getDatabase(dataDir: string): Database.Database {
  if (db) return db;

  const dbPath = resolveDatabasePath(dataDir);
  mkdirSync(dirname(dbPath), { recursive: true });

  log.info({ dbPath }, 'Opening SQLite database');
  db = new Database(dbPath, { fileMustExist: false });

  // `server_secrets` can hold the admin session sealing key, so the database
  // becomes the trust boundary for it. Tighten the main file *before* enabling
  // WAL: switching journal mode creates `-wal`/`-shm` under the ambient umask,
  // and every secret write lands in the WAL first. A `-wal` left at 0644 would
  // expose the key to any local user no matter what the main file says.
  restrictToOwner(dbPath);

  db.pragma('journal_mode = WAL');
  restrictToOwner(`${dbPath}-wal`);
  restrictToOwner(`${dbPath}-shm`);

  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'prefix')),
      duration TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      expires_at TEXT,
      approved_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_command ON approvals (command);
    CREATE INDEX IF NOT EXISTS idx_approvals_expires ON approvals (expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      request_id TEXT NOT NULL,
      command TEXT,
      api_key_name TEXT,
      ip TEXT,
      rule_action TEXT,
      duration TEXT,
      approved_by TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_log (request_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);

    CREATE TABLE IF NOT EXISTS server_secrets (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  log.info('Database schema initialized');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}

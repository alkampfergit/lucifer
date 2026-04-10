import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('database');

let db: Database.Database | null = null;

export function getDatabase(dataDir: string): Database.Database {
  if (db) return db;

  const dbPath = resolve(dataDir, 'lucifer.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  log.info({ dbPath }, 'Opening SQLite database');
  db = new Database(dbPath, { fileMustExist: false });
  db.pragma('journal_mode = WAL');
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

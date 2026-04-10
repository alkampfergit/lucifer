import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAuditLog } from './audit_log.js';
import type { AuditEntry } from '../types/command_types.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE audit_log (
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
    CREATE INDEX idx_audit_request_id ON audit_log (request_id);
    CREATE INDEX idx_audit_ts ON audit_log (ts);
  `);
});

afterEach(() => {
  db.close();
});

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: new Date().toISOString(),
    type: 'request',
    requestId: 'req-1',
    command: 'git pull origin main',
    apiKeyName: 'test-key',
    ip: '1.2.3.4',
    ...overrides,
  };
}

describe('AuditLog', () => {
  describe('append', () => {
    it('inserts an entry that can be queried', () => {
      const log = createAuditLog(db);
      const entry = makeEntry();
      log.append(entry);

      const results = log.query();
      expect(results).toHaveLength(1);
      expect(results[0].requestId).toBe('req-1');
      expect(results[0].command).toBe('git pull origin main');
      expect(results[0].apiKeyName).toBe('test-key');
      expect(results[0].ip).toBe('1.2.3.4');
    });
  });

  describe('query', () => {
    it('returns entries in reverse chronological order (most recent first by id)', () => {
      const log = createAuditLog(db);
      log.append(makeEntry({ requestId: 'req-1', ts: '2024-01-01T00:00:00Z' }));
      log.append(makeEntry({ requestId: 'req-2', ts: '2024-01-02T00:00:00Z' }));
      log.append(makeEntry({ requestId: 'req-3', ts: '2024-01-03T00:00:00Z' }));

      const results = log.query();
      expect(results).toHaveLength(3);
      expect(results[0].requestId).toBe('req-3');
      expect(results[1].requestId).toBe('req-2');
      expect(results[2].requestId).toBe('req-1');
    });

    it('respects limit and offset', () => {
      const log = createAuditLog(db);
      for (let i = 1; i <= 5; i++) {
        log.append(makeEntry({ requestId: `req-${i}` }));
      }

      const page1 = log.query(2, 0);
      expect(page1).toHaveLength(2);
      // Most recent first: req-5, req-4
      expect(page1[0].requestId).toBe('req-5');
      expect(page1[1].requestId).toBe('req-4');

      const page2 = log.query(2, 2);
      expect(page2).toHaveLength(2);
      // Next page: req-3, req-2
      expect(page2[0].requestId).toBe('req-3');
      expect(page2[1].requestId).toBe('req-2');
    });
  });

  describe('queryByRequestId', () => {
    it('returns only entries matching the given requestId', () => {
      const log = createAuditLog(db);
      log.append(makeEntry({ requestId: 'req-1', type: 'request' }));
      log.append(makeEntry({ requestId: 'req-2', type: 'request' }));
      log.append(makeEntry({ requestId: 'req-1', type: 'approved' }));

      const results = log.queryByRequestId('req-1');
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.requestId === 'req-1')).toBe(true);
    });

    it('returns empty array for unknown requestId', () => {
      const log = createAuditLog(db);
      log.append(makeEntry({ requestId: 'req-1' }));

      const results = log.queryByRequestId('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('optional fields', () => {
    it('stores nulls for undefined optional fields and returns them as null', () => {
      const log = createAuditLog(db);
      log.append({
        ts: '2024-01-01T00:00:00Z',
        type: 'request',
        requestId: 'req-minimal',
      });

      const results = log.query();
      expect(results).toHaveLength(1);
      const entry = results[0];
      expect(entry.requestId).toBe('req-minimal');
      expect(entry.command).toBeNull();
      expect(entry.apiKeyName).toBeNull();
      expect(entry.ip).toBeNull();
      expect(entry.ruleAction).toBeNull();
      expect(entry.duration).toBeNull();
      expect(entry.approvedBy).toBeNull();
      expect(entry.exitCode).toBeNull();
      expect(entry.durationMs).toBeNull();
      expect(entry.error).toBeNull();
    });
  });
});

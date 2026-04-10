import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApprovalStore } from './approval_store.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'prefix')),
      duration TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      expires_at TEXT,
      approved_by TEXT NOT NULL
    );
    CREATE INDEX idx_approvals_command ON approvals (command);
    CREATE INDEX idx_approvals_expires ON approvals (expires_at);
  `);
});

afterEach(() => {
  db.close();
});

describe('ApprovalStore', () => {
  describe('addApproval + findApproval', () => {
    it('finds an exact-match approval', () => {
      const store = createApprovalStore(db);
      store.addApproval('git pull origin main', 'exact', '8', 'telegram:123');

      const found = store.findApproval('git pull origin main');
      expect(found).toBeDefined();
      expect(found!.command).toBe('git pull origin main');
      expect(found!.matchType).toBe('exact');
    });

    it('does not match different command for exact approval', () => {
      const store = createApprovalStore(db);
      store.addApproval('git pull origin main', 'exact', '8', 'telegram:123');

      const found = store.findApproval('git pull origin develop');
      expect(found).toBeUndefined();
    });

    it('finds a prefix-match approval', () => {
      const store = createApprovalStore(db);
      store.addApproval('git pull', 'prefix', '8', 'telegram:123');

      const found = store.findApproval('git pull origin main');
      expect(found).toBeDefined();
      expect(found!.command).toBe('git pull');
      expect(found!.matchType).toBe('prefix');
    });

    it('does not match unrelated command for prefix approval', () => {
      const store = createApprovalStore(db);
      store.addApproval('git pull', 'prefix', '8', 'telegram:123');

      const found = store.findApproval('git push origin main');
      expect(found).toBeUndefined();
    });

    it('prefers exact match over prefix match', () => {
      const store = createApprovalStore(db);
      store.addApproval('git', 'prefix', '2', 'telegram:123');
      store.addApproval('git pull origin main', 'exact', '8', 'telegram:456');

      const found = store.findApproval('git pull origin main');
      expect(found).toBeDefined();
      expect(found!.matchType).toBe('exact');
      expect(found!.approvedBy).toBe('telegram:456');
    });

    it('handles permanent approval (no expiry)', () => {
      const store = createApprovalStore(db);
      store.addApproval('echo hello', 'exact', 'permanent', 'telegram:123');

      const found = store.findApproval('echo hello');
      expect(found).toBeDefined();
      expect(found!.expiresAt).toBeNull();
    });

    it('caps prefix approval at 8h even if permanent requested', () => {
      const store = createApprovalStore(db);
      const approval = store.addApproval('git', 'prefix', 'permanent', 'telegram:123');

      expect(approval.expiresAt).not.toBeNull();
      const expiresAt = new Date(approval.expiresAt!);
      const eightHoursFromNow = new Date(Date.now() + 8 * 3600_000 + 60_000);
      expect(expiresAt.getTime()).toBeLessThan(eightHoursFromNow.getTime());
    });

    it('caps prefix approval at 8h when duration > 8', () => {
      const store = createApprovalStore(db);
      const approval = store.addApproval('npm', 'prefix', '24', 'telegram:123');

      expect(approval.expiresAt).not.toBeNull();
      const expiresAt = new Date(approval.expiresAt!);
      const eightHoursFromNow = new Date(Date.now() + 8 * 3600_000 + 60_000);
      expect(expiresAt.getTime()).toBeLessThan(eightHoursFromNow.getTime());
    });
  });

  describe('expiry', () => {
    it('does not find expired approval', () => {
      const store = createApprovalStore(db);

      // Insert an already-expired approval directly
      db.prepare(
        `INSERT INTO approvals (command, match_type, duration, approved_at, expires_at, approved_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('echo test', 'exact', '2', '2020-01-01T00:00:00Z', '2020-01-01T02:00:00Z', 'telegram:123');

      const found = store.findApproval('echo test');
      expect(found).toBeUndefined();
    });

    it('removeExpired cleans up old approvals', () => {
      const store = createApprovalStore(db);

      db.prepare(
        `INSERT INTO approvals (command, match_type, duration, approved_at, expires_at, approved_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('old cmd', 'exact', '2', '2020-01-01T00:00:00Z', '2020-01-01T02:00:00Z', 'telegram:123');

      store.addApproval('new cmd', 'exact', '8', 'telegram:456');

      const removed = store.removeExpired();
      expect(removed).toBe(1);

      const all = store.listAll();
      expect(all).toHaveLength(1);
      expect(all[0].command).toBe('new cmd');
    });
  });

  describe('revokeById', () => {
    it('removes an approval by id', () => {
      const store = createApprovalStore(db);
      const approval = store.addApproval('git push', 'exact', '8', 'telegram:123');

      const revoked = store.revokeById(approval.id);
      expect(revoked).toBe(true);

      const found = store.findApproval('git push');
      expect(found).toBeUndefined();
    });

    it('returns false for non-existent id', () => {
      const store = createApprovalStore(db);
      expect(store.revokeById(999)).toBe(false);
    });
  });

  describe('listAll', () => {
    it('lists approvals with pagination', () => {
      const store = createApprovalStore(db);
      for (let i = 0; i < 5; i++) {
        store.addApproval(`cmd-${i}`, 'exact', '8', 'telegram:123');
      }

      const page1 = store.listAll(2, 0);
      expect(page1).toHaveLength(2);

      const page2 = store.listAll(2, 2);
      expect(page2).toHaveLength(2);

      const page3 = store.listAll(2, 4);
      expect(page3).toHaveLength(1);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { registerApprovalRoutes } from './register_approval_routes.js';
import { createWebApprovalChannel, type WebApprovalChannelHandle } from '../service/web_approval_channel.js';
import { createApprovalStore } from '../repository/approval_store.js';
import { createAuditLog } from '../repository/audit_log.js';
import { hashApiKey } from '../repository/api_key_store.js';

/**
 * The per-IP auth lockout, seen from a *direct* client.
 *
 * This lives in its own file on purpose: the failure counter is module-level
 * and these tests deliberately lock out the loopback address, which is the
 * address every other supertest request in a file would also come from.
 */

const ADMIN_SECRET = 'luc_admin_lockout-test-secret';
const ADMIN_SALT = 'lockoutsalt0123456789abcd';
const ADMIN_HASH = hashApiKey(ADMIN_SECRET, ADMIN_SALT);

function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
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
  `);
  return db;
}

describe('register_approval_routes — auth lockout from an untrusted client', () => {
  let app: express.Express;
  let db: Database.Database;
  let webChannel: WebApprovalChannelHandle;

  beforeAll(async () => {
    db = createTestDatabase();
    webChannel = createWebApprovalChannel();

    // No `trust proxy`: the default, and what a localhost deployment runs as.
    app = express();
    app.use(express.json());
    registerApprovalRoutes({
      router: app,
      adminSecretHash: ADMIN_HASH,
      adminSecretSalt: ADMIN_SALT,
      webChannel,
      approvalStore: createApprovalStore(db),
      auditLog: createAuditLog(db),
    });

    await webChannel.start();
  });

  afterAll(async () => {
    await webChannel.stop();
    db.close();
  });

  it('getPending_rotatingForwardedForOnAnUntrustedApp_cannotEvadeTheLockout', async () => {
    // `X-Forwarded-For` here is an unverified claim by a direct client. Keying
    // the failure counter off it would hand an attacker a fresh identity per
    // guess, so the five-failure lockout would never fire. `req.ip` resolves
    // through Express's `trust proxy` policy and therefore ignores the header.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('Authorization', 'Bearer wrong')
        .set('X-Forwarded-For', `203.0.113.${i}`);

      expect(res.status).toBe(401);
    }

    const lockedRes = await request(app)
      .get('/api/v1/admin/approvals/pending')
      .set('Authorization', `Bearer ${ADMIN_SECRET}`)
      .set('X-Forwarded-For', '203.0.113.99');

    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.code).toBe('RATE_LIMITED');
  });
});

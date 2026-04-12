import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { registerApprovalRoutes } from './register_approval_routes.js';
import { createWebApprovalChannel } from '../service/web_approval_channel.js';
import { createApprovalStore } from '../repository/approval_store.js';
import { createAuditLog } from '../repository/audit_log.js';
import { hashApiKey } from '../repository/api_key_store.js';
import type { WebApprovalChannelHandle } from '../service/web_approval_channel.js';
import type { ApprovalStore } from '../repository/approval_store.js';
import type { AuditLog } from '../repository/audit_log.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
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

const ADMIN_SECRET = 'luc_admin_test-secret-42';
const ADMIN_SALT = 'testsalt1234567890abcdef';
const ADMIN_HASH = hashApiKey(ADMIN_SECRET, ADMIN_SALT);

/**
 * Fire-and-forget a pending approval request into the web channel.
 * The returned requestId can be used with the decide endpoint.
 */
function submitPendingRequest(
  webChannel: WebApprovalChannelHandle,
  requestId: string,
  command = 'git push origin main',
): void {
  // Do NOT await — requestApproval blocks until resolved
  webChannel.requestApproval(command, 'test-key', '127.0.0.1', requestId, {
    level: 'warning',
    warnings: ['test risk'],
  }).catch(() => { /* intentionally fire-and-forget */ });
}

/** Helper: open a raw HTTP GET and collect the SSE response. */
function openSSEStream(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      // For non-200 (JSON error responses), just collect the body normally
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ statusCode: res.statusCode!, headers: res.headers, body }));
        return;
      }

      // For SSE streams, collect until we see the init event, then abort
      let body = '';
      const timeout = setTimeout(() => { res.destroy(); }, 3000);
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.includes('event: init')) {
          clearTimeout(timeout);
          res.destroy();
        }
      });
      res.on('close', () => { clearTimeout(timeout); resolve({ statusCode: res.statusCode!, headers: res.headers, body }); });
      res.on('error', () => { clearTimeout(timeout); resolve({ statusCode: res.statusCode!, headers: res.headers, body }); });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('register_approval_routes', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let db: Database.Database;
  let webChannel: WebApprovalChannelHandle;
  let approvalStore: ApprovalStore;
  let auditLog: AuditLog;

  beforeAll(async () => {
    db = createTestDatabase();
    webChannel = createWebApprovalChannel();
    approvalStore = createApprovalStore(db);
    auditLog = createAuditLog(db);

    app = express();
    app.use(express.json());

    registerApprovalRoutes({
      router: app,
      adminSecretHash: ADMIN_HASH,
      adminSecretSalt: ADMIN_SALT,
      webChannel,
      approvalStore,
      auditLog,
    });

    await webChannel.start();

    // Start a real HTTP server for SSE tests (supertest cannot handle streaming)
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await webChannel.stop();
    db.close();
  });

  // ------------------------------------------------------------------
  // 1. HTML page
  // ------------------------------------------------------------------
  describe('GET /admin/approvals', () => {
    it('serves the approval HTML page with 200 and text/html content type', async () => {
      const res = await request(app).get('/admin/approvals');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // 2-3. Pending list — auth happy & sad path
  // ------------------------------------------------------------------
  describe('GET /api/v1/admin/approvals/pending', () => {
    it('returns pending list with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pending');
      expect(Array.isArray(res.body.pending)).toBe(true);
    });

    it('returns 401 UNAUTHORIZED with missing Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/admin/approvals/pending');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED with invalid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('Authorization', 'Bearer wrong-secret');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  // ------------------------------------------------------------------
  // 4. Auth lockout after 5 failures
  // ------------------------------------------------------------------
  describe('auth lockout', () => {
    // Use a separate app instance so the shared auth rate-limit map does not
    // pollute other tests. The rate-limit map is module-level, so we drive
    // lockout via a distinct forwarded IP.
    it('returns 429 RATE_LIMITED after 5 failed auth attempts from same IP', async () => {
      const lockoutIp = '10.99.99.99';

      // 5 failures
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get('/api/v1/admin/approvals/pending')
          .set('Authorization', 'Bearer wrong')
          .set('X-Forwarded-For', lockoutIp);

        expect(res.status).toBe(401);
      }

      // 6th attempt should be locked out
      const lockedRes = await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .set('X-Forwarded-For', lockoutIp);

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.body.code).toBe('RATE_LIMITED');
    });
  });

  // ------------------------------------------------------------------
  // 5. Stream-ticket
  // ------------------------------------------------------------------
  describe('POST /api/v1/admin/approvals/stream-ticket', () => {
    it('returns a UUID ticket with ttlSeconds on valid auth', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ticket');
      expect(res.body).toHaveProperty('ttlSeconds');
      expect(typeof res.body.ticket).toBe('string');
      expect(res.body.ticket).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.body.ttlSeconds).toBe(10);
    });
  });

  // ------------------------------------------------------------------
  // 6-7. SSE stream
  // ------------------------------------------------------------------
  describe('GET /api/v1/admin/approvals/stream', () => {
    it('returns 200 SSE stream with init event when using valid ticket', async () => {
      // First obtain a ticket
      const ticketRes = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`);

      const { ticket } = ticketRes.body;

      const sse = await openSSEStream(`${baseUrl}/api/v1/admin/approvals/stream?ticket=${ticket}`);

      expect(sse.statusCode).toBe(200);
      expect(sse.headers['content-type']).toBe('text/event-stream');
      expect(sse.headers['cache-control']).toBe('no-cache');
      expect(sse.body).toContain('event: init');
      expect(sse.body).toContain('"pending"');
    });

    it('returns 401 when ticket is missing', async () => {
      const res = await request(app)
        .get('/api/v1/admin/approvals/stream');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 TICKET_EXPIRED for an already-used ticket', async () => {
      // Obtain and consume a ticket
      const ticketRes = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`);

      const { ticket } = ticketRes.body;

      // Consume the ticket by opening the SSE stream
      await openSSEStream(`${baseUrl}/api/v1/admin/approvals/stream?ticket=${ticket}`);

      // Second use of same ticket should fail
      const secondUse = await openSSEStream(`${baseUrl}/api/v1/admin/approvals/stream?ticket=${ticket}`);

      expect(secondUse.statusCode).toBe(401);
      const body = JSON.parse(secondUse.body);
      expect(body.code).toBe('TICKET_EXPIRED');
    });
  });

  // ------------------------------------------------------------------
  // SSE real-time push: new_request and request_decided events
  // ------------------------------------------------------------------
  describe('SSE real-time events', () => {
    /** Open an SSE stream and collect events until `stopAfter` events or timeout. */
    function collectSSEEvents(
      url: string,
      stopAfter: number,
      timeoutMs = 5000,
    ): Promise<Array<{ event: string; data: string }>> {
      return new Promise((resolve, reject) => {
        const events: Array<{ event: string; data: string }> = [];
        let currentEvent = '';
        let currentData = '';

        const timer = setTimeout(() => { resolve(events); }, timeoutMs);

        http.get(url, (res) => {
          if (res.statusCode !== 200) {
            clearTimeout(timer);
            reject(new Error(`SSE stream returned ${res.statusCode}`));
            return;
          }

          res.on('data', (chunk: Buffer) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                currentData = line.slice(6).trim();
              } else if (line === '' && currentEvent) {
                events.push({ event: currentEvent, data: currentData });
                currentEvent = '';
                currentData = '';
                if (events.length >= stopAfter) {
                  clearTimeout(timer);
                  res.destroy();
                }
              }
            }
          });

          res.on('close', () => { clearTimeout(timer); resolve(events); });
          res.on('error', () => { clearTimeout(timer); resolve(events); });
        }).on('error', (err) => { clearTimeout(timer); reject(err); });
      });
    }

    it('pushes new_request event when a pending request is submitted', async () => {
      // Get a ticket
      const ticketRes = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`);
      const { ticket } = ticketRes.body;

      // Open SSE stream and collect up to 2 events (init + new_request)
      const eventsPromise = collectSSEEvents(
        `${baseUrl}/api/v1/admin/approvals/stream?ticket=${ticket}`,
        2,
        5000,
      );

      // Give SSE a moment to connect
      await new Promise(r => setTimeout(r, 200));

      // Submit a pending request — this broadcasts new_request via SSE
      const requestId = 'test-sse-push-001';
      submitPendingRequest(webChannel, requestId, 'echo sse-test');

      const events = await eventsPromise;

      // Should have at least init + new_request
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].event).toBe('init');
      expect(events[1].event).toBe('new_request');

      const newReqData = JSON.parse(events[1].data);
      expect(newReqData.requestId).toBe(requestId);
      expect(newReqData.command).toBe('echo sse-test');

      // Clean up
      webChannel.resolveRequest(requestId, 'denied', 'exact', '0');
    });

    it('pushes request_decided event when a pending request is resolved', async () => {
      // Submit a pending request first
      const requestId = 'test-sse-decided-001';
      submitPendingRequest(webChannel, requestId, 'echo decided-test');
      await new Promise(r => setTimeout(r, 50));

      // Get a ticket and open SSE stream, collect up to 2 events (init + request_decided)
      const ticketRes = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`);
      const { ticket } = ticketRes.body;

      const eventsPromise = collectSSEEvents(
        `${baseUrl}/api/v1/admin/approvals/stream?ticket=${ticket}`,
        2,
        5000,
      );

      // Give SSE a moment to connect
      await new Promise(r => setTimeout(r, 200));

      // Resolve the request via the decide endpoint
      const decideRes = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'exact', duration: '2' });
      expect(decideRes.status).toBe(200);

      const events = await eventsPromise;

      // Should have at least init + request_decided
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].event).toBe('init');
      expect(events[1].event).toBe('request_decided');

      const decidedData = JSON.parse(events[1].data);
      expect(decidedData.requestId).toBe(requestId);
      expect(decidedData.decision).toBe('approved');
    });
  });

  // ------------------------------------------------------------------
  // 8-13. Decide endpoint
  // ------------------------------------------------------------------
  describe('POST /api/v1/admin/approvals/:requestId/decide', () => {
    it('approves a pending request with action:"approve", matchType:"exact", duration:"8"', async () => {
      const requestId = 'test-approve-exact-001';
      submitPendingRequest(webChannel, requestId, 'git push origin main');

      // Give the event loop a tick to register the callback
      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'exact', duration: '8' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({ ok: true, requestId, decision: 'approved' }),
      );
    });

    it('denies a pending request with action:"deny"', async () => {
      const requestId = 'test-deny-001';
      submitPendingRequest(webChannel, requestId, 'rm -rf /');

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'deny' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({ ok: true, requestId, decision: 'denied' }),
      );
    });

    it('returns 400 INVALID_ACTION for invalid action', async () => {
      const requestId = 'test-invalid-action-001';
      submitPendingRequest(webChannel, requestId);

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'maybe' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ACTION');

      // Clean up the pending request so it doesn't leak
      webChannel.resolveRequest(requestId, 'denied', 'exact', '0');
    });

    it('returns 400 INVALID_MATCH_TYPE for invalid matchType on approve', async () => {
      const requestId = 'test-invalid-match-001';
      submitPendingRequest(webChannel, requestId);

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'glob', duration: '8' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_MATCH_TYPE');

      webChannel.resolveRequest(requestId, 'denied', 'exact', '0');
    });

    it('returns 400 INVALID_DURATION for invalid duration on approve', async () => {
      const requestId = 'test-invalid-duration-001';
      submitPendingRequest(webChannel, requestId);

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'exact', duration: '24' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DURATION');

      webChannel.resolveRequest(requestId, 'denied', 'exact', '0');
    });

    it('returns 409 ALREADY_DECIDED for a request that was already resolved', async () => {
      const requestId = 'test-already-decided-001';
      submitPendingRequest(webChannel, requestId);

      await new Promise(r => setTimeout(r, 50));

      // Resolve it first
      webChannel.resolveRequest(requestId, 'approved', 'exact', '8');

      // Try to decide again via HTTP
      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'exact', duration: '8' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_DECIDED');
    });
  });

  // ------------------------------------------------------------------
  // 14. Approval stored in database after web approve
  // ------------------------------------------------------------------
  describe('approval persistence', () => {
    it('stores an approval record in the database after web approve', async () => {
      const requestId = 'test-persist-001';
      const command = 'npm run build';
      submitPendingRequest(webChannel, requestId, command);

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'exact', duration: '8' });

      expect(res.status).toBe(200);

      // Verify the approval was persisted
      const found = approvalStore.findApproval(command);
      expect(found).toBeDefined();
      expect(found!.command).toBe(command);
      expect(found!.matchType).toBe('exact');
      expect(found!.approvedBy).toBe('web:admin');
    });
  });

  // ------------------------------------------------------------------
  // 15. Audit log records web decision
  // ------------------------------------------------------------------
  describe('audit log', () => {
    it('records a web decision in the audit log', async () => {
      const requestId = 'test-audit-001';
      const command = 'docker compose up -d';
      submitPendingRequest(webChannel, requestId, command);

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'approve', matchType: 'exact', duration: '2' });

      expect(res.status).toBe(200);

      const entries = auditLog.queryByRequestId(requestId);
      expect(entries.length).toBeGreaterThanOrEqual(1);

      const entry = entries[0];
      expect(entry.type).toBe('approved');
      expect(entry.requestId).toBe(requestId);
      expect(entry.command).toBe(command);
      expect(entry.approvedBy).toBe('web:admin');
      expect(entry.duration).toBe('2');
    });

    it('records a deny decision in the audit log', async () => {
      const requestId = 'test-audit-deny-001';
      const command = 'rm -rf /important';
      submitPendingRequest(webChannel, requestId, command);

      await new Promise(r => setTimeout(r, 50));

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'deny' });

      expect(res.status).toBe(200);

      const entries = auditLog.queryByRequestId(requestId);
      expect(entries.length).toBeGreaterThanOrEqual(1);

      const entry = entries[0];
      expect(entry.type).toBe('denied');
      expect(entry.requestId).toBe(requestId);
      expect(entry.command).toBe(command);
      expect(entry.approvedBy).toBe('web:admin');
    });
  });
});

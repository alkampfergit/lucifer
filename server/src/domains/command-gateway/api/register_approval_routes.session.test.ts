import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { registerApprovalRoutes } from './register_approval_routes.js';
import { createWebApprovalChannel } from '../service/web_approval_channel.js';
import { createAdminSessionSealer, type AdminSessionSealer } from '../service/admin_session.js';
import { createApprovalStore } from '../repository/approval_store.js';
import { createAuditLog } from '../repository/audit_log.js';
import { hashApiKey } from '../repository/api_key_store.js';
import type { WebApprovalChannelHandle } from '../service/web_approval_channel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const ADMIN_SECRET = 'luc_admin_session-test-secret';
const ADMIN_SALT = 'sessionsalt0123456789abcd';
const ADMIN_HASH = hashApiKey(ADMIN_SECRET, ADMIN_SALT);

const SESSION_COOKIE = 'lucifer_admin';
const CSRF_COOKIE = 'lucifer_admin_csrf';
const CSRF_HEADER = 'X-Lucifer-CSRF';

function submitPendingRequest(webChannel: WebApprovalChannelHandle, requestId: string): void {
  // Do NOT await — requestApproval blocks until resolved
  webChannel.requestApproval('git push origin main', 'test-key', '127.0.0.1', requestId, {
    level: 'safe',
    warnings: [],
  }).catch(() => { /* intentionally fire-and-forget */ });
}

/** Pull one `Set-Cookie` entry by name out of a supertest response. */
function setCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

function cookieValue(res: request.Response, name: string): string {
  const entry = setCookie(res, name);
  if (!entry) throw new Error(`No ${name} cookie on response`);
  return decodeURIComponent(entry.slice(name.length + 1).split(';')[0]);
}

interface Session {
  cookieHeader: string;
  csrf: string;
}

describe('register_approval_routes — cookie sessions', () => {
  let app: express.Express;
  let db: Database.Database;
  let webChannel: WebApprovalChannelHandle;
  let sealer: AdminSessionSealer;
  let session: Session;
  let otherSession: Session;

  /**
   * Distinct source IP per expected-401 test. `checkAdminAuth` keys its failure
   * counter off `X-Forwarded-For`, so this keeps unauthorised cases from
   * accumulating into a lockout that would break unrelated tests.
   */
  let nextFailureIp = 0;
  function freshIp(): string {
    nextFailureIp += 1;
    return `10.0.0.${nextFailureIp}`;
  }

  /** Log in with the bearer secret and keep the resulting cookies. */
  async function login(): Promise<Session> {
    const res = await request(app)
      .post('/api/v1/admin/approvals/session')
      .set('Authorization', `Bearer ${ADMIN_SECRET}`)
      .expect(200);

    const session = cookieValue(res, SESSION_COOKIE);
    const csrf = cookieValue(res, CSRF_COOKIE);
    return { cookieHeader: `${SESSION_COOKIE}=${encodeURIComponent(session)}`, csrf };
  }

  beforeAll(async () => {
    db = createTestDatabase();
    webChannel = createWebApprovalChannel();
    sealer = createAdminSessionSealer(randomBytes(32));

    app = express();
    app.use(express.json());
    registerApprovalRoutes({
      router: app,
      adminSecretHash: ADMIN_HASH,
      adminSecretSalt: ADMIN_SALT,
      webChannel,
      approvalStore: createApprovalStore(db),
      auditLog: createAuditLog(db),
      adminSession: sealer,
    });

    await webChannel.start();
    session = await login();
    otherSession = await login();
  });

  afterAll(async () => {
    await webChannel.stop();
    db.close();
  });

  // ------------------------------------------------------------------
  // POST /session
  // ------------------------------------------------------------------
  describe('POST /api/v1/admin/approvals/session', () => {
    it('postSession_validBearerSecret_setsSealedSessionAndCsrfCookies', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .expect(200);

      expect(res.body).toEqual({ ok: true, expiresInSeconds: 2_592_000 });
      expect(cookieValue(res, SESSION_COOKIE)).toMatch(/^v1\./);
      expect(cookieValue(res, CSRF_COOKIE).length).toBeGreaterThan(0);
    });

    it('postSession_validBearerSecret_sessionCookieIsHttpOnlyStrictAndThirtyDays', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .expect(200);

      const cookie = setCookie(res, SESSION_COOKIE)!;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=2592000');
    });

    it('postSession_validBearerSecret_csrfCookieIsReadableByThePage', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .expect(200);

      const cookie = setCookie(res, CSRF_COOKIE)!;
      expect(cookie).not.toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('postSession_plainHttpRequest_omitsSecureSoLocalhostStillReceivesTheCookie', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .expect(200);

      expect(setCookie(res, SESSION_COOKIE)).not.toContain('Secure');
    });

    it('postSession_forwardedAsHttps_marksBothCookiesSecure', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .set('X-Forwarded-Proto', 'https')
        .expect(200);

      expect(setCookie(res, SESSION_COOKIE)).toContain('Secure');
      expect(setCookie(res, CSRF_COOKIE)).toContain('Secure');
    });

    it('postSession_wrongBearerSecret_returns401AndSetsNoCookie', async () => {
      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', 'Bearer wrong-secret')
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('postSession_authenticatedByCookie_returns403SoTheThirtyDayLifetimeStaysAbsolute', async () => {

      const res = await request(app)
        .post('/api/v1/admin/approvals/session')
        .set('Cookie', session.cookieHeader)
        .expect(403);

      expect(res.body.code).toBe('BEARER_REQUIRED');
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Cookie authentication on read routes
  // ------------------------------------------------------------------
  describe('cookie authentication', () => {
    it('getPending_sessionCookieOnly_authenticatesWithoutTheAdminSecret', async () => {

      const res = await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('Cookie', session.cookieHeader)
        .expect(200);

      expect(res.body).toHaveProperty('pending');
    });

    it('getHistory_sessionCookieOnly_authenticates', async () => {

      await request(app)
        .get('/api/v1/admin/approvals/history')
        .set('Cookie', session.cookieHeader)
        .expect(200);
    });

    it('getPending_tamperedSessionCookie_returns401', async () => {
      const tampered = session.cookieHeader.slice(0, -4) + 'AAAA';

      const res = await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', tampered)
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('getPending_cookieSealedWithAnotherKey_returns401', async () => {
      const foreign = createAdminSessionSealer(randomBytes(32)).seal();

      await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(foreign.cookie)}`)
        .expect(401);
    });

    it('getPending_expiredSessionCookie_returns401', async () => {
      const expired = createAdminSessionSealer(randomBytes(32), -1).seal();

      await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(expired.cookie)}`)
        .expect(401);
    });

    it('getPending_wrongBearerSecretWithValidCookie_stillReturns401', async () => {

      // An Authorization header is a deliberate bearer attempt; it is decided on
      // its own so the per-IP lockout keeps counting failed logins.
      await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', 'Bearer wrong-secret')
        .set('Cookie', session.cookieHeader)
        .expect(401);
    });
  });

  // ------------------------------------------------------------------
  // CSRF
  // ------------------------------------------------------------------
  describe('CSRF protection', () => {
    it('postDecide_cookieAuthWithMatchingCsrfHeader_isAccepted', async () => {
      const requestId = 'csrf-ok-1';
      submitPendingRequest(webChannel, requestId);

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Cookie', session.cookieHeader)
        .set(CSRF_HEADER, session.csrf)
        .send({ action: 'approve', matchType: 'exact', duration: '2' })
        .expect(200);

      expect(res.body).toMatchObject({ ok: true, decision: 'approved' });
    });

    it('postDecide_cookieAuthWithoutCsrfHeader_returns403CsrfInvalid', async () => {
      const requestId = 'csrf-missing-1';
      submitPendingRequest(webChannel, requestId);

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Cookie', session.cookieHeader)
        .send({ action: 'deny' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
      // The request must not have been decided.
      expect(webChannel.getPendingRequests().some((p) => p.requestId === requestId)).toBe(true);
      webChannel.resolveRequest(requestId, 'denied', 'exact', '0');
    });

    it('postDecide_csrfTokenFromAnotherSession_returns403CsrfInvalid', async () => {
      const requestId = 'csrf-cross-1';
      submitPendingRequest(webChannel, requestId);

      const res = await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Cookie', session.cookieHeader)
        .set(CSRF_HEADER, otherSession.csrf)
        .send({ action: 'deny' })
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
      webChannel.resolveRequest(requestId, 'denied', 'exact', '0');
    });

    it('postDecide_bearerAuthWithoutCsrfHeader_isUnaffected', async () => {
      const requestId = 'csrf-bearer-1';
      submitPendingRequest(webChannel, requestId);

      await request(app)
        .post(`/api/v1/admin/approvals/${requestId}/decide`)
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .send({ action: 'deny' })
        .expect(200);
    });

    it('postStreamTicket_cookieAuthWithoutCsrfHeader_returns403', async () => {

      const res = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Cookie', session.cookieHeader)
        .expect(403);

      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('postStreamTicket_cookieAuthWithMatchingCsrfHeader_mintsATicket', async () => {

      const res = await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Cookie', session.cookieHeader)
        .set(CSRF_HEADER, session.csrf)
        .expect(200);

      expect(res.body.ticket).toBeTypeOf('string');
    });

    it('postStreamTicket_bearerAuthWithoutCsrfHeader_isUnaffected', async () => {
      await request(app)
        .post('/api/v1/admin/approvals/stream-ticket')
        .set('Authorization', `Bearer ${ADMIN_SECRET}`)
        .expect(200);
    });

    it('postDecide_repeatedCsrfFailures_doNotTriggerTheAuthLockout', async () => {

      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/v1/admin/approvals/stream-ticket')
          .set('Cookie', session.cookieHeader)
          .expect(403);
      }

      // A CSRF failure is a wiring problem, not a password guess.
      await request(app)
        .get('/api/v1/admin/approvals/pending')
        .set('Cookie', session.cookieHeader)
        .expect(200);
    });
  });

  // ------------------------------------------------------------------
  // DELETE /session
  // ------------------------------------------------------------------
  describe('DELETE /api/v1/admin/approvals/session', () => {
    it('deleteSession_cookieAuthWithCsrfHeader_expiresBothCookies', async () => {

      const res = await request(app)
        .delete('/api/v1/admin/approvals/session')
        .set('Cookie', session.cookieHeader)
        .set(CSRF_HEADER, session.csrf)
        .expect(200);

      expect(res.body).toEqual({ ok: true });
      expect(setCookie(res, SESSION_COOKIE)).toContain('Expires=Thu, 01 Jan 1970');
      expect(setCookie(res, CSRF_COOKIE)).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('deleteSession_cookieAuthWithoutCsrfHeader_returns403', async () => {

      await request(app)
        .delete('/api/v1/admin/approvals/session')
        .set('Cookie', session.cookieHeader)
        .expect(403);
    });

    it('deleteSession_unauthenticated_returns401', async () => {
      await request(app)
        .delete('/api/v1/admin/approvals/session')
        .set('X-Forwarded-For', freshIp())
        .expect(401);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature disabled
// ---------------------------------------------------------------------------

describe('register_approval_routes — cookie sessions disabled', () => {
  let app: express.Express;
  let db: Database.Database;
  let webChannel: WebApprovalChannelHandle;

  beforeAll(async () => {
    db = createTestDatabase();
    webChannel = createWebApprovalChannel();

    app = express();
    app.use(express.json());
    registerApprovalRoutes({
      router: app,
      adminSecretHash: ADMIN_HASH,
      adminSecretSalt: ADMIN_SALT,
      webChannel,
      approvalStore: createApprovalStore(db),
      auditLog: createAuditLog(db),
      // no adminSession — operator set adminCookieSession.enabled = false
    });

    await webChannel.start();
  });

  afterAll(async () => {
    await webChannel.stop();
    db.close();
  });

  it('postSession_sealerNotWired_routeIsNotRegistered', async () => {
    await request(app)
      .post('/api/v1/admin/approvals/session')
      .set('Authorization', `Bearer ${ADMIN_SECRET}`)
      .expect(404);
  });

  it('getPending_sealerNotWired_cookiesAreIgnoredAndBearerStillWorks', async () => {
    const foreign = createAdminSessionSealer(randomBytes(32)).seal();

    await request(app)
      .get('/api/v1/admin/approvals/pending')
      .set('X-Forwarded-For', '10.1.0.1')
      .set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(foreign.cookie)}`)
      .expect(401);

    await request(app)
      .get('/api/v1/admin/approvals/pending')
      .set('Authorization', `Bearer ${ADMIN_SECRET}`)
      .expect(200);
  });
});

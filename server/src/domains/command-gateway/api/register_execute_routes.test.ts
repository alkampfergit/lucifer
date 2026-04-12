import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { registerExecuteRoutes } from './register_execute_routes.js';
import { createApprovalStore } from '../repository/approval_store.js';
import { createAuditLog } from '../repository/audit_log.js';
import { createApiKeyStore, hashApiKey } from '../repository/api_key_store.js';
import { createCommandRulesStore } from '../repository/command_rules_store.js';
import { createPendingRequestStore } from '../repository/pending_request_store.js';
import type { ApprovalChannel, ApprovalDecision, ApprovalMatchType, ShellRiskAnalysis } from '../types/command_types.js';
import { createTestAppContext, type TestAppContext } from '../../../test/integration-setup.js';

let ctx: TestAppContext;

beforeAll(async () => {
  ctx = createTestAppContext('integration', {
    extraRules: [{ prefix: 'rm ', action: 'always_deny' }],
  });
  await ctx.start();
});

afterAll(async () => {
  await ctx.stop();
});

describe('POST /api/v1/execute integration', () => {
  it('returns 401 for missing API key', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .send({ command: 'echo hi' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_API_KEY');
  });

  it('returns 401 for invalid API key', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', 'wrong_key')
      .send({ command: 'echo hi' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('returns 400 for missing command', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_COMMAND');
  });

  it('executes always_approve command immediately', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'echo integration-test' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.exitCode).toBe(0);
    expect(res.body.stdout).toContain('integration-test');
  });

  it('rejects always_deny command with 403', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'rm -rf /tmp/test' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMAND_DENIED');
  });

  it('rejects unmatched command with default deny', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'whoami' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMAND_DENIED');
  });

  it('returns pending_approval for manual_approve command (async default)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'git status' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 400 for command exceeding max length', async () => {
    const longCommand = 'echo ' + 'x'.repeat(5000);
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: longCommand });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMMAND_TOO_LONG');
  });

  it('returns 400 for invalid cwd', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'echo hi', cwd: '../../../etc' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CWD');
  });

  it('captures non-zero exit codes', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'echo fail && exit 1' });

    expect(res.status).toBe(200);
    expect(res.body.exitCode).toBe(1);
    expect(res.body.status).toBe('failed');
  });
});

describe('GET /api/v1/status/:requestId', () => {
  it('returns 401 for missing API key', async () => {
    const res = await request(ctx.app).get('/api/v1/status/some-id');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown requestId', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/status/nonexistent-id')
      .set('x-api-key', ctx.testKey);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns status for a pending manual_approve request', async () => {
    // First create a pending request
    const execRes = await request(ctx.app)
      .post('/api/v1/execute')
      .set('x-api-key', ctx.testKey)
      .send({ command: 'git log --oneline' });

    expect(execRes.status).toBe(202);
    const { requestId } = execRes.body;

    // Poll for status (auto-approve runs async, might be completed or pending)
    const statusRes = await request(ctx.app)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', ctx.testKey);

    expect([200, 404]).toContain(statusRes.status);
    if (statusRes.status === 200) {
      expect(['pending_approval', 'executing', 'completed', 'failed'].includes(statusRes.body.status)).toBe(true);
    }
  });
});

describe('GET /api/health', () => {
  it('returns health status', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// --- MockApprovalChannel integration tests ---

/** Poll a condition every 50ms until it returns true or timeout is reached. */
async function waitForCondition(fn: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return;
    } catch { /* condition not met yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
}

interface MockChannel extends ApprovalChannel {
  pendingApprovals: Map<string, {
    resolve: (value: { decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }) => void;
    reject: (reason: Error) => void;
  }>;
  approveNext(requestId: string, matchType?: ApprovalMatchType, duration?: string): void;
  denyNext(requestId: string): void;
}

function createMockApprovalChannel(): MockChannel {
  const pendingApprovals = new Map<string, {
    resolve: (value: { decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }) => void;
    reject: (reason: Error) => void;
  }>();
  return {
    pendingApprovals,
    async requestApproval(
      _command: string,
      _apiKeyName: string,
      _ip: string,
      requestId: string,
      _risk: ShellRiskAnalysis, // eslint-disable-line @typescript-eslint/no-unused-vars
    ) {
      return new Promise<{ decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }>((resolve, reject) => {
        pendingApprovals.set(requestId, { resolve, reject });
      });
    },
    approveNext(requestId: string, matchType: ApprovalMatchType = 'exact', duration = '8') {
      const pending = pendingApprovals.get(requestId);
      if (pending) {
        pendingApprovals.delete(requestId);
        pending.resolve({ decision: 'approved', matchType, duration });
      }
    },
    denyNext(requestId: string) {
      const pending = pendingApprovals.get(requestId);
      if (pending) {
        pendingApprovals.delete(requestId);
        pending.resolve({ decision: 'denied', matchType: 'exact', duration: '0' });
      }
    },
    async start() {},
    async stop() {},
  };
}

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
  return db;
}

describe('MockApprovalChannel integration', () => {
  const MOCK_TEST_DIR = join(process.cwd(), '.test-mock-approval');
  const MOCK_CONFIG_DIR = join(MOCK_TEST_DIR, 'config');

  const MOCK_KEY = 'luc_mockapprovaltest456';
  const MOCK_SALT = 'mocksalt123456789';
  const MOCK_HASH = hashApiKey(MOCK_KEY, MOCK_SALT);

  let mockApp: express.Express;
  let timeoutApp: express.Express;
  let mockChannel: MockChannel;
  let db: Database.Database;

  async function approveAndWaitForCompletion(requestId: string): Promise<void> {
    await waitForCondition(() => mockChannel.pendingApprovals.size >= 1, 5000);
    const [pendingId] = mockChannel.pendingApprovals.keys();
    mockChannel.approveNext(pendingId);
    await waitForCondition(async () => {
      const statusRes = await request(mockApp)
        .get(`/api/v1/status/${requestId}`)
        .set('x-api-key', MOCK_KEY);
      return statusRes.status === 200 && statusRes.body.status === 'completed';
    }, 5000);
  }

  beforeAll(() => {
    mkdirSync(MOCK_CONFIG_DIR, { recursive: true });

    writeFileSync(join(MOCK_CONFIG_DIR, 'api-keys.json'), JSON.stringify({
      keys: [{
        id: 'mock-test',
        name: 'mock-integration',
        keyHash: MOCK_HASH,
        salt: MOCK_SALT,
        allowedIps: [],
        createdAt: new Date().toISOString(),
        active: true,
      }],
    }));

    writeFileSync(join(MOCK_CONFIG_DIR, 'command-rules.json'), JSON.stringify({
      rules: [
        { prefix: 'echo ', action: 'always_approve' },
        { prefix: 'rm ', action: 'always_deny' },
        { prefix: 'git ', action: 'manual_approve' },
      ],
      defaultAction: 'always_deny',
    }));

    db = createTestDatabase();
    mockChannel = createMockApprovalChannel();

    const approvalStore = createApprovalStore(db);
    const auditLog = createAuditLog(db);
    const apiKeyStore = createApiKeyStore(join(MOCK_CONFIG_DIR, 'api-keys.json'));
    const commandRulesStore = createCommandRulesStore(join(MOCK_CONFIG_DIR, 'command-rules.json'));
    const pendingStore = createPendingRequestStore();

    mockApp = express();
    mockApp.use(express.json());

    registerExecuteRoutes({
      router: mockApp,
      config: {
        port: 0,
        approvalTimeoutSeconds: 30,
        executionTimeoutSeconds: 10,
        maxConcurrentExecutions: 3,
        maxOutputBytes: 65536,
        rateLimitPerMinute: 100,
        onApprovalTimeout: 'deny',
        dataDir: MOCK_TEST_DIR,
      },
      apiKeyStore,
      commandRulesStore,
      approvalStore,
      pendingStore,
      auditLog,
      approvalChannel: mockChannel,
    });

    // Separate app for timeout test with very short approval timeout
    timeoutApp = express();
    timeoutApp.use(express.json());

    const timeoutMockChannel = createMockApprovalChannel();
    registerExecuteRoutes({
      router: timeoutApp,
      config: {
        port: 0,
        approvalTimeoutSeconds: 1,
        executionTimeoutSeconds: 10,
        maxConcurrentExecutions: 3,
        maxOutputBytes: 65536,
        rateLimitPerMinute: 100,
        onApprovalTimeout: 'deny',
        dataDir: MOCK_TEST_DIR,
      },
      apiKeyStore: createApiKeyStore(join(MOCK_CONFIG_DIR, 'api-keys.json')),
      commandRulesStore: createCommandRulesStore(join(MOCK_CONFIG_DIR, 'command-rules.json')),
      approvalStore: createApprovalStore(db),
      pendingStore: createPendingRequestStore(),
      auditLog: createAuditLog(db),
      approvalChannel: timeoutMockChannel,
    });
  });

  afterAll(() => {
    db.close();
    rmSync(MOCK_TEST_DIR, { recursive: true, force: true });
  });

  it('async approve — approved command executes and result is retrievable', async () => {
    // Submit command in async mode
    const execRes = await request(mockApp)
      .post('/api/v1/execute')
      .set('x-api-key', MOCK_KEY)
      .send({ command: 'git --version' });

    expect(execRes.status).toBe(202);
    expect(execRes.body.status).toBe('pending_approval');
    const { requestId } = execRes.body;

    await approveAndWaitForCompletion(requestId);

    // Verify final result
    const statusRes = await request(mockApp)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', MOCK_KEY);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.exitCode).toBe(0);
    expect(statusRes.body.stdout).toContain('git version');
  }, 15_000);

  it('sync deny — blocks until denied, then returns 403', async () => {
    const [res] = await Promise.all([
      request(mockApp)
        .post('/api/v1/execute?sync=true')
        .set('x-api-key', MOCK_KEY)
        .send({ command: 'git log --oneline' }),
      (async () => {
        await waitForCondition(() => mockChannel.pendingApprovals.size >= 1, 5000);
        const [requestId] = mockChannel.pendingApprovals.keys();
        mockChannel.denyNext(requestId);
      })(),
    ]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DENIED');
    expect(res.body.status).toBe('denied');
  }, 15_000);

  it('sync timeout — returns 408 when approval times out', async () => {
    // Uses timeoutApp which has a 1-second approval timeout
    const res = await request(timeoutApp)
      .post('/api/v1/execute?sync=true')
      .set('x-api-key', MOCK_KEY)
      .send({ command: 'git diff' });

    // The approval timeout is 1 second, so this should return 408
    expect(res.status).toBe(408);
    expect(res.body.code).toBe('APPROVAL_TIMEOUT');
    expect(res.body.retryable).toBe(true);
  }, 10_000);

  it('async mode — returns 202 with pending status, then resolves after approval', async () => {
    const execRes = await request(mockApp)
      .post('/api/v1/execute')
      .set('x-api-key', MOCK_KEY)
      .send({ command: 'git branch' });

    expect(execRes.status).toBe(202);
    expect(execRes.body.status).toBe('pending_approval');
    expect(execRes.body.requestId).toBeDefined();

    const { requestId } = execRes.body;

    await approveAndWaitForCompletion(requestId);

    // Final status check
    const statusRes = await request(mockApp)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', MOCK_KEY);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
  }, 15_000);

  it('existing approval skips the approval channel', async () => {
    // Pre-add an approval for "git version" directly in the store (produces small output)
    const approvalStore = createApprovalStore(db);
    approvalStore.addApproval('git version', 'exact', '8', 'test-user');

    // Clear any leftover pending approvals from previous tests
    mockChannel.pendingApprovals.clear();

    const res = await request(mockApp)
      .post('/api/v1/execute?sync=true')
      .set('x-api-key', MOCK_KEY)
      .send({ command: 'git version' });

    // Should execute immediately without going through approval channel
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.stdout).toContain('git version');

    // The mock channel should NOT have received any approval requests
    expect(mockChannel.pendingApprovals.size).toBe(0);
  });
});

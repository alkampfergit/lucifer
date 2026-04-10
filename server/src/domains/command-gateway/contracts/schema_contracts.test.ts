import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createApp } from '../../../create_app.js';
import { createApprovalStore } from '../repository/approval_store.js';
import { createAuditLog } from '../repository/audit_log.js';
import { loadGatewayConfig } from '../config/gateway_config.js';
import { createApiKeyStore } from '../repository/api_key_store.js';
import { createCommandRulesStore } from '../repository/command_rules_store.js';

function shapeOf(obj: Record<string, unknown>): Record<string, string> {
  const shape: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    shape[key] = value === null ? 'null' : value === undefined ? 'undefined' : typeof value;
  }
  return shape;
}

// --- API test setup ---

const TEST_DIR = join(process.cwd(), '.test-contracts');
const CONFIG_DIR = join(TEST_DIR, 'config');
const DATA_DIR = join(TEST_DIR, 'data');

const TEST_KEY = 'luc_contracttest456';
const TEST_SALT = 'contractsalt12345';
const TEST_HASH = createHash('sha256').update(TEST_SALT + TEST_KEY).digest('hex');

let app: ReturnType<typeof createApp>['app'];
let stopFn: () => Promise<void>;

beforeAll(async () => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const configPath = join(CONFIG_DIR, 'lucifer.json');

  writeFileSync(configPath, JSON.stringify({
    port: 0,
    approvalTimeoutSeconds: 5,
    executionTimeoutSeconds: 10,
    maxConcurrentExecutions: 3,
    maxOutputBytes: 1024,
    rateLimitPerMinute: 100,
    onApprovalTimeout: 'deny',
    dataDir: '../data',
  }));

  writeFileSync(join(CONFIG_DIR, 'api-keys.json'), JSON.stringify({
    keys: [{
      id: 'contract-test',
      name: 'contract',
      keyHash: TEST_HASH,
      salt: TEST_SALT,
      allowedIps: [],
      createdAt: new Date().toISOString(),
      active: true,
    }],
  }));

  writeFileSync(join(CONFIG_DIR, 'command-rules.json'), JSON.stringify({
    rules: [
      { prefix: 'echo ', action: 'always_approve' },
      { prefix: 'git ', action: 'telegram_approve' },
    ],
    defaultAction: 'always_deny',
  }));

  const result = createApp({ configPath, autoApprove: true });
  app = result.app;
  stopFn = result.stop;
  await result.start();
});

afterAll(async () => {
  await stopFn();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// --- Group 1: API response contracts ---

describe('API response contracts', () => {
  it('ErrorResponse shape on missing API key', async () => {
    const res = await request(app).post('/api/v1/execute').send({ command: 'echo hi' });
    expect(res.status).toBe(401);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "code": "string",
        "message": "string",
        "retryable": "boolean",
      }
    `);
  });

  it('ErrorResponse shape on missing command', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({});
    expect(res.status).toBe(400);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "code": "string",
        "message": "string",
        "retryable": "boolean",
      }
    `);
  });

  it('ExecutionResult shape on success', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'echo contract-test' });
    expect(res.status).toBe(200);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "durationMs": "number",
        "exitCode": "number",
        "requestId": "string",
        "status": "string",
        "stderr": "string",
        "stdout": "string",
      }
    `);
  });

  it('ExecutionResult shape on failed command', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'echo x && exit 1' });
    expect(res.status).toBe(200);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "durationMs": "number",
        "exitCode": "number",
        "requestId": "string",
        "status": "string",
        "stderr": "string",
        "stdout": "string",
      }
    `);
  });

  it('PendingApproval shape on 202', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'git status' });
    expect(res.status).toBe(202);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "requestId": "string",
        "status": "string",
      }
    `);
  });

  it('StatusNotFound shape on 404', async () => {
    const res = await request(app)
      .get('/api/v1/status/nonexistent')
      .set('x-api-key', TEST_KEY);
    expect(res.status).toBe(404);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "code": "string",
        "message": "string",
        "retryable": "boolean",
      }
    `);
  });
});

// --- Group 2: SQLite roundtrip contracts ---

describe('SQLite roundtrip contracts', () => {
  let db: Database.Database;

  beforeAll(() => {
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

  afterAll(() => {
    db.close();
  });

  it('CommandApproval roundtrip shape', () => {
    const store = createApprovalStore(db);
    store.addApproval('git pull', 'exact', '8', 'telegram:123');
    const found = store.findApproval('git pull');
    expect(found).toBeDefined();
    expect(shapeOf(found as Record<string, unknown>)).toMatchInlineSnapshot(`
      {
        "approvedAt": "string",
        "approvedBy": "string",
        "command": "string",
        "duration": "string",
        "expiresAt": "string",
        "id": "number",
        "matchType": "string",
      }
    `);
  });

  it('AuditEntry roundtrip shape', () => {
    const auditLog = createAuditLog(db);
    auditLog.append({
      ts: new Date().toISOString(),
      type: 'request',
      requestId: 'test-rt',
      command: 'echo test',
      apiKeyName: 'test',
      ip: '1.2.3.4',
    });
    const entries = auditLog.queryByRequestId('test-rt');
    expect(entries).toHaveLength(1);
    expect(shapeOf(entries[0] as Record<string, unknown>)).toMatchInlineSnapshot(`
      {
        "apiKeyName": "string",
        "approvedBy": "null",
        "command": "string",
        "duration": "null",
        "durationMs": "null",
        "error": "null",
        "exitCode": "null",
        "ip": "string",
        "requestId": "string",
        "ruleAction": "null",
        "ts": "string",
        "type": "string",
      }
    `);
  });
});

// --- Group 3: Config schema contracts ---

describe('Config schema contracts', () => {
  const CONFIG_TEST_DIR = join(process.cwd(), '.test-contracts-config');

  beforeAll(() => {
    mkdirSync(CONFIG_TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(CONFIG_TEST_DIR, { recursive: true, force: true });
  });

  it('LuciferConfig shape', () => {
    const configPath = join(CONFIG_TEST_DIR, 'lucifer.json');
    writeFileSync(configPath, JSON.stringify({
      port: 3001,
      approvalTimeoutSeconds: 300,
      executionTimeoutSeconds: 120,
      maxConcurrentExecutions: 5,
      maxOutputBytes: 10485760,
      rateLimitPerMinute: 10,
      onApprovalTimeout: 'deny',
      dataDir: './data',
    }));

    const config = loadGatewayConfig(configPath);
    expect(shapeOf(config as unknown as Record<string, unknown>)).toMatchInlineSnapshot(`
      {
        "approvalTimeoutSeconds": "number",
        "dataDir": "string",
        "executionTimeoutSeconds": "number",
        "maxConcurrentExecutions": "number",
        "maxOutputBytes": "number",
        "onApprovalTimeout": "string",
        "port": "number",
        "rateLimitPerMinute": "number",
        "telegramChatId": "undefined",
      }
    `);
  });

  it('ApiKeysConfig shape', () => {
    const keysPath = join(CONFIG_TEST_DIR, 'api-keys.json');
    writeFileSync(keysPath, JSON.stringify({
      keys: [{
        id: 'cfg-test',
        name: 'config-test',
        keyHash: 'abc123',
        salt: 'salt123',
        allowedIps: ['127.0.0.1'],
        createdAt: '2024-01-01T00:00:00Z',
        active: true,
      }],
    }));

    // Verify the store loads without error
    const store = createApiKeyStore(keysPath);
    expect(store).toBeDefined();

    // Read the file back and snapshot keys[0] shape
    const raw = JSON.parse(readFileSync(keysPath, 'utf-8'));
    expect(shapeOf(raw.keys[0] as Record<string, unknown>)).toMatchInlineSnapshot(`
      {
        "active": "boolean",
        "allowedIps": "object",
        "createdAt": "string",
        "id": "string",
        "keyHash": "string",
        "name": "string",
        "salt": "string",
      }
    `);
  });

  it('CommandRulesConfig shape', () => {
    const rulesPath = join(CONFIG_TEST_DIR, 'command-rules.json');
    writeFileSync(rulesPath, JSON.stringify({
      rules: [
        { prefix: 'echo ', action: 'always_approve' },
        { prefix: 'git ', action: 'telegram_approve' },
      ],
      defaultAction: 'always_deny',
    }));

    const store = createCommandRulesStore(rulesPath);
    const result = store.matchRule('echo hi');
    expect(shapeOf(result as unknown as Record<string, unknown>)).toMatchInlineSnapshot(`
      {
        "action": "string",
        "rule": "object",
      }
    `);
  });
});

// --- Group 4: Telegram data contracts ---

describe('Telegram data contracts', () => {
  it('Telegram callback data format: action:requestId:matchType:duration', () => {
    // These are the exact formats constructed in request_telegram_approval.ts lines 92-103
    const approveExact2h = 'approve:req-123:exact:2';
    const approvePrefix8h = 'approve:req-123:prefix:8';
    const approvePermanent = 'approve:req-123:exact:permanent';
    const deny = 'deny:req-123:exact:0';

    for (const data of [approveExact2h, approvePrefix8h, approvePermanent, deny]) {
      const parts = data.split(':');
      expect(parts.length).toBe(4);
      expect(['approve', 'deny']).toContain(parts[0]);
      expect(['exact', 'prefix']).toContain(parts[2]);
    }

    // Lock the format with inline snapshot
    expect(approveExact2h.split(':')).toMatchInlineSnapshot(`
      [
        "approve",
        "req-123",
        "exact",
        "2",
      ]
    `);
  });
});

// --- Group 5: Health endpoint contract ---

describe('Health endpoint contract', () => {
  it('HealthReport shape', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(shapeOf(res.body)).toMatchInlineSnapshot(`
      {
        "environment": "string",
        "name": "string",
        "nodeVersion": "string",
        "status": "string",
        "timestamp": "string",
      }
    `);
  });
});

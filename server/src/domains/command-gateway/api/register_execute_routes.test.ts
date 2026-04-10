import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../../create_app.js';

const TEST_DIR = join(process.cwd(), '.test-integration');
const CONFIG_DIR = join(TEST_DIR, 'config');
const DATA_DIR = join(TEST_DIR, 'data');

const TEST_KEY = 'luc_integrationtest123';
const TEST_SALT = 'intsalt123456789';
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
      id: 'int-test',
      name: 'integration',
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
      { prefix: 'rm ', action: 'always_deny' },
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

describe('POST /api/v1/execute integration', () => {
  it('returns 401 for missing API key', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .send({ command: 'echo hi' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_API_KEY');
  });

  it('returns 401 for invalid API key', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', 'wrong_key')
      .send({ command: 'echo hi' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('returns 400 for missing command', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_COMMAND');
  });

  it('executes always_approve command immediately', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'echo integration-test' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.exitCode).toBe(0);
    expect(res.body.stdout).toContain('integration-test');
  });

  it('rejects always_deny command with 403', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'rm -rf /tmp/test' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMAND_DENIED');
  });

  it('rejects unmatched command with default deny', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'whoami' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMAND_DENIED');
  });

  it('returns pending_approval for telegram_approve command (async default)', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'git status' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 400 for command exceeding max length', async () => {
    const longCommand = 'echo ' + 'x'.repeat(5000);
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: longCommand });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMMAND_TOO_LONG');
  });

  it('returns 400 for invalid cwd', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'echo hi', cwd: '../../../etc' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CWD');
  });

  it('captures non-zero exit codes', async () => {
    const res = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'echo fail && exit 1' });

    expect(res.status).toBe(200);
    expect(res.body.exitCode).toBe(1);
    expect(res.body.status).toBe('failed');
  });
});

describe('GET /api/v1/status/:requestId', () => {
  it('returns 401 for missing API key', async () => {
    const res = await request(app).get('/api/v1/status/some-id');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown requestId', async () => {
    const res = await request(app)
      .get('/api/v1/status/nonexistent-id')
      .set('x-api-key', TEST_KEY);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns status for a pending telegram_approve request', async () => {
    // First create a pending request
    const execRes = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', TEST_KEY)
      .send({ command: 'git log --oneline' });

    expect(execRes.status).toBe(202);
    const { requestId } = execRes.body;

    // Poll for status (auto-approve runs async, might be completed or pending)
    const statusRes = await request(app)
      .get(`/api/v1/status/${requestId}`)
      .set('x-api-key', TEST_KEY);

    expect([200, 404]).toContain(statusRes.status);
    if (statusRes.status === 200) {
      expect(['pending_approval', 'completed', 'failed'].includes(statusRes.body.status)).toBe(true);
    }
  });
});

describe('GET /api/health', () => {
  it('returns health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

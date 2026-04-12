import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from './create_app.js';

const CLI_PATH = resolve(__dirname, 'cli.ts');
const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');

/**
 * Run the CLI and collect output. The CLI process may not exit on its own
 * (e.g. pino keeps the event loop alive), so we kill it after collecting
 * output and detecting that the command has finished writing.
 */
function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI_PATH, ...args], {
      env: { ...process.env, LUCIFER_TELEGRAM_TOKEN: 'skip' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let gotOutput = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      child.kill('SIGTERM');
      resolve({ stdout, stderr, code: child.exitCode });
    }

    // Once we have received at least one chunk, wait for output to stop
    // for 1.5s before considering the command done.
    function resetIdle() {
      if (!gotOutput) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, 1500);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      gotOutput = true;
      resetIdle();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      gotOutput = true;
      resetIdle();
    });

    child.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(idleTimer);
        resolve({ stdout, stderr, code: child.exitCode });
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(idleTimer);
        reject(err);
      }
    });

    // Hard timeout safety net
    setTimeout(() => {
      if (!settled) {
        settled = true;
        clearTimeout(idleTimer);
        child.kill('SIGKILL');
        reject(new Error(`CLI timed out after 12s. stdout: ${stdout}`));
      }
    }, 12_000);
  });
}

describe('CLI smoke tests', () => {
  it('--help prints usage information', async () => {
    const { stdout } = await runCli('--help');
    expect(stdout).toContain('lucifer-gate');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--init');
    expect(stdout).toContain('--config');
  }, 15_000);

  describe('--init', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(process.cwd(), `.test-cli-init-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates all three config files in target directory', async () => {
      const { stdout } = await runCli('--init', tmpDir);

      expect(stdout).toContain('Config files generated');

      const configDir = join(tmpDir, 'config');
      expect(existsSync(join(configDir, 'lucifer.json'))).toBe(true);
      expect(existsSync(join(configDir, 'api-keys.json'))).toBe(true);
      expect(existsSync(join(configDir, 'command-rules.json'))).toBe(true);
    }, 15_000);

    it('refuses to overwrite existing config', async () => {
      // First init
      await runCli('--init', tmpDir);

      // Second init — should refuse
      const { stdout } = await runCli('--init', tmpDir);
      expect(stdout).toContain('Config already exists');
      expect(stdout).toContain('Delete it first');
    }, 30_000);

    it('generated API key and admin secret have valid formats', async () => {
      const { stdout } = await runCli('--init', tmpDir);

      // API key: luc_ + 48 hex chars
      const keyMatch = stdout.match(/(luc_[a-f0-9]{48})/);
      expect(keyMatch).not.toBeNull();

      // Admin secret: luc_admin_ + 48 hex chars
      const adminMatch = stdout.match(/(luc_admin_[a-f0-9]{48})/);
      expect(adminMatch).not.toBeNull();

      // They must be different credentials
      expect(keyMatch![1]).not.toBe(adminMatch![1]);
    }, 15_000);

    it('creates a working config that can be loaded', async () => {
      await runCli('--init', tmpDir);

      const configDir = join(tmpDir, 'config');
      const luciferConfig = JSON.parse(readFileSync(join(configDir, 'lucifer.json'), 'utf-8'));
      const apiKeysConfig = JSON.parse(readFileSync(join(configDir, 'api-keys.json'), 'utf-8'));
      const rulesConfig = JSON.parse(readFileSync(join(configDir, 'command-rules.json'), 'utf-8'));

      // lucifer.json has required fields
      expect(luciferConfig.port).toBe(3001);
      expect(luciferConfig.approvalTimeoutSeconds).toBeGreaterThan(0);
      expect(luciferConfig.executionTimeoutSeconds).toBeGreaterThan(0);
      expect(luciferConfig.dataDir).toBeDefined();

      // Admin secret hash is stored (not plaintext)
      expect(luciferConfig.adminSecretHash).toBeDefined();
      expect(luciferConfig.adminSecretSalt).toBeDefined();
      expect(luciferConfig.adminSecretHash.length).toBe(128); // scrypt 64 bytes = 128 hex

      // api-keys.json has a valid key entry
      expect(apiKeysConfig.keys).toHaveLength(1);
      expect(apiKeysConfig.keys[0].keyHash).toBeDefined();
      expect(apiKeysConfig.keys[0].salt).toBeDefined();
      expect(apiKeysConfig.keys[0].active).toBe(true);

      // command-rules.json has rules and defaultAction
      expect(rulesConfig.rules.length).toBeGreaterThan(0);
      expect(rulesConfig.defaultAction).toBe('always_deny');
    }, 15_000);
  });
});

// ─── Journey: First Configuration ───────────────────────────────────────────
// Admin runs --init, gets an API key, starts the server, executes a command.
// This is the complete first-run experience end-to-end.

describe('First configuration journey', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(process.cwd(), `.test-first-config-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init → start server → execute command with generated key', async () => {
    // Step 1: Run --init and capture the generated API key
    const { stdout } = await runCli('--init', tmpDir);
    const keyMatch = stdout.match(/(luc_[a-f0-9]{48})/);
    expect(keyMatch).not.toBeNull();
    const apiKey = keyMatch![1];

    // Step 2: Start the server with the generated config (auto-approve mode)
    const configPath = join(tmpDir, 'config', 'lucifer.json');
    const result = createApp({ configPath, autoApprove: true });

    try {
      await result.start();

      // Step 3: Execute a command that's in the default rules as always_approve
      const res = await request(result.app)
        .post('/api/v1/execute')
        .set('x-api-key', apiKey)
        .send({ command: 'echo first-run-works' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
      expect(res.body.exitCode).toBe(0);
      expect(res.body.stdout).toContain('first-run-works');

      // Step 4: Health endpoint works
      const healthRes = await request(result.app).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.status).toBe('ok');
    } finally {
      await result.stop();
    }
  }, 20_000);

  it('init → generated key is rejected for denied commands', async () => {
    const { stdout } = await runCli('--init', tmpDir);
    const apiKey = stdout.match(/(luc_[a-f0-9]{48})/)![1];

    const configPath = join(tmpDir, 'config', 'lucifer.json');
    const result = createApp({ configPath, autoApprove: true });

    try {
      await result.start();

      // "rm " is always_deny in the default rules
      const res = await request(result.app)
        .post('/api/v1/execute')
        .set('x-api-key', apiKey)
        .send({ command: 'rm -rf /tmp/test' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('COMMAND_DENIED');
    } finally {
      await result.stop();
    }
  }, 20_000);

  it('init → wrong API key is rejected', async () => {
    await runCli('--init', tmpDir);

    const configPath = join(tmpDir, 'config', 'lucifer.json');
    const result = createApp({ configPath, autoApprove: true });

    try {
      await result.start();

      const res = await request(result.app)
        .post('/api/v1/execute')
        .set('x-api-key', 'luc_wrong_key_value')
        .send({ command: 'echo hello' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_API_KEY');
    } finally {
      await result.stop();
    }
  }, 20_000);

  it('server refuses to start with invalid config JSON', async () => {
    const configDir = join(tmpDir, 'config');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(tmpDir, 'data'), { recursive: true });

    // Write invalid JSON
    writeFileSync(join(configDir, 'lucifer.json'), '{ broken json');

    expect(() => createApp({ configPath: join(configDir, 'lucifer.json') })).toThrow();
  });
});

// ─── Journey: Checking Logs & Stats ─────────────────────────────────────────
// Admin executes commands, then runs `lucifer-gate log` and `stats` to
// inspect activity. Tests the CLI output formatting and data accuracy.

describe('Log and stats journey', () => {
  let tmpDir: string;
  let apiKey: string;

  beforeEach(async () => {
    tmpDir = join(process.cwd(), `.test-log-stats-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Init config and capture key
    const { stdout } = await runCli('--init', tmpDir);
    apiKey = stdout.match(/(luc_[a-f0-9]{48})/)![1];

    // Execute some commands to populate the audit log
    const configPath = join(tmpDir, 'config', 'lucifer.json');
    const result = createApp({ configPath, autoApprove: true });
    await result.start();

    // Execute a few commands to create audit trail
    await request(result.app)
      .post('/api/v1/execute')
      .set('x-api-key', apiKey)
      .send({ command: 'echo log-test-one' });

    await request(result.app)
      .post('/api/v1/execute')
      .set('x-api-key', apiKey)
      .send({ command: 'echo log-test-two' });

    // A denied command
    await request(result.app)
      .post('/api/v1/execute')
      .set('x-api-key', apiKey)
      .send({ command: 'rm -rf /' });

    await result.stop();
  }, 30_000);

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('`log` shows recent audit entries with command text', async () => {
    const dataDir = join(tmpDir, 'data');
    const { stdout } = await runCli('log', '--data-dir', dataDir);

    // Should contain our executed commands
    expect(stdout).toContain('echo log-test-one');
    expect(stdout).toContain('echo log-test-two');
    // Should contain the audit entry types
    expect(stdout).toContain('REQUEST');
  }, 20_000);

  it('`log --limit 1` restricts output to 1 entry', async () => {
    const dataDir = join(tmpDir, 'data');
    const { stdout } = await runCli('log', '--data-dir', dataDir, '--limit', '1');

    // Filter to audit log lines (contain type names like REQUEST, EXECUTED, etc.)
    // Pino log lines start with timestamps like "[04:08:55.123]" — audit lines don't
    const auditLines = stdout.trim().split('\n').filter(l =>
      /\d{4}-\d{2}-\d{2}/.test(l) && /\b(REQUEST|EXECUTED|APPROVED|DENIED|RULE_MATCH|TELEGRAM_SENT)\b/.test(l),
    );
    expect(auditLines.length).toBe(1);
  }, 20_000);

  it('`stats` shows request counts and top commands', async () => {
    const dataDir = join(tmpDir, 'data');
    const { stdout } = await runCli('stats', '--data-dir', dataDir);

    expect(stdout).toContain('Lucifer Stats');
    expect(stdout).toContain('Total requests:');
    expect(stdout).toContain('Executed:');
    // We ran echo twice, so "echo" should appear in top commands
    expect(stdout).toContain('Top commands:');
    expect(stdout).toContain('echo');
  }, 20_000);

  it('`log` on empty database shows "No audit log entries"', async () => {
    // Create a fresh empty data dir
    const emptyDir = join(tmpDir, 'empty-data');
    mkdirSync(emptyDir, { recursive: true });

    const { stdout } = await runCli('log', '--data-dir', emptyDir);
    expect(stdout).toContain('No audit log entries');
  }, 20_000);
});

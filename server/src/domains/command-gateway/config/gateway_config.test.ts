import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGatewayConfig, getTelegramToken, getAdminSecret } from './gateway_config.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `lucifer-gw-config-test-${Date.now()}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, config: object): string {
  const filePath = join(dir, 'lucifer.json');
  writeFileSync(filePath, JSON.stringify(config));
  return filePath;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('loadGatewayConfig', () => {
  it('returns defaults when no configPath is provided', () => {
    vi.stubEnv('PORT', '');
    const config = loadGatewayConfig();
    expect(config.port).toBe(3001);
    expect(config.approvalTimeoutSeconds).toBe(300);
    expect(config.executionTimeoutSeconds).toBe(120);
    expect(config.maxConcurrentExecutions).toBe(5);
    expect(config.maxOutputBytes).toBe(10 * 1024 * 1024);
    expect(config.rateLimitPerMinute).toBe(10);
    expect(config.onApprovalTimeout).toBe('deny');
    expect(config.dataDir).toBe('./data');
  });

  it('overrides defaults with values from config file', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      port: 4000,
      approvalTimeoutSeconds: 600,
      onApprovalTimeout: 'approve-with-warning',
    });

    const config = loadGatewayConfig(filePath);
    expect(config.port).toBe(4000);
    expect(config.approvalTimeoutSeconds).toBe(600);
    expect(config.onApprovalTimeout).toBe('approve-with-warning');
    // Non-overridden defaults remain
    expect(config.executionTimeoutSeconds).toBe(120);
    expect(config.maxConcurrentExecutions).toBe(5);
  });

  it('throws when config has wrong types', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { port: 'not-a-number' });

    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });

  it('accepts and preserves the per-IP and per-key rate-limit overrides', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      rateLimitPerMinute: 50,
      rateLimitPerIpPerMinute: 200,
      rateLimitPerKeyPerMinute: 20,
    });

    const config = loadGatewayConfig(filePath);
    expect(config.rateLimitPerMinute).toBe(50);
    expect(config.rateLimitPerIpPerMinute).toBe(200);
    expect(config.rateLimitPerKeyPerMinute).toBe(20);
  });

  it('leaves per-IP and per-key overrides undefined when only the legacy shared limit is set', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { rateLimitPerMinute: 77 });

    const config = loadGatewayConfig(filePath);
    expect(config.rateLimitPerMinute).toBe(77);
    expect(config.rateLimitPerIpPerMinute).toBeUndefined();
    expect(config.rateLimitPerKeyPerMinute).toBeUndefined();
  });

  it('rejects non-numeric per-IP or per-key rate-limit values', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { rateLimitPerKeyPerMinute: 'lots' });

    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });

  it('accepts extra unknown fields for forward compatibility', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { futureField: 'hello', anotherOne: 42 });

    expect(() => loadGatewayConfig(filePath)).not.toThrow();
    const config = loadGatewayConfig(filePath);
    expect(config.port).toBe(3001);
  });

  it('loads a valid aliases map with bash and elf entries', () => {
    const dir = createTempDir();
    const buildPath = join(tmpdir(), 'scripts', 'build.sh');
    const filePath = writeConfig(dir, {
      aliases: {
        build: { path: buildPath, type: 'bash' },
        hello: { path: '/opt/bin/hello', type: 'elf' },
      },
    });
    const config = loadGatewayConfig(filePath);
    expect(config.aliases).toEqual({
      build: { path: buildPath, type: 'bash' },
      hello: { path: '/opt/bin/hello', type: 'elf' },
    });
  });

  it('rejects aliases with an unknown type', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      aliases: { bad: { path: join(tmpdir(), 'x.sh'), type: 'python' } },
    });
    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });

  it('rejects aliases with a missing or empty path', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      aliases: { bad: { path: '', type: 'bash' } },
    });
    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });

  it('preserves absolute alias paths unchanged', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      aliases: { deploy: { path: '/opt/ops/deploy.sh', type: 'bash' } },
    });
    const config = loadGatewayConfig(filePath);
    expect(config.aliases?.deploy.path).toBe('/opt/ops/deploy.sh');
  });

  it('normalizes relative alias paths against the config file directory', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      aliases: { deploy: { path: './scripts/deploy.sh', type: 'bash' } },
    });
    const config = loadGatewayConfig(filePath);
    expect(config.aliases?.deploy.path).toBe(join(dir, 'scripts', 'deploy.sh'));
  });

  it('loads an alias with fixed args', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      aliases: { summary: { path: '/opt/bin/smtp', type: 'elf', args: ['summary', '--unread'] } },
    });
    const config = loadGatewayConfig(filePath);
    expect(config.aliases?.summary.args).toEqual(['summary', '--unread']);
  });

  it('rejects an alias whose args is not an array of strings', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, {
      aliases: { bad: { path: '/opt/bin/smtp', type: 'elf', args: ['ok', 42] } },
    });
    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });

  it('normalizes relative toolsPath entries against the config file directory', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { toolsPath: ['./bin', '../shared/tools'] });
    const config = loadGatewayConfig(filePath);
    expect(config.toolsPath).toEqual([join(dir, 'bin'), join(dir, '..', 'shared', 'tools')]);
  });

  it('preserves an already-absolute toolsPath entry unchanged', () => {
    const dir = createTempDir();
    const absoluteToolsDir = resolve(tmpdir(), 'lucifer-toolspath-absolute-fixture');
    const filePath = writeConfig(dir, { toolsPath: [absoluteToolsDir] });
    const config = loadGatewayConfig(filePath);
    expect(config.toolsPath).toEqual([absoluteToolsDir]);
  });

  it('rejects a toolsPath that is not an array of strings', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { toolsPath: ['ok', 42] });
    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });

  it('rejects a toolsPath containing an empty string', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { toolsPath: [''] });
    expect(() => loadGatewayConfig(filePath)).toThrow('failed validation');
  });
});

describe('getTelegramToken', () => {
  it('returns the token when env var is set', () => {
    vi.stubEnv('LUCIFER_TELEGRAM_TOKEN', 'test-token-123');
    expect(getTelegramToken()).toBe('test-token-123');
  });

  it('throws when env var is not set', () => {
    vi.stubEnv('LUCIFER_TELEGRAM_TOKEN', '');
    expect(() => getTelegramToken()).toThrow('LUCIFER_TELEGRAM_TOKEN environment variable is required');
  });
});

describe('getAdminSecret', () => {
  it('returns the secret when env var is set', () => {
    vi.stubEnv('LUCIFER_ADMIN_SECRET', 'my-secret');
    expect(getAdminSecret()).toBe('my-secret');
  });

  it('returns undefined when env var is not set', () => {
    delete process.env.LUCIFER_ADMIN_SECRET;
    expect(getAdminSecret()).toBeUndefined();
  });
});

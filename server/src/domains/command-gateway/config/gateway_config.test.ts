import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGatewayConfig, getTelegramToken, getAdminSecret } from './gateway_config.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `lucifer-gw-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('accepts extra unknown fields for forward compatibility', () => {
    const dir = createTempDir();
    const filePath = writeConfig(dir, { futureField: 'hello', anotherOne: 42 });

    expect(() => loadGatewayConfig(filePath)).not.toThrow();
    const config = loadGatewayConfig(filePath);
    expect(config.port).toBe(3001);
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

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../create_app.js';

export interface TestAppContext {
  app: ReturnType<typeof createApp>['app'];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  testKey: string;
  testDir: string;
}

export function createTestAppContext(
  label: string,
  options?: {
    extraRules?: Array<{ prefix: string; action: string }>;
  },
): TestAppContext {
  const testDir = join(process.cwd(), `.test-${label}`);
  const configDir = join(testDir, 'config');
  const dataDir = join(testDir, 'data');

  const testKey = `luc_${label}key123`;
  const testSalt = `${label}salt123456789`;
  const testHash = createHash('sha256').update(testSalt + testKey).digest('hex');

  mkdirSync(configDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const configPath = join(configDir, 'lucifer.json');

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

  writeFileSync(join(configDir, 'api-keys.json'), JSON.stringify({
    keys: [{
      id: `${label}-test`,
      name: label,
      keyHash: testHash,
      salt: testSalt,
      allowedIps: [],
      createdAt: new Date().toISOString(),
      active: true,
    }],
  }));

  const rules = [
    { prefix: 'echo ', action: 'always_approve' },
    { prefix: 'git ', action: 'telegram_approve' },
    ...(options?.extraRules ?? []),
  ];

  writeFileSync(join(configDir, 'command-rules.json'), JSON.stringify({
    rules,
    defaultAction: 'always_deny',
  }));

  const result = createApp({ configPath, autoApprove: true });

  return {
    app: result.app,
    start: result.start,
    stop: async () => {
      await result.stop();
      rmSync(testDir, { recursive: true, force: true });
    },
    testKey,
    testDir,
  };
}

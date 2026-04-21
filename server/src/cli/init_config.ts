import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateApiKey, generateAdminSecret } from '../domains/command-gateway/repository/api_key_store.js';

export function initConfig(targetDir: string) {
  const configDir = resolve(targetDir, 'config');
  const dataDir = resolve(targetDir, 'data');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const luciferJsonPath = join(configDir, 'lucifer.json');
  const apiKeysPath = join(configDir, 'api-keys.json');
  const commandRulesPath = join(configDir, 'command-rules.json');
  const proxyConfigPath = join(configDir, 'proxy-config.json');

  if (existsSync(luciferJsonPath)) {
    console.log(`Config already exists: ${luciferJsonPath}`);
    console.log('Delete it first if you want to regenerate.');
    return;
  }

  const { key, salt, keyHash } = generateApiKey();
  const { secret: adminSecret, salt: adminSalt, secretHash: adminHash } = generateAdminSecret();

  writeFileSync(luciferJsonPath, JSON.stringify({
    port: 3001,
    adminSecretHash: adminHash,
    adminSecretSalt: adminSalt,
    approvalTimeoutSeconds: 300,
    executionTimeoutSeconds: 120,
    maxConcurrentExecutions: 5,
    maxOutputBytes: 10485760,
    rateLimitPerMinute: 10,
    onApprovalTimeout: 'deny',
    dataDir: '../data',
    logFile: 'lucifer.log',
  }, null, 2) + '\n');

  writeFileSync(apiKeysPath, JSON.stringify({
    keys: [{
      id: crypto.randomUUID(),
      name: 'default',
      keyHash,
      salt,
      allowedIps: [],
      createdAt: new Date().toISOString(),
      active: true,
    }],
  }, null, 2) + '\n');

  writeFileSync(commandRulesPath, JSON.stringify({
    rules: [
      { prefix: 'echo ', action: 'always_approve' },
      { prefix: 'git status', action: 'always_approve' },
      { prefix: 'git pull', action: 'manual_approve' },
      { prefix: 'git push', action: 'manual_approve' },
      { prefix: 'npm test', action: 'always_approve' },
      { prefix: 'npm run', action: 'manual_approve' },
      { prefix: 'rm ', action: 'always_deny' },
    ],
    defaultAction: 'always_deny',
  }, null, 2) + '\n');

  writeFileSync(proxyConfigPath, JSON.stringify({
    proxies: [],
  }, null, 2) + '\n');

  console.log('Config files generated:');
  console.log(`  ${luciferJsonPath}`);
  console.log(`  ${apiKeysPath}`);
  console.log(`  ${commandRulesPath}`);
  console.log(`  ${proxyConfigPath}`);
  console.log('');
  console.log('Your API key (save this, it cannot be recovered):');
  console.log(`  ${key}`);
  console.log('');
  console.log('Your admin secret for the web approval UI (save this, it cannot be recovered):');
  console.log(`  ${adminSecret}`);
  console.log('');
  console.log('Quick start:');
  console.log('  # Dev mode (no Telegram needed):');
  console.log(`  LUCIFER_TELEGRAM_TOKEN=skip lucifer-gate --config ${luciferJsonPath} --auto-approve`);
  console.log('');
  console.log('  # Production — pair your Telegram chat first:');
  console.log(`  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate pair --config ${luciferJsonPath}`);
  console.log('');
  console.log('  # Then start the server:');
  console.log(`  LUCIFER_TELEGRAM_TOKEN=your_token lucifer-gate --config ${luciferJsonPath}`);
}

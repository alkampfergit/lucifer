import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandRulesStore } from '../repository/command_rules_store.js';

function createTestRulesFile(rules: object): string {
  const dir = join(tmpdir(), `lucifer-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'command-rules.json');
  writeFileSync(path, JSON.stringify(rules));
  return path;
}

describe('CommandRulesStore.matchRule', () => {
  it('matches exact prefix', () => {
    const path = createTestRulesFile({
      rules: [
        { prefix: 'git pull', action: 'manual_approve' },
        { prefix: 'echo ', action: 'always_approve' },
      ],
      defaultAction: 'always_deny',
    });
    const store = createCommandRulesStore(path);

    const result = store.matchRule('echo hello world');
    expect(result.action).toBe('always_approve');
    expect(result.rule?.prefix).toBe('echo ');
  });

  it('matches first rule when multiple match', () => {
    const path = createTestRulesFile({
      rules: [
        { prefix: 'git', action: 'always_deny' },
        { prefix: 'git pull', action: 'always_approve' },
      ],
      defaultAction: 'always_deny',
    });
    const store = createCommandRulesStore(path);

    const result = store.matchRule('git pull origin main');
    expect(result.action).toBe('always_deny');
  });

  it('returns default action when no rule matches', () => {
    const path = createTestRulesFile({
      rules: [{ prefix: 'echo ', action: 'always_approve' }],
      defaultAction: 'always_deny',
    });
    const store = createCommandRulesStore(path);

    const result = store.matchRule('whoami');
    expect(result.action).toBe('always_deny');
    expect(result.rule).toBeNull();
  });

  it('handles manual_approve action', () => {
    const path = createTestRulesFile({
      rules: [{ prefix: 'npm run', action: 'manual_approve' }],
      defaultAction: 'always_deny',
    });
    const store = createCommandRulesStore(path);

    const result = store.matchRule('npm run build');
    expect(result.action).toBe('manual_approve');
  });

  it('trims command whitespace', () => {
    const path = createTestRulesFile({
      rules: [{ prefix: 'echo ', action: 'always_approve' }],
      defaultAction: 'always_deny',
    });
    const store = createCommandRulesStore(path);

    const result = store.matchRule('  echo hello');
    expect(result.action).toBe('always_approve');
  });

  it('defaults to always_deny when no defaultAction', () => {
    const path = createTestRulesFile({ rules: [] });
    const store = createCommandRulesStore(path);

    const result = store.matchRule('anything');
    expect(result.action).toBe('always_deny');
  });
});

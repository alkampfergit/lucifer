import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { updateJsonConfig } from './json_config_writer.js';

describe('updateJsonConfig', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `lucifer-test-${Date.now()}-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds a new field to an existing config', () => {
    writeFileSync(filePath, JSON.stringify({ port: 3001 }, null, 2) + '\n');

    updateJsonConfig(filePath, { telegramChatId: '12345' });

    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(result).toEqual({ port: 3001, telegramChatId: '12345' });
  });

  it('preserves existing fields when adding new ones', () => {
    const original = { port: 3001, approvalTimeoutSeconds: 300, dataDir: './data' };
    writeFileSync(filePath, JSON.stringify(original, null, 2) + '\n');

    updateJsonConfig(filePath, { telegramChatId: '99999' });

    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(result).toEqual({ ...original, telegramChatId: '99999' });
  });

  it('overwrites an existing field', () => {
    writeFileSync(filePath, JSON.stringify({ port: 3001, telegramChatId: 'old' }, null, 2) + '\n');

    updateJsonConfig(filePath, { telegramChatId: 'new' });

    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(result.telegramChatId).toBe('new');
  });

  it('throws when file does not exist', () => {
    expect(() => updateJsonConfig(join(dir, 'missing.json'), { a: 1 }))
      .toThrow(/Config file not found/);
  });

  it('throws when file contains invalid JSON', () => {
    writeFileSync(filePath, 'not json at all');

    expect(() => updateJsonConfig(filePath, { a: 1 }))
      .toThrow(/Invalid JSON/);
  });

  it('writes with 2-space indentation and trailing newline', () => {
    writeFileSync(filePath, '{"a":1}\n');

    updateJsonConfig(filePath, { b: 2 });

    const raw = readFileSync(filePath, 'utf-8');
    expect(raw).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });
});

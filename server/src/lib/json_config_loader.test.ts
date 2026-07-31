import { describe, it, expect, afterEach } from 'vitest';
import { loadJsonConfig } from './json_config_loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `lucifer-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function isTestConfig(data: unknown): data is { name: string } {
  return typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).name === 'string';
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('loadJsonConfig', () => {
  it('loads valid JSON from primary file', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ name: 'test' }));

    const result = loadJsonConfig(filePath, isTestConfig);
    expect(result).toEqual({ name: 'test' });
  });

  it('falls back to .bak when primary is missing', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath + '.bak', JSON.stringify({ name: 'backup' }));

    const result = loadJsonConfig(filePath, isTestConfig);
    expect(result).toEqual({ name: 'backup' });
  });

  it('throws when both primary and .bak are missing', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');

    expect(() => loadJsonConfig(filePath, isTestConfig)).toThrow('Cannot read config file');
  });

  it('throws on invalid JSON in primary file', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, 'not{json');

    expect(() => loadJsonConfig(filePath, isTestConfig)).toThrow('Invalid JSON');
  });

  it('throws when valid JSON fails validation', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ wrong: true }));

    expect(() => loadJsonConfig(filePath, isTestConfig)).toThrow('failed validation');
  });

  it('throws when primary is missing and .bak has invalid JSON', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath + '.bak', 'not{json');

    expect(() => loadJsonConfig(filePath, isTestConfig)).toThrow('Invalid JSON');
  });

  it('includes the file path and the underlying parser reason in the JSON error', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, 'not{json');

    try {
      loadJsonConfig(filePath, isTestConfig);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toContain(filePath);
      // Node's JSON.parse error text (e.g. "Unexpected token" / "position 0") should surface, not be swallowed.
      expect(message).not.toBe(`Invalid JSON in config file: ${filePath}`);
    }
  });

  it('gives distinct, identifiable messages for a trailing comma vs. an unquoted key', () => {
    const dir = createTempDir();

    const trailingCommaPath = join(dir, 'trailing-comma.json');
    writeFileSync(trailingCommaPath, '{"name": "test",}');
    let trailingCommaMessage = '';
    try {
      loadJsonConfig(trailingCommaPath, isTestConfig);
    } catch (err) {
      trailingCommaMessage = (err as Error).message;
    }

    const unquotedKeyPath = join(dir, 'unquoted-key.json');
    writeFileSync(unquotedKeyPath, '{name: "test"}');
    let unquotedKeyMessage = '';
    try {
      loadJsonConfig(unquotedKeyPath, isTestConfig);
    } catch (err) {
      unquotedKeyMessage = (err as Error).message;
    }

    expect(trailingCommaMessage).toContain(trailingCommaPath);
    expect(unquotedKeyMessage).toContain(unquotedKeyPath);
    expect(trailingCommaMessage).not.toEqual(unquotedKeyMessage);
  });

  it('strips a leading UTF-8 BOM instead of failing to parse (common with Windows/OneDrive-saved files)', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    const bom = '﻿';
    writeFileSync(filePath, bom + JSON.stringify({ name: 'test' }));

    const result = loadJsonConfig(filePath, isTestConfig);
    expect(result).toEqual({ name: 'test' });
  });

  it('reports validation failures separately from parse failures, with the file path', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ wrong: true }));

    try {
      loadJsonConfig(filePath, isTestConfig);
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('failed validation');
      expect(message).toContain(filePath);
      expect(message).not.toContain('Invalid JSON');
    }
  });
});

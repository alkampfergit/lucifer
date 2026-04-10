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
});

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readPackageVersion } from './package_version.js';

const tempDirs: string[] = [];

function writeManifest(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lucifer-package-version-'));
  tempDirs.push(dir);
  const manifestPath = join(dir, 'package.json');
  writeFileSync(manifestPath, contents);
  return manifestPath;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('readPackageVersion', () => {
  it('reads the version of the installed package by default', () => {
    const manifestPath = resolve(import.meta.dirname, '../../../package.json');
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(readPackageVersion()).toBe((manifest as { version: string }).version);
  });

  it('returns the version from the manifest it is given', () => {
    const manifestPath = writeManifest(JSON.stringify({ name: 'lucifer-gate', version: '9.9.9-rc.1' }));

    expect(readPackageVersion(manifestPath)).toBe('9.9.9-rc.1');
  });

  it('names the path when the manifest is missing', () => {
    const missing = join(tmpdir(), 'lucifer-package-version-absent', 'package.json');

    expect(() => readPackageVersion(missing)).toThrow(/Cannot read package manifest.*package\.json/s);
  });

  it('names the path when the manifest is not valid JSON', () => {
    const manifestPath = writeManifest('{ "version": ');

    expect(() => readPackageVersion(manifestPath)).toThrow(/Invalid JSON in package manifest/);
  });

  it('rejects a manifest without a usable version rather than reporting a blank one', () => {
    const noVersion = writeManifest(JSON.stringify({ name: 'lucifer-gate' }));
    const blankVersion = writeManifest(JSON.stringify({ name: 'lucifer-gate', version: '   ' }));
    const numericVersion = writeManifest(JSON.stringify({ name: 'lucifer-gate', version: 1 }));

    expect(() => readPackageVersion(noVersion)).toThrow(/no version string/);
    expect(() => readPackageVersion(blankVersion)).toThrow(/no version string/);
    expect(() => readPackageVersion(numericVersion)).toThrow(/no version string/);
  });
});

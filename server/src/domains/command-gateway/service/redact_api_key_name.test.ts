import { describe, it, expect } from 'vitest';
import { redactApiKeyName } from './redact_api_key_name.js';

describe('redactApiKeyName', () => {
  it('returns <none> for null', () => {
    expect(redactApiKeyName(null)).toBe('<none>');
  });

  it('returns <none> for undefined', () => {
    expect(redactApiKeyName(undefined)).toBe('<none>');
  });

  it('returns <none> for the empty string', () => {
    expect(redactApiKeyName('')).toBe('<none>');
  });

  it('masks names of length ≤ 3 with ***', () => {
    expect(redactApiKeyName('a')).toBe('***');
    expect(redactApiKeyName('ab')).toBe('***');
    expect(redactApiKeyName('abc')).toBe('***');
  });

  it('keeps first two and last one character for longer names', () => {
    expect(redactApiKeyName('prod')).toBe('pr***d');
    expect(redactApiKeyName('production-deploy')).toBe('pr***y');
    expect(redactApiKeyName('ci-runner-42')).toBe('ci***2');
  });

  it('does not leak the middle of the name', () => {
    const secretish = 'super-secret-key-name';
    const redacted = redactApiKeyName(secretish);
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('key-name');
  });
});

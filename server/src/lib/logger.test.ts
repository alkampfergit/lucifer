import { describe, it, expect } from 'vitest';
import { createConsoleStream, parseLogFormat } from './logger.js';

describe('parseLogFormat', () => {
  it('accepts the supported console formats', () => {
    expect(parseLogFormat('pretty')).toBe('pretty');
    expect(parseLogFormat('json')).toBe('json');
  });

  it('rejects anything else, including a missing value', () => {
    expect(parseLogFormat('JSON')).toBeUndefined();
    expect(parseLogFormat('text')).toBeUndefined();
    expect(parseLogFormat(undefined)).toBeUndefined();
  });
});

describe('createConsoleStream', () => {
  it('writes JSON straight to stdout', () => {
    expect(createConsoleStream('json')).toBe(process.stdout);
  });

  it('wraps stdout in a pretty printer for the pretty format', () => {
    expect(createConsoleStream('pretty')).not.toBe(process.stdout);
  });
});

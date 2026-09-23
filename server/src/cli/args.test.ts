import { describe, it, expect } from 'vitest';
import { findUnknownOption, getArgValue } from './args.js';

const SERVER_OPTIONS = {
  valueFlags: ['--config', '--port'],
  booleanFlags: ['--auto-approve'],
} as const;

describe('getArgValue', () => {
  it('returns the value that follows the flag', () => {
    expect(getArgValue(['--config', '/etc/lucifer.json'], '--config')).toBe('/etc/lucifer.json');
  });

  it('returns undefined when the flag is absent or has no value', () => {
    expect(getArgValue(['start'], '--config')).toBeUndefined();
    expect(getArgValue(['start', '--config'], '--config')).toBeUndefined();
  });
});

describe('findUnknownOption', () => {
  it('accepts every documented server option', () => {
    const args = ['start', '--config', './config/lucifer.json', '--port', '3999', '--auto-approve'];

    expect(findUnknownOption(args, SERVER_OPTIONS)).toBeUndefined();
  });

  it('reports an option the server does not accept', () => {
    expect(findUnknownOption(['--version'], SERVER_OPTIONS)).toBe('--version');
    expect(findUnknownOption(['--config', 'x', '--data-dir', './data'], SERVER_OPTIONS)).toBe('--data-dir');
  });

  it('reports the first unknown option when there are several', () => {
    expect(findUnknownOption(['--nope', '--also-nope'], SERVER_OPTIONS)).toBe('--nope');
  });

  it('treats the argument after a value flag as a value, not an option', () => {
    expect(findUnknownOption(['--config', '--weird-path'], SERVER_OPTIONS)).toBeUndefined();
  });

  it('ignores positional arguments, which the caller validates separately', () => {
    expect(findUnknownOption(['start'], SERVER_OPTIONS)).toBeUndefined();
    expect(findUnknownOption([], SERVER_OPTIONS)).toBeUndefined();
  });
});

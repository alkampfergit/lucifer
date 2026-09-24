import { describe, it, expect, vi, afterEach } from 'vitest';
import { createConsoleStream, logger, parseLogFormat, warnOnUnknownLogFormatEnv } from './logger.js';

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

describe('warnOnUnknownLogFormatEnv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays quiet for a supported or unset LOG_FORMAT', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnOnUnknownLogFormatEnv('json');
    warnOnUnknownLogFormatEnv(undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and names the value for an unsupported LOG_FORMAT', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnOnUnknownLogFormatEnv('xml');
    expect(warn).toHaveBeenCalledWith({ LOG_FORMAT: 'xml' }, expect.stringContaining('Unknown LOG_FORMAT'));
  });
});

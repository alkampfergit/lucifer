import type { ShellRiskAnalysis } from '../types/command_types.js';

const DANGER_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\|/, warning: 'Pipe (|) detected: output is passed to another command' },
  { pattern: /&&/, warning: 'Chained command (&&): runs a second command on success' },
  { pattern: /;/, warning: 'Semicolon (;): runs multiple commands sequentially' },
  { pattern: /`[^`]*`/, warning: 'Backtick command substitution detected' },
  { pattern: /\$\(/, warning: 'Command substitution $() detected' },
  { pattern: />>?\s/, warning: 'Output redirect (>) detected: writes to file' },
  { pattern: /<\s/, warning: 'Input redirect (<) detected' },
  { pattern: /\brm\s+-r/, warning: 'Recursive delete (rm -r) detected' },
  { pattern: /\bsudo\b/, warning: 'sudo: runs with elevated privileges' },
  { pattern: /\bcurl\b.*\|\s*\b(bash|sh|zsh)\b/, warning: 'curl piped to shell: remote code execution' },
  { pattern: /\beval\b/, warning: 'eval: executes dynamically constructed commands' },
];

const WARNING_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\bdd\b/, warning: 'dd: disk/device operations' },
  { pattern: /\bchmod\b/, warning: 'chmod: changes file permissions' },
  { pattern: /\bchown\b/, warning: 'chown: changes file ownership' },
  { pattern: /\bmkfs\b/, warning: 'mkfs: formats filesystem' },
  { pattern: /\bkill\b/, warning: 'kill: terminates processes' },
];

export function analyzeCommandRisk(command: string): ShellRiskAnalysis {
  const warnings: string[] = [];
  let hasDanger = false;

  for (const { pattern, warning } of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(warning);
      hasDanger = true;
    }
  }

  for (const { pattern, warning } of WARNING_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(warning);
    }
  }

  let level: ShellRiskAnalysis['level'] = 'safe';
  if (hasDanger) {
    level = 'danger';
  } else if (warnings.length > 0) {
    level = 'warning';
  }

  return { level, warnings };
}

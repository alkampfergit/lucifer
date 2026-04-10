import type { CommandRule, CommandRulesConfig, RuleAction } from '../types/command_types.js';
import { loadJsonConfig } from '../../../lib/json_config_loader.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('command-rules');

function isCommandRulesConfig(data: unknown): data is CommandRulesConfig {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.rules)) return false;
  const validActions = ['always_approve', 'telegram_approve', 'always_deny'];
  for (const rule of d.rules) {
    if (typeof rule !== 'object' || rule === null) return false;
    const r = rule as Record<string, unknown>;
    if (typeof r.prefix !== 'string') return false;
    if (typeof r.action !== 'string' || !validActions.includes(r.action)) return false;
  }
  if (d.defaultAction !== undefined && !validActions.includes(d.defaultAction as string)) return false;
  return true;
}

export interface CommandRulesStore {
  matchRule(command: string): { rule: CommandRule; action: RuleAction } | { rule: null; action: RuleAction };
  reload(): void;
}

export function createCommandRulesStore(configPath: string): CommandRulesStore {
  let config: CommandRulesConfig;

  function load() {
    config = loadJsonConfig(configPath, isCommandRulesConfig);
    if (!config.defaultAction) {
      config.defaultAction = 'always_deny';
    }
    log.info({ ruleCount: config.rules.length, defaultAction: config.defaultAction }, 'Command rules loaded');
  }

  load();

  return {
    matchRule(command: string) {
      const trimmed = command.trim();
      for (const rule of config.rules) {
        if (trimmed.startsWith(rule.prefix)) {
          log.debug({ command: trimmed, matchedPrefix: rule.prefix, action: rule.action }, 'Rule matched');
          return { rule, action: rule.action };
        }
      }
      log.debug({ command: trimmed, action: config.defaultAction }, 'No rule matched, using default');
      return { rule: null, action: config.defaultAction };
    },

    reload() {
      load();
    },
  };
}

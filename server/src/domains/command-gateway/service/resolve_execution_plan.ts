import type { AliasesConfig, RuleAction } from '../types/command_types.js';
import type { ApprovalStore, CommandRulesStore } from '../types/store_interfaces.js';
import { findAliasArgsBypass, resolveAlias } from './resolve_alias.js';

/**
 * Decision shape the route handler acts on. Each kind is terminal: the caller
 * inspects `kind` and performs the matching audit + HTTP response. Keeping
 * this pure means it is straightforward to unit-test the (b) rule-resolution
 * + risk-analysis phase of the execute pipeline in isolation (see #30).
 */
export type ExecutionPlan =
  | { kind: 'alias-args-bypass'; alias: string }
  | { kind: 'rule-deny'; aliasAudit: AliasAudit; ruleAction: RuleAction }
  | { kind: 'always-approve'; aliasAudit: AliasAudit; ruleAction: RuleAction }
  | { kind: 'cached-approval'; aliasAudit: AliasAudit; ruleAction: RuleAction }
  | { kind: 'manual-approve'; aliasAudit: AliasAudit; ruleAction: RuleAction };

export type AliasAudit =
  | { aliasPath: string; aliasType: import('../types/command_types.js').AliasType }
  | Record<string, never>;

export interface ResolveExecutionPlanDeps {
  command: string;
  aliases: AliasesConfig | undefined;
  commandRulesStore: CommandRulesStore;
  approvalStore: ApprovalStore;
}

/**
 * Pure decision function — no audit writes, no HTTP, no I/O side effects.
 *
 * Order of checks (invariant; ADR-009):
 *  1. Alias-args bypass detection — reject commands that look like alias
 *     invocations with arguments so they never fall through to a rule match.
 *  2. Alias resolution for audit enrichment.
 *  3. Command-rule match → deny / always-approve / manual-approve branch.
 *  4. For `manual_approve`, probe the approval store for an existing cached
 *     approval before asking a human.
 */
export function resolveExecutionPlan(deps: ResolveExecutionPlanDeps): ExecutionPlan {
  const { command, aliases, commandRulesStore, approvalStore } = deps;

  const aliasBypass = findAliasArgsBypass(command, aliases);
  if (aliasBypass) {
    return { kind: 'alias-args-bypass', alias: aliasBypass };
  }

  const resolved = resolveAlias(command, aliases);
  const aliasAudit: AliasAudit = resolved
    ? { aliasPath: resolved.path, aliasType: resolved.type }
    : {};

  const ruleMatch = commandRulesStore.matchRule(command);
  const ruleAction = ruleMatch.action;

  if (ruleAction === 'always_deny') {
    return { kind: 'rule-deny', aliasAudit, ruleAction };
  }
  if (ruleAction === 'always_approve') {
    return { kind: 'always-approve', aliasAudit, ruleAction };
  }

  // manual_approve — check cached approval first.
  if (approvalStore.findApproval(command)) {
    return { kind: 'cached-approval', aliasAudit, ruleAction };
  }
  return { kind: 'manual-approve', aliasAudit, ruleAction };
}

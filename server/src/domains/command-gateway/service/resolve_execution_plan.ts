import type { AliasesConfig } from '../types/command_types.js';
import type { ApprovalStore, CommandRulesStore } from '../types/store_interfaces.js';
import { findAliasArgsBypass, resolveAlias } from './resolve_alias.js';
import type { AliasAudit } from './execute_and_audit.js';

export type { AliasAudit };

/**
 * Decision shape the route handler acts on. Each kind is terminal: the caller
 * inspects `kind` and performs the matching audit + HTTP response. Keeping
 * this as a pure decision function means the (b) rule-resolution +
 * risk-analysis phase of the execute pipeline (see #30) is unit-testable in
 * isolation.
 *
 * Per-variant `ruleAction` is the specific literal produced by the check
 * that selected that variant, so a `kind: 'always-approve'` plan cannot
 * carry `ruleAction: 'always_deny'`.
 */
export type ExecutionPlan =
  | { kind: 'alias-args-bypass'; alias: string }
  | { kind: 'rule-deny'; aliasAudit: AliasAudit; ruleAction: 'always_deny' }
  | { kind: 'always-approve'; aliasAudit: AliasAudit; ruleAction: 'always_approve' }
  | { kind: 'cached-approval'; aliasAudit: AliasAudit; ruleAction: 'manual_approve' }
  | { kind: 'manual-approve'; aliasAudit: AliasAudit; ruleAction: 'manual_approve' };

export interface ResolveExecutionPlanDeps {
  command: string;
  aliases: AliasesConfig | undefined;
  commandRulesStore: CommandRulesStore;
  approvalStore: ApprovalStore;
}

/**
 * Pure decision function — no audit writes, no HTTP response, no filesystem
 * or network I/O. It does read from the injected rule/approval stores
 * (which may perform their own lookup, e.g. SQLite `findApproval`), but
 * the function itself is side-effect-free relative to the execute
 * pipeline: it produces a decision and returns.
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

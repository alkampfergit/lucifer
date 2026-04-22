import { describe, it, expect } from 'vitest';
import { resolveExecutionPlan } from './resolve_execution_plan.js';
import type { ApprovalStore, CommandRulesStore } from '../types/store_interfaces.js';
import type { AliasesConfig, CommandApproval, RuleAction } from '../types/command_types.js';

function rulesStore(action: RuleAction): CommandRulesStore {
  return {
    matchRule: () => ({ rule: null, action }),
    reload: () => {},
  };
}

function approvalStore(hit: CommandApproval | undefined): ApprovalStore {
  return {
    findApproval: () => hit,
    addApproval: () => ({ id: 1, command: '', matchType: 'exact', duration: 'session', approvedBy: 'test', approvedAt: '' }),
    removeExpired: () => 0,
    listAll: () => [],
    revokeById: () => false,
  };
}

const emptyApprovals = approvalStore(undefined);

describe('resolveExecutionPlan', () => {
  it('returns alias-args-bypass when a command shadows an alias with arguments', () => {
    const aliases: AliasesConfig = {
      'deploy': { path: '/tmp/deploy.sh', type: 'bash' },
    };
    const plan = resolveExecutionPlan({
      command: 'deploy --force',
      aliases,
      commandRulesStore: rulesStore('always_approve'),
      approvalStore: emptyApprovals,
    });
    expect(plan).toEqual({ kind: 'alias-args-bypass', alias: 'deploy' });
  });

  it('returns rule-deny when the rule action is always_deny', () => {
    const plan = resolveExecutionPlan({
      command: 'rm -rf /',
      aliases: undefined,
      commandRulesStore: rulesStore('always_deny'),
      approvalStore: emptyApprovals,
    });
    expect(plan.kind).toBe('rule-deny');
    if (plan.kind === 'rule-deny') {
      expect(plan.ruleAction).toBe('always_deny');
      expect(plan.aliasAudit).toEqual({});
    }
  });

  it('returns always-approve with empty aliasAudit when no alias resolves', () => {
    const plan = resolveExecutionPlan({
      command: 'ls',
      aliases: undefined,
      commandRulesStore: rulesStore('always_approve'),
      approvalStore: emptyApprovals,
    });
    expect(plan.kind).toBe('always-approve');
    if (plan.kind === 'always-approve') {
      expect(plan.aliasAudit).toEqual({});
    }
  });

  it('enriches aliasAudit with path/type when the command is an exact alias invocation', () => {
    const aliases: AliasesConfig = {
      'deploy': { path: '/tmp/deploy.sh', type: 'bash' },
    };
    const plan = resolveExecutionPlan({
      command: 'deploy',
      aliases,
      commandRulesStore: rulesStore('always_approve'),
      approvalStore: emptyApprovals,
    });
    expect(plan.kind).toBe('always-approve');
    if (plan.kind === 'always-approve') {
      expect(plan.aliasAudit).toMatchObject({ aliasType: 'bash' });
      expect((plan.aliasAudit as { aliasPath: string }).aliasPath).toContain('deploy.sh');
    }
  });

  it('returns cached-approval when manual_approve matches but a cached approval exists', () => {
    const cached: CommandApproval = {
      id: 42, command: 'git push', matchType: 'exact',
      duration: 'session', approvedBy: 'owner', approvedAt: new Date().toISOString(),
    };
    const plan = resolveExecutionPlan({
      command: 'git push',
      aliases: undefined,
      commandRulesStore: rulesStore('manual_approve'),
      approvalStore: approvalStore(cached),
    });
    expect(plan.kind).toBe('cached-approval');
  });

  it('returns manual-approve when manual_approve matches and no cached approval exists', () => {
    const plan = resolveExecutionPlan({
      command: 'git push',
      aliases: undefined,
      commandRulesStore: rulesStore('manual_approve'),
      approvalStore: emptyApprovals,
    });
    expect(plan.kind).toBe('manual-approve');
  });

  it('alias-args bypass is checked before rule match (ADR-009 ordering)', () => {
    const aliases: AliasesConfig = {
      'ls': { path: '/tmp/ls.sh', type: 'bash' },
    };
    // Rule store would always_approve, but alias-args bypass must win first.
    const plan = resolveExecutionPlan({
      command: 'ls -la',
      aliases,
      commandRulesStore: rulesStore('always_approve'),
      approvalStore: emptyApprovals,
    });
    expect(plan.kind).toBe('alias-args-bypass');
  });
});

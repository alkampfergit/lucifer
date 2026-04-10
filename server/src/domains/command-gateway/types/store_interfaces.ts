import type { ApiKeyConfig, CommandApproval, ApprovalMatchType, CommandRule, RuleAction, AuditEntry } from './command_types.js';

export interface ApiKeyStore {
  findByKey(rawKey: string): ApiKeyConfig | undefined;
  reload(): void;
}

export interface ApprovalStore {
  findApproval(command: string): CommandApproval | undefined;
  addApproval(
    command: string,
    matchType: ApprovalMatchType,
    duration: string,
    approvedBy: string,
  ): CommandApproval;
  removeExpired(): number;
  listAll(limit?: number, offset?: number): CommandApproval[];
  revokeById(id: number): boolean;
}

export interface CommandRulesStore {
  matchRule(command: string): { rule: CommandRule; action: RuleAction } | { rule: null; action: RuleAction };
  reload(): void;
}

export interface PendingRequestStore {
  add(request: import('./command_types.js').PendingRequest): void;
  resolve(requestId: string, decision: import('./command_types.js').ApprovalDecision): boolean;
  get(requestId: string): import('./command_types.js').PendingRequest | undefined;
  remove(requestId: string): void;
  findByCommand(command: string, apiKeyName: string): import('./command_types.js').PendingRequest | undefined;
  cleanup(maxAgeMs: number): number;
  size(): number;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
  query(limit?: number, offset?: number): AuditEntry[];
  queryByRequestId(requestId: string): AuditEntry[];
}

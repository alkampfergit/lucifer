export interface CommandRequest {
  command: string;
  cwd?: string;
  apiKeyName: string;
  ip: string;
  requestId: string;
  createdAt: string;
}

export type RuleAction = 'always_approve' | 'telegram_approve' | 'always_deny';

export interface CommandRule {
  prefix: string;
  action: RuleAction;
}

export interface CommandRulesConfig {
  rules: CommandRule[];
  defaultAction: RuleAction;
}

export type ApprovalMatchType = 'exact' | 'prefix';

export interface CommandApproval {
  id: number;
  command: string;
  matchType: ApprovalMatchType;
  duration: string;
  approvedAt: string;
  expiresAt: string | null;
  approvedBy: string;
}

export type ApprovalDecision = 'approved' | 'denied';

export type RequestStatus =
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'expired';

export interface ExecutionResult {
  requestId: string;
  status: RequestStatus;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
}

export interface PendingRequest {
  requestId: string;
  command: string;
  apiKeyName: string;
  ip: string;
  createdAt: string;
  resolve: (decision: ApprovalDecision) => void;
  reject: (reason: Error) => void;
  abortController: AbortController;
}

export type ShellRiskLevel = 'safe' | 'warning' | 'danger';

export interface ShellRiskAnalysis {
  level: ShellRiskLevel;
  warnings: string[];
}

export interface ApiKeyConfig {
  id: string;
  name: string;
  keyHash: string;
  salt: string;
  allowedIps?: string[];
  createdAt: string;
  active: boolean;
}

export interface ApiKeysConfig {
  keys: ApiKeyConfig[];
}

export interface LuciferConfig {
  port: number;
  telegramChatId?: string;
  approvalTimeoutSeconds: number;
  executionTimeoutSeconds: number;
  maxConcurrentExecutions: number;
  maxOutputBytes: number;
  rateLimitPerMinute: number;
  onApprovalTimeout: 'deny' | 'approve-with-warning';
  dataDir: string;
}

export interface AuditEntry {
  ts: string;
  type: 'request' | 'rule_match' | 'approval_check' | 'telegram_sent' | 'approved' | 'denied' | 'executed' | 'error';
  requestId: string;
  command?: string;
  apiKeyName?: string;
  ip?: string;
  ruleAction?: RuleAction;
  duration?: string;
  approvedBy?: string;
  exitCode?: number;
  durationMs?: number;
  error?: string;
}

export interface ErrorResponse {
  code: string;
  message: string;
  details?: string;
  retryable: boolean;
}

export interface ApprovalChannel {
  requestApproval(
    command: string,
    apiKeyName: string,
    ip: string,
    requestId: string,
    riskAnalysis: ShellRiskAnalysis,
  ): Promise<{ decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }>;

  start(): Promise<void>;
  stop(): Promise<void>;
}

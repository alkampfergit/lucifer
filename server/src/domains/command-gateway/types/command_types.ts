export interface CommandRequest {
  command: string;
  cwd?: string;
  apiKeyName: string;
  ip: string;
  requestId: string;
  createdAt: string;
}

export type RuleAction = 'always_approve' | 'manual_approve' | 'always_deny';

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

export type AliasType = 'bash' | 'elf';

export interface CommandAlias {
  path: string;
  type: AliasType;
  /** Fixed arguments passed to the executable, in order. Configured by the operator, never caller-controlled. */
  args?: string[];
  /**
   * When true, a caller may append arguments after the alias name (e.g.
   * "GetUnreadEmail --unread"); the remainder is whitespace-tokenized and
   * appended after any fixed `args`. Still spawned with `shell: false`, so
   * caller-supplied tokens are inert argv elements, never shell input.
   * Defaults to false: the alias only matches its exact name, unchanged.
   */
  allowArgs?: boolean;
}

export interface AliasesConfig {
  [name: string]: CommandAlias;
}

export interface LuciferConfig {
  port: number;
  telegramChatId?: string;
  adminSecretHash?: string;
  adminSecretSalt?: string;
  approvalTimeoutSeconds: number;
  executionTimeoutSeconds: number;
  maxConcurrentExecutions: number;
  maxOutputBytes: number;
  /** Legacy shared rate limit; still honoured as the fallback default for both per-IP and per-key limits when those are not set. */
  rateLimitPerMinute: number;
  /** Express-rate-limit layer keyed by client IP; defends the network edge. Defaults to `rateLimitPerMinute` when unset. */
  rateLimitPerIpPerMinute?: number;
  /** Internal limiter keyed by authenticated API-key name; per-client quota enforcement. Defaults to `rateLimitPerMinute` when unset. */
  rateLimitPerKeyPerMinute?: number;
  onApprovalTimeout: 'deny' | 'approve-with-warning';
  dataDir: string;
  logFile?: string;
  aliases?: AliasesConfig;
  /** Extra directories prepended to the executed command's PATH, in order, so raw (non-alias) commands can resolve tools outside the daemon's own PATH without a full path in every rule/command. */
  toolsPath?: string[];
}

export type AuditEntryType =
  | 'request'
  | 'rule_match'
  | 'approval_check'
  | 'telegram_sent'
  | 'web_sent'
  | 'approved'
  | 'denied'
  | 'executed'
  | 'error'
  | 'proxy_auth_ok'
  | 'proxy_auth_denied'
  | 'proxy_approval_requested'
  | 'proxy_approval_approved'
  | 'proxy_approval_denied'
  | 'proxy_approval_timeout'
  | 'proxy_approval_error';

export interface AuditEntry {
  ts: string;
  type: AuditEntryType;
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
  // When the command resolved to a configured alias, these record what
  // actually ran on disk. Absent when the execution path is the shell
  // fallback.
  aliasPath?: string;
  aliasType?: AliasType;
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
  cancel?(requestId: string): void;
}

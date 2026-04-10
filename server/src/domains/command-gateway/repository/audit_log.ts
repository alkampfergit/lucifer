import type Database from 'better-sqlite3';
import type { AuditEntry } from '../types/command_types.js';

export interface AuditLog {
  append(entry: AuditEntry): void;
  query(limit?: number, offset?: number): AuditEntry[];
  queryByRequestId(requestId: string): AuditEntry[];
}

export function createAuditLog(db: Database.Database): AuditLog {
  const insert = db.prepare(
    `INSERT INTO audit_log (ts, type, request_id, command, api_key_name, ip, rule_action, duration, approved_by, exit_code, duration_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const selectRecent = db.prepare<[number, number], AuditEntry>(
    `SELECT ts, type, request_id as requestId, command, api_key_name as apiKeyName, ip,
            rule_action as ruleAction, duration, approved_by as approvedBy,
            exit_code as exitCode, duration_ms as durationMs, error
     FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?`,
  );

  const selectByRequest = db.prepare<[string], AuditEntry>(
    `SELECT ts, type, request_id as requestId, command, api_key_name as apiKeyName, ip,
            rule_action as ruleAction, duration, approved_by as approvedBy,
            exit_code as exitCode, duration_ms as durationMs, error
     FROM audit_log WHERE request_id = ? ORDER BY id ASC`,
  );

  return {
    append(entry: AuditEntry): void {
      insert.run(
        entry.ts,
        entry.type,
        entry.requestId,
        entry.command ?? null,
        entry.apiKeyName ?? null,
        entry.ip ?? null,
        entry.ruleAction ?? null,
        entry.duration ?? null,
        entry.approvedBy ?? null,
        entry.exitCode ?? null,
        entry.durationMs ?? null,
        entry.error ?? null,
      );
    },

    query(limit = 100, offset = 0): AuditEntry[] {
      return selectRecent.all(limit, offset);
    },

    queryByRequestId(requestId: string): AuditEntry[] {
      return selectByRequest.all(requestId);
    },
  };
}

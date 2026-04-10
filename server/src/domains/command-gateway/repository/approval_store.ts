import type Database from 'better-sqlite3';
import type { ApprovalMatchType, CommandApproval } from '../types/command_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('approval-store');

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

export function createApprovalStore(db: Database.Database): ApprovalStore {
  const APPROVAL_COLUMNS = `id, command, match_type as matchType, duration, approved_at as approvedAt, expires_at as expiresAt, approved_by as approvedBy`;

  const findExact = db.prepare<[string, string], CommandApproval>(
    `SELECT ${APPROVAL_COLUMNS} FROM approvals
     WHERE match_type = 'exact' AND command = ?
     AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY approved_at DESC LIMIT 1`,
  );

  const findPrefix = db.prepare<[string, string], CommandApproval>(
    `SELECT ${APPROVAL_COLUMNS} FROM approvals
     WHERE match_type = 'prefix' AND ? LIKE (command || '%')
     AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY LENGTH(command) DESC LIMIT 1`,
  );

  const insertApproval = db.prepare(
    `INSERT INTO approvals (command, match_type, duration, approved_at, expires_at, approved_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const deleteExpired = db.prepare(
    `DELETE FROM approvals WHERE expires_at IS NOT NULL AND expires_at <= ?`,
  );

  const selectAll = db.prepare<[number, number], CommandApproval>(
    `SELECT ${APPROVAL_COLUMNS} FROM approvals ORDER BY approved_at DESC LIMIT ? OFFSET ?`,
  );

  const deleteById = db.prepare<[number]>(
    `DELETE FROM approvals WHERE id = ?`,
  );

  return {
    findApproval(command: string): CommandApproval | undefined {
      const now = new Date().toISOString();

      const exact = findExact.get(command, now);
      if (exact) {
        log.debug({ command, approvalId: exact.id, matchType: 'exact' }, 'Exact approval found');
        return exact;
      }

      const prefix = findPrefix.get(command, now);
      if (prefix) {
        log.debug({ command, approvalId: prefix.id, matchType: 'prefix', prefix: prefix.command }, 'Prefix approval found');
        return prefix;
      }

      return undefined;
    },

    addApproval(command, matchType, duration, approvedBy) {
      const approvedAt = new Date().toISOString();
      let expiresAt: string | null = null;

      if (duration !== 'permanent') {
        const hours = parseInt(duration, 10);
        if (!isNaN(hours) && hours > 0) {
          const expires = new Date(Date.now() + hours * 3600_000);
          expiresAt = expires.toISOString();
        }
      }

      // Prefix approvals capped at 8h per security policy
      if (matchType === 'prefix' && (duration === 'permanent' || parseInt(duration, 10) > 8)) {
        const capped = new Date(Date.now() + 8 * 3600_000);
        expiresAt = capped.toISOString();
        log.warn({ command, matchType, duration }, 'Prefix approval capped at 8h');
      }

      const result = insertApproval.run(command, matchType, duration, approvedAt, expiresAt, approvedBy);
      const approval: CommandApproval = {
        id: result.lastInsertRowid as number,
        command,
        matchType: matchType,
        duration,
        approvedAt,
        expiresAt,
        approvedBy,
      };

      log.info({ approvalId: approval.id, command, matchType, duration, expiresAt }, 'Approval added');
      return approval;
    },

    removeExpired() {
      const now = new Date().toISOString();
      const result = deleteExpired.run(now);
      if (result.changes > 0) {
        log.info({ removed: result.changes }, 'Expired approvals cleaned up');
      }
      return result.changes;
    },

    listAll(limit = 100, offset = 0) {
      return selectAll.all(limit, offset);
    },

    revokeById(id: number) {
      const result = deleteById.run(id);
      if (result.changes > 0) {
        log.info({ approvalId: id }, 'Approval revoked');
        return true;
      }
      return false;
    },
  };
}

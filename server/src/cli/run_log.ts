import { getDatabase } from '../domains/command-gateway/repository/database.js';
import { createAuditLog } from '../domains/command-gateway/repository/audit_log.js';
import { redactApiKeyName } from '../domains/command-gateway/service/redact_api_key_name.js';

export async function runLog(limit: number, dataDir: string) {
  const db = getDatabase(dataDir);
  const auditLog = createAuditLog(db);
  const entries = auditLog.query(limit);

  if (entries.length === 0) {
    console.log('No audit log entries found.');
    return;
  }

  const reversed = [...entries].reverse();
  for (const entry of reversed) {
    const time = entry.ts.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
    const parts = [time, entry.type.toUpperCase().padEnd(16)];
    if (entry.command) parts.push(entry.command);
    if (entry.apiKeyName) parts.push(`key=${redactApiKeyName(entry.apiKeyName)}`);
    if (entry.exitCode !== undefined && entry.exitCode !== null) parts.push(`exit=${entry.exitCode}`);
    if (entry.durationMs !== undefined && entry.durationMs !== null) parts.push(`${entry.durationMs}ms`);
    if (entry.error) parts.push(`error: ${entry.error}`);
    console.log(parts.join('  '));
  }
}

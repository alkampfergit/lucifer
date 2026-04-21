import { getDatabase } from '../domains/command-gateway/repository/database.js';
import { createAuditLog } from '../domains/command-gateway/repository/audit_log.js';
import { createApprovalStore } from '../domains/command-gateway/repository/approval_store.js';

export async function runStats(dataDir: string) {
  const db = getDatabase(dataDir);
  const auditLog = createAuditLog(db);
  const approvalStore = createApprovalStore(db);

  const allEntries = auditLog.query(10000);
  const requests = allEntries.filter(e => e.type === 'request');
  const approvals = allEntries.filter(e => e.type === 'approved');
  const denials = allEntries.filter(e => e.type === 'denied');
  const executions = allEntries.filter(e => e.type === 'executed');

  const activeApprovals = approvalStore.listAll(10000);
  const expired = activeApprovals.filter(a => a.expiresAt && new Date(a.expiresAt) < new Date());

  console.log('Lucifer Stats');
  console.log('=============');
  console.log(`Total requests:     ${requests.length}`);
  console.log(`Approved:           ${approvals.length}`);
  console.log(`Denied:             ${denials.length}`);
  console.log(`Executed:           ${executions.length}`);
  console.log(`Active approvals:   ${activeApprovals.length - expired.length}`);
  console.log(`Expired approvals:  ${expired.length}`);

  if (executions.length > 0) {
    const durations = executions.filter(e => e.durationMs != null).map(e => e.durationMs!);
    if (durations.length > 0) {
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      const max = Math.max(...durations);
      console.log(`Avg exec time:      ${avg}ms`);
      console.log(`Max exec time:      ${max}ms`);
    }
  }

  // Top commands
  const cmdCounts = new Map<string, number>();
  for (const r of requests) {
    if (r.command) {
      const cmd = r.command.split(/\s+/).slice(0, 2).join(' ');
      cmdCounts.set(cmd, (cmdCounts.get(cmd) ?? 0) + 1);
    }
  }
  const topCmds = [...cmdCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topCmds.length > 0) {
    console.log('\nTop commands:');
    for (const [cmd, count] of topCmds) {
      console.log(`  ${count.toString().padStart(5)}  ${cmd}`);
    }
  }
}

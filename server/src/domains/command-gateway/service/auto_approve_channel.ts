import type { ApprovalChannel, ApprovalDecision, ApprovalMatchType } from '../types/command_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('auto-approve');

export function createAutoApproveChannel(): ApprovalChannel {
  return {
    async requestApproval(command, apiKeyName, ip, requestId, riskAnalysis) {
      log.info(
        { requestId, command, apiKeyName, ip, risk: riskAnalysis.level },
        'AUTO-APPROVE: Command approved without Telegram',
      );
      if (riskAnalysis.warnings.length > 0) {
        log.warn({ requestId, warnings: riskAnalysis.warnings }, 'Risk warnings (auto-approved)');
      }
      const decision: ApprovalDecision = 'approved';
      const matchType: ApprovalMatchType = 'exact';
      const duration = '2';
      return { decision, matchType, duration };
    },

    async start() {
      log.warn('Running in AUTO-APPROVE mode. All commands will be approved without Telegram confirmation.');
      log.warn('This mode is for development only. Do not use in production.');
    },

    async stop() {
      // nothing to clean up
    },
  };
}

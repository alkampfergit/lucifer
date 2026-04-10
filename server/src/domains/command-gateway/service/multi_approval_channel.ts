import type { ApprovalChannel } from '../types/command_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('multi-channel');

export function createMultiApprovalChannel(channels: ApprovalChannel[]): ApprovalChannel {
  if (channels.length === 0) {
    throw new Error('At least one approval channel is required');
  }

  return {
    async requestApproval(command, apiKeyName, ip, requestId, riskAnalysis) {
      const promises = channels.map(ch =>
        ch.requestApproval(command, apiKeyName, ip, requestId, riskAnalysis),
      );

      const result = await Promise.race(promises);

      // Clean up losing channels' internal state
      for (const ch of channels) {
        ch.cancel?.(requestId);
      }

      log.info({ requestId, decision: result.decision }, 'Multi-channel approval resolved');
      return result;
    },

    async start() {
      await Promise.all(channels.map(ch => ch.start()));
      log.info({ channelCount: channels.length }, 'All approval channels started');
    },

    async stop() {
      await Promise.all(channels.map(ch => ch.stop()));
      log.info('All approval channels stopped');
    },

    cancel(requestId: string) {
      for (const ch of channels) {
        ch.cancel?.(requestId);
      }
    },
  };
}

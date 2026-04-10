import type { Response } from 'express';
import type {
  ApprovalChannel, ApprovalDecision, ApprovalMatchType, ShellRiskAnalysis,
} from '../types/command_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('web-channel');

export interface WebPendingRequest {
  requestId: string;
  command: string;
  apiKeyName: string;
  ip: string;
  createdAt: string;
  riskAnalysis: ShellRiskAnalysis;
}

interface WebCallback {
  request: WebPendingRequest;
  resolve: (result: { decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }) => void;
  reject: (reason: Error) => void;
}

export interface WebApprovalChannelHandle extends ApprovalChannel {
  getPendingRequests(): WebPendingRequest[];
  resolveRequest(
    requestId: string,
    decision: ApprovalDecision,
    matchType: ApprovalMatchType,
    duration: string,
  ): boolean;
  addSSEClient(res: Response): void;
  removeSSEClient(res: Response): void;
}

export function createWebApprovalChannel(): WebApprovalChannelHandle {
  const callbacks = new Map<string, WebCallback>();
  const sseClients = new Set<Response>();

  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }

  return {
    async requestApproval(command, apiKeyName, ip, requestId, riskAnalysis) {
      const request: WebPendingRequest = {
        requestId,
        command,
        apiKeyName,
        ip,
        createdAt: new Date().toISOString(),
        riskAnalysis,
      };

      const promise = new Promise<{ decision: ApprovalDecision; matchType: ApprovalMatchType; duration: string }>(
        (resolve, reject) => {
          callbacks.set(requestId, { request, resolve, reject });
        },
      );

      broadcast('new_request', request);

      log.info({ requestId, command }, 'Web approval request broadcast');
      return promise;
    },

    async start() {
      log.info('Web approval channel started');
    },

    async stop() {
      // Reject all pending callbacks
      for (const [requestId, cb] of callbacks.entries()) {
        cb.reject(new Error('Web approval channel shutting down'));
        callbacks.delete(requestId);
      }
      // Close all SSE connections
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      log.info('Web approval channel stopped');
    },

    cancel(requestId: string) {
      const cb = callbacks.get(requestId);
      if (cb) {
        callbacks.delete(requestId);
        broadcast('request_decided', { requestId, decision: 'cancelled' });
        log.debug({ requestId }, 'Web channel request cancelled (decided via another channel)');
      }
    },

    getPendingRequests(): WebPendingRequest[] {
      return Array.from(callbacks.values()).map(cb => cb.request);
    },

    resolveRequest(requestId, decision, matchType, duration) {
      const cb = callbacks.get(requestId);
      if (!cb) {
        return false;
      }
      callbacks.delete(requestId);
      cb.resolve({ decision, matchType, duration });
      broadcast('request_decided', { requestId, decision, matchType, duration });
      log.info({ requestId, decision, matchType, duration }, 'Web approval resolved');
      return true;
    },

    addSSEClient(res: Response) {
      sseClients.add(res);
      log.debug({ clientCount: sseClients.size }, 'SSE client connected');
    },

    removeSSEClient(res: Response) {
      sseClients.delete(res);
      log.debug({ clientCount: sseClients.size }, 'SSE client disconnected');
    },
  };
}

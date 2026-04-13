import type { ApprovalDecision, PendingRequest } from '../types/command_types.js';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('pending-requests');

export interface PendingRequestStore {
  add(request: PendingRequest): void;
  resolve(requestId: string, decision: ApprovalDecision): boolean;
  get(requestId: string): PendingRequest | undefined;
  /** Remove the entry AND abort its abortController (cancel/cleanup). */
  remove(requestId: string): void;
  /** Remove the entry WITHOUT aborting the abortController. Use when
   *  handing off from approval-wait to execution. */
  release(requestId: string): void;
  findByCommand(command: string, apiKeyName: string): PendingRequest | undefined;
  cleanup(maxAgeMs: number): number;
  size(): number;
}

export function createPendingRequestStore(): PendingRequestStore {
  const store = new Map<string, PendingRequest>();

  return {
    add(request: PendingRequest): void {
      store.set(request.requestId, request);
      log.debug({ requestId: request.requestId, command: request.command }, 'Pending request added');
    },

    resolve(requestId: string, decision: ApprovalDecision): boolean {
      const pending = store.get(requestId);
      if (!pending) {
        log.debug({ requestId }, 'Resolve called for unknown/expired request');
        return false;
      }
      pending.resolve(decision);
      store.delete(requestId);
      log.info({ requestId, decision }, 'Pending request resolved');
      return true;
    },

    get(requestId: string): PendingRequest | undefined {
      return store.get(requestId);
    },

    remove(requestId: string): void {
      const pending = store.get(requestId);
      if (pending) {
        pending.abortController.abort();
        store.delete(requestId);
      }
    },

    release(requestId: string): void {
      store.delete(requestId);
    },

    findByCommand(command: string, apiKeyName: string): PendingRequest | undefined {
      for (const pending of store.values()) {
        if (pending.command === command && pending.apiKeyName === apiKeyName) {
          return pending;
        }
      }
      return undefined;
    },

    cleanup(maxAgeMs: number): number {
      const now = Date.now();
      let removed = 0;
      for (const [id, pending] of store.entries()) {
        const age = now - new Date(pending.createdAt).getTime();
        if (age > maxAgeMs) {
          pending.reject(new Error('Approval timed out'));
          pending.abortController.abort();
          store.delete(id);
          removed++;
        }
      }
      if (removed > 0) {
        log.info({ removed }, 'Stale pending requests cleaned up');
      }
      return removed;
    },

    size(): number {
      return store.size;
    },
  };
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPendingRequestStore } from './pending_request_store.js';
import type { PendingRequest } from '../types/command_types.js';

function createTestRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    requestId: 'req-1',
    command: 'git pull origin main',
    apiKeyName: 'test-key',
    ip: '1.2.3.4',
    createdAt: new Date().toISOString(),
    resolve: vi.fn(),
    reject: vi.fn(),
    abortController: new AbortController(),
    ...overrides,
  };
}

describe('PendingRequestStore', () => {
  let store: ReturnType<typeof createPendingRequestStore>;

  beforeEach(() => {
    store = createPendingRequestStore();
  });

  describe('add + get', () => {
    it('returns stored request by requestId', () => {
      const request = createTestRequest();
      store.add(request);

      const found = store.get('req-1');
      expect(found).toBeDefined();
      expect(found!.requestId).toBe('req-1');
      expect(found!.command).toBe('git pull origin main');
    });
  });

  describe('get', () => {
    it('returns undefined for unknown requestId', () => {
      const found = store.get('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('resolve', () => {
    it('calls resolve fn with decision, returns true, and removes from store', () => {
      const request = createTestRequest();
      store.add(request);

      const result = store.resolve('req-1', 'approved');

      expect(result).toBe(true);
      expect(request.resolve).toHaveBeenCalledWith('approved');
      expect(store.get('req-1')).toBeUndefined();
    });

    it('returns false for unknown requestId with no side effects', () => {
      const result = store.resolve('nonexistent', 'denied');
      expect(result).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes request and calls abortController.abort()', () => {
      const request = createTestRequest();
      const abortSpy = vi.spyOn(request.abortController, 'abort');
      store.add(request);

      store.remove('req-1');

      expect(store.get('req-1')).toBeUndefined();
      expect(abortSpy).toHaveBeenCalled();
    });

    it('does not throw when removing non-existent request', () => {
      expect(() => store.remove('nonexistent')).not.toThrow();
    });
  });

  describe('release', () => {
    it('deletes request WITHOUT aborting the abortController', () => {
      const request = createTestRequest();
      const abortSpy = vi.spyOn(request.abortController, 'abort');
      store.add(request);

      store.release('req-1');

      expect(store.get('req-1')).toBeUndefined();
      expect(abortSpy).not.toHaveBeenCalled();
    });

    it('does not throw when releasing a non-existent request', () => {
      expect(() => store.release('nonexistent')).not.toThrow();
    });
  });

  describe('findByCommand', () => {
    it('returns matching request with same command and apiKeyName', () => {
      const request = createTestRequest();
      store.add(request);

      const found = store.findByCommand('git pull origin main', 'test-key');
      expect(found).toBeDefined();
      expect(found!.requestId).toBe('req-1');
    });

    it('returns undefined when command differs', () => {
      const request = createTestRequest();
      store.add(request);

      const found = store.findByCommand('git push origin main', 'test-key');
      expect(found).toBeUndefined();
    });

    it('returns undefined when apiKeyName differs', () => {
      const request = createTestRequest();
      store.add(request);

      const found = store.findByCommand('git pull origin main', 'other-key');
      expect(found).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('removes stale requests and calls reject + abort', () => {
      const request = createTestRequest({
        createdAt: '2020-01-01T00:00:00Z',
      });
      const abortSpy = vi.spyOn(request.abortController, 'abort');
      store.add(request);

      const removed = store.cleanup(1000);

      expect(removed).toBe(1);
      expect(request.reject).toHaveBeenCalledWith(expect.any(Error));
      const errorArg = vi.mocked(request.reject).mock.calls[0][0];
      expect(errorArg.message).toBe('Approval timed out');
      expect(abortSpy).toHaveBeenCalled();
      expect(store.get('req-1')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('tracks count after add and remove operations', () => {
      expect(store.size()).toBe(0);

      store.add(createTestRequest({ requestId: 'req-1' }));
      expect(store.size()).toBe(1);

      store.add(createTestRequest({ requestId: 'req-2' }));
      expect(store.size()).toBe(2);

      store.remove('req-1');
      expect(store.size()).toBe(1);

      store.remove('req-2');
      expect(store.size()).toBe(0);
    });
  });
});

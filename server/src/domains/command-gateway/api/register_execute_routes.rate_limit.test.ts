import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { ApiKeyStore, CommandRulesStore, ApprovalStore, PendingRequestStore, AuditLog } from '../types/store_interfaces.js';
import type { ApprovalChannel, LuciferConfig } from '../types/command_types.js';

const createRateLimiterSpy = vi.fn((limit: number) => ({ tokens: new Map(), maxPerMinute: limit }));

vi.mock('../service/authenticate_request.js', () => ({
  createRateLimiter: (limit: number) => createRateLimiterSpy(limit),
  authenticateRequest: () => ({ ok: false, statusCode: 401, error: { code: 'MISSING_API_KEY', message: 'x', retryable: false } }),
}));

const rateLimitSpy = vi.fn();
vi.mock('express-rate-limit', () => ({
  default: (opts: { limit: number }) => {
    rateLimitSpy(opts);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

// Import AFTER mocks so the SUT picks up the mocked modules.
const { registerExecuteRoutes } = await import('./register_execute_routes.js');

function makeDeps(config: Partial<LuciferConfig>) {
  const router = express.Router();
  const noopApprovalChannel: ApprovalChannel = {
    async requestApproval() { return { decision: 'denied', matchType: 'exact', duration: '0' }; },
    async start() {},
    async stop() {},
  };
  const fullConfig: LuciferConfig = {
    port: 0,
    approvalTimeoutSeconds: 30,
    executionTimeoutSeconds: 10,
    maxConcurrentExecutions: 3,
    maxOutputBytes: 65536,
    rateLimitPerMinute: 10,
    onApprovalTimeout: 'deny',
    dataDir: '.',
    ...config,
  };
  return {
    router,
    config: fullConfig,
    apiKeyStore: {} as ApiKeyStore,
    commandRulesStore: {} as CommandRulesStore,
    approvalStore: {} as ApprovalStore,
    pendingStore: {} as PendingRequestStore,
    auditLog: {} as AuditLog,
    approvalChannel: noopApprovalChannel,
  };
}

describe('registerExecuteRoutes — rate-limit precedence', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    createRateLimiterSpy.mockClear();
    rateLimitSpy.mockClear();
    // Precedence logic is bypassed when NODE_ENV === 'development'; force a
    // non-development env so the configured values flow through.
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('uses dedicated per-IP and per-key overrides when both are set', () => {
    registerExecuteRoutes(makeDeps({
      rateLimitPerMinute: 99,
      rateLimitPerIpPerMinute: 250,
      rateLimitPerKeyPerMinute: 17,
    }));

    expect(createRateLimiterSpy).toHaveBeenCalledWith(17);
    expect(rateLimitSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 250 }));
  });

  it('falls back to rateLimitPerMinute when neither override is set', () => {
    registerExecuteRoutes(makeDeps({ rateLimitPerMinute: 42 }));

    expect(createRateLimiterSpy).toHaveBeenCalledWith(42);
    expect(rateLimitSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 42 }));
  });

  it('uses per-IP override and falls back to shared limit for per-key when only one override is set', () => {
    registerExecuteRoutes(makeDeps({
      rateLimitPerMinute: 30,
      rateLimitPerIpPerMinute: 500,
    }));

    expect(createRateLimiterSpy).toHaveBeenCalledWith(30);
    expect(rateLimitSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });
});

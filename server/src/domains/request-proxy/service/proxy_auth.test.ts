import { describe, it, expect, vi } from 'vitest';
import type http from 'node:http';
import {
  authorizeProxyRequest,
  type ProxyAuthDeps,
} from './proxy_auth.js';
import { createProxyApprovalCache } from './proxy_approval_cache.js';
import type {
  ProxyApprovalOutcome,
  ProxyApprovalRequester,
  ProxyAuditEvent,
  ProxyAuditSink,
  ProxyMapping,
  ProxyTokenValidator,
} from '../types/proxy_types.js';

function fakeRequest(
  headers: Record<string, string | undefined>,
  overrides: Partial<http.IncomingMessage> = {},
): http.IncomingMessage {
  return {
    headers: headers as http.IncomingHttpHeaders,
    method: 'POST',
    url: '/v1/chat/completions',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as http.IncomingMessage;
}

function capturingAudit(): { sink: ProxyAuditSink; events: ProxyAuditEvent[] } {
  const events: ProxyAuditEvent[] = [];
  return {
    events,
    sink: { record: (e) => events.push(e) },
  };
}

function staticValidator(
  validTokens: Record<string, { keyId: string; keyName: string }>,
): ProxyTokenValidator {
  return {
    validate(raw: string) {
      return validTokens[raw];
    },
  };
}

function staticRequester(outcome: ProxyApprovalOutcome): ProxyApprovalRequester {
  return { request: vi.fn().mockResolvedValue(outcome) };
}

function throwingRequester(err: Error): ProxyApprovalRequester {
  return { request: vi.fn().mockRejectedValue(err) };
}

const MAPPING_NONE: ProxyMapping = { port: 6060, baseUrl: 'https://api.openai.com' };

const MAPPING_BEARER_MODE: ProxyMapping = {
  port: 6060,
  baseUrl: 'https://api.openai.com',
  authMode: 'api-key',
  apiKeyHeader: 'authorization',
  apiKeyPrefix: 'Bearer ',
};

const MAPPING_XHEADER_MODE: ProxyMapping = {
  port: 7070,
  baseUrl: 'https://api.anthropic.com',
  authMode: 'api-key',
  apiKeyHeader: 'x-api-key',
};

const MAPPING_TELEGRAM: ProxyMapping = {
  port: 8080,
  baseUrl: 'https://api.openai.com',
  authMode: 'api-key-telegram',
  apiKeyHeader: 'authorization',
  apiKeyPrefix: 'Bearer ',
  telegramApprovalTtlSeconds: 60,
};

describe('authorizeProxyRequest', () => {
  describe('authMode: none', () => {
    it('passes without consulting validator or requester', async () => {
      const validator = { validate: vi.fn() };
      const requester = { request: vi.fn() };

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'anything' }),
        { mapping: MAPPING_NONE, validator, approvalRequester: requester } as ProxyAuthDeps,
      );

      expect(decision.kind).toBe('pass');
      expect(validator.validate).not.toHaveBeenCalled();
      expect(requester.request).not.toHaveBeenCalled();
    });
  });

  describe('authMode: api-key', () => {
    it('accepts a valid Authorization: Bearer token (OpenAI shape)', async () => {
      const audit = capturingAudit();
      const validator = staticValidator({ 'luc_openai': { keyId: 'k1', keyName: 'openai-key' } });

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_openai' }),
        { mapping: MAPPING_BEARER_MODE, validator, audit: audit.sink },
      );

      expect(decision.kind).toBe('pass');
      if (decision.kind !== 'pass') return;
      expect(decision.keyId).toBe('k1');
      expect(decision.keyName).toBe('openai-key');
      expect(audit.events.map((e) => e.type)).toEqual(['proxy_auth_ok']);
    });

    it('accepts a valid x-api-key token (Anthropic shape, no prefix)', async () => {
      const validator = staticValidator({ 'luc_anthropic': { keyId: 'k2', keyName: 'anthropic-key' } });

      const decision = await authorizeProxyRequest(
        fakeRequest({ 'x-api-key': 'luc_anthropic' }),
        { mapping: MAPPING_XHEADER_MODE, validator },
      );

      expect(decision.kind).toBe('pass');
    });

    it('reads the configured header case-insensitively', async () => {
      const validator = staticValidator({ 'luc_x': { keyId: 'k', keyName: 'n' } });

      const decision = await authorizeProxyRequest(
        // Node lowercases incoming header names; simulate that.
        fakeRequest({ 'x-api-key': 'luc_x' }),
        { mapping: { ...MAPPING_XHEADER_MODE, apiKeyHeader: 'X-API-Key' }, validator },
      );

      expect(decision.kind).toBe('pass');
    });

    it('returns 401 when the header is missing', async () => {
      const audit = capturingAudit();
      const validator = staticValidator({});

      const decision = await authorizeProxyRequest(
        fakeRequest({}),
        { mapping: MAPPING_BEARER_MODE, validator, audit: audit.sink },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(401);
      expect(decision.code).toBe('unauthorized');
      expect(audit.events[0].type).toBe('proxy_auth_denied');
    });

    it('returns 401 when the required prefix is absent', async () => {
      const validator = staticValidator({ 'luc_openai': { keyId: 'k1', keyName: 'n' } });

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'luc_openai' }), // missing "Bearer "
        { mapping: MAPPING_BEARER_MODE, validator },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(401);
    });

    it('returns 401 when the token value is empty after prefix strip', async () => {
      const validator = staticValidator({});

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer ' }),
        { mapping: MAPPING_BEARER_MODE, validator },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(401);
    });

    it('returns 401 when the token is not in the store', async () => {
      const validator = staticValidator({});

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer unknown-token' }),
        { mapping: MAPPING_BEARER_MODE, validator },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(401);
    });

    it('returns 500 when no validator is wired', async () => {
      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer x' }),
        { mapping: MAPPING_BEARER_MODE },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(500);
      expect(decision.code).toBe('misconfigured');
    });
  });

  describe('authMode: api-key-telegram', () => {
    it('calls the requester on a cache miss and caches an approval', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'telegram-key' } });
      const requester = staticRequester('approved');
      const cache = createProxyApprovalCache();
      const audit = capturingAudit();

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        {
          mapping: MAPPING_TELEGRAM,
          validator,
          approvalRequester: requester,
          cache,
          audit: audit.sink,
        },
      );

      expect(decision.kind).toBe('pass');
      expect(requester.request).toHaveBeenCalledTimes(1);
      expect(cache.has({ keyId: 'kt', port: MAPPING_TELEGRAM.port })).toBe(true);

      const types = audit.events.map((e) => e.type);
      expect(types).toEqual(['proxy_approval_requested', 'proxy_approval_approved']);
      expect(audit.events[1].source).toBe('telegram');
    });

    it('hits the cache on a second request within the TTL without asking again', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester = staticRequester('approved');
      const cache = createProxyApprovalCache();

      await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, cache },
      );
      await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, cache },
      );

      expect(requester.request).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when the approver denies', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester = staticRequester('denied');
      const cache = createProxyApprovalCache();
      const audit = capturingAudit();

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, cache, audit: audit.sink },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(403);
      expect(decision.code).toBe('forbidden');
      expect(cache.has({ keyId: 'kt', port: MAPPING_TELEGRAM.port })).toBe(false);
      expect(audit.events.some((e) => e.type === 'proxy_approval_denied')).toBe(true);
    });

    it('returns 408 when approval times out', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester = staticRequester('timeout');
      const cache = createProxyApprovalCache();
      const audit = capturingAudit();

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, cache, audit: audit.sink },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(408);
      expect(decision.code).toBe('approval_timeout');
      expect(cache.has({ keyId: 'kt', port: MAPPING_TELEGRAM.port })).toBe(false);
      expect(audit.events.some((e) => e.type === 'proxy_approval_timeout')).toBe(true);
    });

    it('returns 503 when the approval channel throws', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester = throwingRequester(new Error('bot offline'));
      const audit = capturingAudit();

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, audit: audit.sink },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(503);
      expect(decision.code).toBe('approval_error');
      expect(audit.events.some((e) => e.type === 'proxy_approval_error')).toBe(true);
    });

    it('returns 503 when outcome is an explicit "error"', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester = staticRequester('error');

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(503);
    });

    it('returns 500 when no approval requester is wired', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator },
      );

      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') return;
      expect(decision.status).toBe(500);
      expect(decision.code).toBe('misconfigured');
    });

    it('does not cache when the token is invalid (rejects before cache check)', async () => {
      const validator = staticValidator({}); // nothing valid
      const requester = staticRequester('approved');
      const cache = createProxyApprovalCache();

      await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer unknown' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, cache },
      );

      expect(requester.request).not.toHaveBeenCalled();
    });

    it('survives an audit sink that throws', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester = staticRequester('approved');
      const throwingSink: ProxyAuditSink = {
        record: () => { throw new Error('bad sink'); },
      };

      const decision = await authorizeProxyRequest(
        fakeRequest({ authorization: 'Bearer luc_t' }),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester, audit: throwingSink },
      );

      expect(decision.kind).toBe('pass');
    });

    it('populates the approval context with method, path, and caller ip', async () => {
      const validator = staticValidator({ 'luc_t': { keyId: 'kt', keyName: 'n' } });
      const requester: ProxyApprovalRequester = { request: vi.fn().mockResolvedValue('approved') };

      await authorizeProxyRequest(
        fakeRequest(
          { authorization: 'Bearer luc_t' },
          { method: 'POST', url: '/v1/messages', socket: { remoteAddress: '10.0.0.5' } as http.IncomingMessage['socket'] },
        ),
        { mapping: MAPPING_TELEGRAM, validator, approvalRequester: requester },
      );

      expect(requester.request).toHaveBeenCalledWith(expect.objectContaining({
        method: 'POST',
        path: '/v1/messages',
        ip: '10.0.0.5',
        port: MAPPING_TELEGRAM.port,
        baseUrl: MAPPING_TELEGRAM.baseUrl,
        keyId: 'kt',
        keyName: 'n',
      }));
    });
  });
});

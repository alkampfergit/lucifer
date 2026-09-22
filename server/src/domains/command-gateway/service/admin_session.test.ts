import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  ADMIN_SESSION_KEY_BYTES,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionSealer,
} from './admin_session.js';

function makeKey(): Buffer {
  return randomBytes(ADMIN_SESSION_KEY_BYTES);
}

describe('admin_session', () => {
  describe('createAdminSessionSealer', () => {
    it('createAdminSessionSealer_keyOfWrongLength_throws', () => {
      expect(() => createAdminSessionSealer(randomBytes(16))).toThrow(/exactly 32 bytes/);
    });
  });

  describe('seal', () => {
    it('seal_default_producesVersionedFourPartCookie', () => {
      const sealed = createAdminSessionSealer(makeKey()).seal();

      const parts = sealed.cookie.split('.');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
      // base64url: no padding, no + or /
      for (const part of parts.slice(1)) {
        expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    it('seal_default_usesThirtyDayAbsoluteLifetime', () => {
      const sealed = createAdminSessionSealer(makeKey()).seal();
      expect(sealed.maxAgeSeconds).toBe(ADMIN_SESSION_TTL_SECONDS);
      expect(ADMIN_SESSION_TTL_SECONDS).toBe(2_592_000);
    });

    it('seal_twice_producesDistinctCookiesAndCsrfTokens', () => {
      const sealer = createAdminSessionSealer(makeKey());
      const first = sealer.seal();
      const second = sealer.seal();

      expect(first.cookie).not.toBe(second.cookie);
      expect(first.csrf).not.toBe(second.csrf);
    });

    it('seal_anyCookie_doesNotEmbedTheAdminSecretOrReadablePayload', () => {
      const sealed = createAdminSessionSealer(makeKey()).seal();
      // The assertion is encrypted, so no claim name survives in the wire value.
      expect(sealed.cookie).not.toContain('admin');
      expect(sealed.cookie).not.toContain(sealed.csrf);
    });
  });

  describe('open', () => {
    it('open_ownSealedCookie_returnsTheAssertion', () => {
      const sealer = createAdminSessionSealer(makeKey());
      const sealed = sealer.seal();

      const assertion = sealer.open(sealed.cookie);

      expect(assertion).toBeDefined();
      expect(assertion!.v).toBe(1);
      expect(assertion!.sub).toBe('admin');
      expect(assertion!.csrf).toBe(sealed.csrf);
      expect(assertion!.exp - assertion!.iat).toBe(ADMIN_SESSION_TTL_SECONDS);
    });

    it('open_cookieSealedWithAnotherKey_returnsUndefined', () => {
      const sealed = createAdminSessionSealer(makeKey()).seal();

      expect(createAdminSessionSealer(makeKey()).open(sealed.cookie)).toBeUndefined();
    });

    it('open_tamperedCiphertext_returnsUndefined', () => {
      const sealer = createAdminSessionSealer(makeKey());
      const parts = sealer.seal().cookie.split('.');
      const ct = Buffer.from(parts[2], 'base64url');
      ct[0] ^= 0xff;
      parts[2] = ct.toString('base64url');

      expect(sealer.open(parts.join('.'))).toBeUndefined();
    });

    it('open_expiredAssertion_returnsUndefined', () => {
      const key = makeKey();
      // A sealer whose TTL already elapsed the moment it minted the cookie.
      const expired = createAdminSessionSealer(key, -1).seal();

      expect(createAdminSessionSealer(key).open(expired.cookie)).toBeUndefined();
    });

    it.each([
      ['undefined', undefined],
      ['empty', ''],
      ['not versioned', 'v2.a.b.c'],
      ['too few parts', 'v1.a.b'],
      ['not base64url', 'v1.@@@.@@@.@@@'],
      ['a bearer secret pasted in', 'luc_admin_deadbeef'],
    ])('open_malformedValue_%s_returnsUndefined', (_label, value) => {
      const sealer = createAdminSessionSealer(makeKey());
      expect(sealer.open(value as string | undefined)).toBeUndefined();
    });
  });

  describe('csrfMatches', () => {
    it('csrfMatches_tokenFromTheSameSession_returnsTrue', () => {
      const sealer = createAdminSessionSealer(makeKey());
      const sealed = sealer.seal();
      const assertion = sealer.open(sealed.cookie)!;

      expect(sealer.csrfMatches(assertion, sealed.csrf)).toBe(true);
    });

    it('csrfMatches_tokenFromAnotherSession_returnsFalse', () => {
      const sealer = createAdminSessionSealer(makeKey());
      const assertion = sealer.open(sealer.seal().cookie)!;
      const other = sealer.seal();

      expect(sealer.csrfMatches(assertion, other.csrf)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['empty', ''],
      ['a truncated prefix', 'short'],
    ])('csrfMatches_missingOrWrongToken_%s_returnsFalse', (_label, presented) => {
      const sealer = createAdminSessionSealer(makeKey());
      const assertion = sealer.open(sealer.seal().cookie)!;

      expect(sealer.csrfMatches(assertion, presented)).toBe(false);
    });
  });
});

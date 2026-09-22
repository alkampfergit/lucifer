import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import {
  ADMIN_SESSION_KEY_BYTES,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionSealer,
} from './admin_session.js';

function makeKey(): Buffer {
  return randomBytes(ADMIN_SESSION_KEY_BYTES);
}

/**
 * Seal an arbitrary plaintext in the cookie's wire format.
 *
 * Models an attacker in possession of the sealing key: the GCM tag verifies, so
 * only the claim validation in `open` can reject what comes out. Deliberately
 * re-implements the format rather than calling `seal`, which would only ever
 * emit well-formed assertions.
 */
function forgeRawCookie(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const parts = [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString('base64url'));
  return `v1.${parts.join('.')}`;
}

function forgeCookie(key: Buffer, claims: Record<string, unknown>): string {
  return forgeRawCookie(key, JSON.stringify(claims));
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

  // Everything here models an attacker who already holds the sealing key, so the
  // GCM tag verifies and only the claim bounds stand between them and a session.
  describe('open with the sealing key compromised', () => {
    const now = () => Math.floor(Date.now() / 1000);

    it('open_forgedAssertionWithinTheConfiguredTtl_isStillAccepted', () => {
      const key = makeKey();
      const forged = forgeCookie(key, { v: 1, sub: 'admin', iat: now(), exp: now() + 60, csrf: 'x' });

      // The baseline: a leaked key does yield a session. The tests below bound it.
      expect(createAdminSessionSealer(key).open(forged)).toBeDefined();
    });

    it('open_forgedAssertionWithDistantExpiry_isRejectedInsteadOfLastingForever', () => {
      const key = makeKey();
      const century = ADMIN_SESSION_TTL_SECONDS * 1200;
      const forged = forgeCookie(key, { v: 1, sub: 'admin', iat: now(), exp: now() + century, csrf: 'x' });

      expect(createAdminSessionSealer(key).open(forged)).toBeUndefined();
    });

    it('open_forgedAssertionBackdatedToStretchTheWindow_isRejected', () => {
      const key = makeKey();
      // `exp` is inside a 30-day window measured from an ancient `iat`, so a
      // naive `exp - iat <= ttl` check without the freshness bound would pass.
      const iat = now() - ADMIN_SESSION_TTL_SECONDS * 10;
      const forged = forgeCookie(key, { v: 1, sub: 'admin', iat, exp: iat + ADMIN_SESSION_TTL_SECONDS * 10, csrf: 'x' });

      expect(createAdminSessionSealer(key).open(forged)).toBeUndefined();
    });

    it('open_forgedAssertionIssuedInTheFuture_isRejected', () => {
      const key = makeKey();
      const iat = now() + 3600;
      const forged = forgeCookie(key, { v: 1, sub: 'admin', iat, exp: iat + 60, csrf: 'x' });

      expect(createAdminSessionSealer(key).open(forged)).toBeUndefined();
    });

    it('open_forgedAssertionIssuedWithinClockSkew_isAccepted', () => {
      const key = makeKey();
      // A modest clock step across a restart must not sign every admin out.
      const iat = now() + 30;
      const forged = forgeCookie(key, { v: 1, sub: 'admin', iat, exp: iat + 60, csrf: 'x' });

      expect(createAdminSessionSealer(key).open(forged)).toBeDefined();
    });

    // Hand-written JSON: `1e999` parses to Infinity and would sail past every
    // numeric bound, and JSON.stringify cannot express it for us.
    it.each([
      ['exp overflows to Infinity', '{"v":1,"sub":"admin","iat":0,"exp":1e999,"csrf":"x"}'],
      ['exp is beyond the safe integer range', '{"v":1,"sub":"admin","iat":0,"exp":1e30,"csrf":"x"}'],
      ['exp is fractional', '{"v":1,"sub":"admin","iat":0,"exp":1.5,"csrf":"x"}'],
      ['exp is a numeric string', '{"v":1,"sub":"admin","iat":0,"exp":"99999999999","csrf":"x"}'],
      ['csrf is empty', '{"v":1,"sub":"admin","iat":0,"exp":1e999,"csrf":""}'],
    ])('open_forgedAssertionWithNonTimestampClaims_%s_isRejected', (_label, json) => {
      const key = makeKey();

      expect(createAdminSessionSealer(key).open(forgeRawCookie(key, json))).toBeUndefined();
    });

    it('open_forgedAssertionWithAnotherSubject_isRejected', () => {
      const key = makeKey();
      const forged = forgeCookie(key, { v: 1, sub: 'root', iat: now(), exp: now() + 60, csrf: 'x' });

      expect(createAdminSessionSealer(key).open(forged)).toBeUndefined();
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

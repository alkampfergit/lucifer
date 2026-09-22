import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AdminSessionAssertion } from '../types/command_types.js';

/** Cookie name holding the sealed session assertion. Always `HttpOnly`. */
export const ADMIN_SESSION_COOKIE = 'lucifer_admin';
/** Cookie name mirroring the assertion's CSRF token. Deliberately readable by the page. */
export const ADMIN_CSRF_COOKIE = 'lucifer_admin_csrf';
/** Request header the page echoes the CSRF token back in. */
export const ADMIN_CSRF_HEADER = 'x-lucifer-csrf';

/** Session lifetime: 30 days, absolute. `exp` is never extended (ADR-013). */
export const ADMIN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Bytes of key material AES-256-GCM needs. */
export const ADMIN_SESSION_KEY_BYTES = 32;

const FORMAT_VERSION = 'v1';
const ASSERTION_VERSION = 1;
const IV_BYTES = 12;
const CSRF_BYTES = 32;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function isAssertion(value: unknown, nowSeconds: number): value is AdminSessionAssertion {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  if (a.v !== ASSERTION_VERSION) return false;
  if (a.sub !== 'admin') return false;
  if (typeof a.iat !== 'number' || typeof a.exp !== 'number') return false;
  if (typeof a.csrf !== 'string' || a.csrf.length === 0) return false;
  return a.exp > nowSeconds;
}

export interface SealedAdminSession {
  /** Value for the `lucifer_admin` cookie. */
  cookie: string;
  /** Value for the `lucifer_admin_csrf` cookie; identical to the sealed `csrf` claim. */
  csrf: string;
  /** Cookie `Max-Age`, in seconds, matching the sealed `exp`. */
  maxAgeSeconds: number;
}

export interface AdminSessionSealer {
  /** Mint a fresh assertion sealed with the configured key. */
  seal(): SealedAdminSession;
  /** Decrypt and validate a cookie value. Returns `undefined` for anything it cannot trust. */
  open(value: string | undefined): AdminSessionAssertion | undefined;
  /** Constant-time compare of a caller-supplied CSRF token against the sealed one. */
  csrfMatches(assertion: AdminSessionAssertion, presented: string | undefined): boolean;
}

/**
 * Seal/open admin session assertions with AES-256-GCM.
 *
 * The cookie is self-contained — `v1.<iv>.<ciphertext>.<tag>`, all base64url —
 * so no server-side session table is needed and sessions survive a restart. The
 * sealed payload is an assertion (`{ v, sub, iat, exp, csrf }`), never the raw
 * admin secret: a leaked key therefore yields a forgeable, expiring session
 * rather than a reusable bearer credential.
 *
 * Defends against: tampering and forgery (GCM auth tag), replay past `exp`,
 * and cross-site request forgery (via the sealed `csrf` claim, checked by the
 * caller). Does NOT defend against: theft of the cookie itself from a browser,
 * or disclosure of the sealing key — either one is a full session compromise
 * until `exp`.
 */
export function createAdminSessionSealer(
  key: Buffer,
  ttlSeconds: number = ADMIN_SESSION_TTL_SECONDS,
): AdminSessionSealer {
  if (key.length !== ADMIN_SESSION_KEY_BYTES) {
    throw new Error(`Admin session key must be exactly ${ADMIN_SESSION_KEY_BYTES} bytes, got ${key.length}`);
  }

  return {
    seal(): SealedAdminSession {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const csrf = randomBytes(CSRF_BYTES).toString('base64url');
      const assertion: AdminSessionAssertion = {
        v: ASSERTION_VERSION,
        sub: 'admin',
        iat: nowSeconds,
        exp: nowSeconds + ttlSeconds,
        csrf,
      };

      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(assertion), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      return {
        cookie: `${FORMAT_VERSION}.${b64url(iv)}.${b64url(ciphertext)}.${b64url(tag)}`,
        csrf,
        maxAgeSeconds: ttlSeconds,
      };
    },

    open(value: string | undefined): AdminSessionAssertion | undefined {
      if (!value) return undefined;

      const parts = value.split('.');
      if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) return undefined;

      try {
        const iv = Buffer.from(parts[1], 'base64url');
        const ciphertext = Buffer.from(parts[2], 'base64url');
        const tag = Buffer.from(parts[3], 'base64url');
        if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) return undefined;

        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

        const parsed: unknown = JSON.parse(plaintext);
        const nowSeconds = Math.floor(Date.now() / 1000);
        return isAssertion(parsed, nowSeconds) ? parsed : undefined;
      } catch {
        // Bad base64, wrong key, tampered ciphertext, or non-JSON payload —
        // all mean the same thing to the caller: this cookie is not a session.
        return undefined;
      }
    },

    csrfMatches(assertion: AdminSessionAssertion, presented: string | undefined): boolean {
      if (!presented) return false;
      const expected = Buffer.from(assertion.csrf, 'utf8');
      const actual = Buffer.from(presented, 'utf8');
      if (expected.length !== actual.length) return false;
      return timingSafeEqual(expected, actual);
    },
  };
}

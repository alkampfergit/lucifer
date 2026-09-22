import type Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { createChildLogger } from '../../../lib/logger.js';

const log = createChildLogger('admin-session-key');

/** Row key in `server_secrets` and entry name in the OS keychain. */
const SECRET_NAME = 'admin_session_key';
/** Service name presented to the OS keychain. */
const KEYCHAIN_SERVICE = 'lucifer-gate';
/** AES-256-GCM key length. Kept local so `repository` does not import `service`. */
const KEY_BYTES = 32;

/** Where the key that is actually in use came from. */
export type AdminSessionKeySource = 'env' | 'keychain' | 'database';

/**
 * The operator set `LUCIFER_ADMIN_COOKIE_KEY` to something unusable.
 *
 * Distinct from every other failure in this module so the composition root can
 * treat it as fatal: the other steps degrade to the next fallback on purpose,
 * but a malformed operator-managed key is a configuration mistake that must not
 * be papered over by silently disabling cookie sessions.
 */
export class AdminSessionKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminSessionKeyConfigError';
  }
}

export interface AdminSessionKeyResolution {
  key: Buffer;
  source: AdminSessionKeySource;
}

export interface AdminSessionKeyOptions {
  /**
   * Test seam: supply the optional keychain module instead of `require`-ing it.
   * Returning `undefined` models a machine without the native module installed.
   */
  loadKeyringModule?: () => KeyringModule | undefined;
  /** Test seam: pretend to run on another platform when picking the keychain store. */
  platform?: NodeJS.Platform;
}

/** The slice of `@napi-rs/keyring`'s `Entry` this module uses. */
export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
}

/**
 * The slice of `@napi-rs/keyring`'s `EntryOptions` this module uses.
 * Linux-only; the module ignores it on other platforms.
 */
export interface KeyringEntryOptions {
  linux?: { store?: 'secret-service' | 'keyutils' };
}

/** The slice of `@napi-rs/keyring` this module uses. */
export interface KeyringModule {
  Entry: new (service: string, account: string, options?: KeyringEntryOptions) => KeyringEntry;
}

/**
 * Pin Linux to the Secret Service.
 *
 * `@napi-rs/keyring`'s default Linux selection falls back from Secret Service
 * to the kernel keyutils store, which lives in RAM and is wiped on reboot. A
 * D-Bus-less host would therefore "succeed" here and silently invalidate every
 * outstanding session at the next restart, never reaching the durable database
 * fallback. Requiring the store makes its absence throw, which is what the
 * fallback chain is built to handle.
 */
export function keychainEntryOptions(platform: NodeJS.Platform = process.platform): KeyringEntryOptions | undefined {
  return platform === 'linux' ? { linux: { store: 'secret-service' } } : undefined;
}

const require = createRequire(import.meta.url);

/**
 * Load `@napi-rs/keyring` if this machine has it.
 *
 * It is an `optionalDependency` on purpose: it is a native module, and the
 * platforms Lucifer most often runs on headless (our `node:22-alpine` image,
 * CI containers) have neither a prebuilt binary guarantee nor a Secret Service
 * daemon to talk to. A missing module is an expected state, not an error.
 */
function loadKeyring(): KeyringModule | undefined {
  try {
    return require('@napi-rs/keyring') as KeyringModule;
  } catch {
    return undefined;
  }
}

function parseHexKey(raw: string): Buffer | undefined {
  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return undefined;
  const buf = Buffer.from(trimmed, 'hex');
  return buf.length === KEY_BYTES ? buf : undefined;
}

function readFromEnv(): Buffer | undefined {
  const raw = process.env.LUCIFER_ADMIN_COOKIE_KEY;
  if (!raw) return undefined;

  const key = parseHexKey(raw);
  if (!key) {
    // Loud, because the operator clearly meant to manage the key themselves and
    // silently falling through would seal sessions with a key they do not hold.
    throw new AdminSessionKeyConfigError(
      `LUCIFER_ADMIN_COOKIE_KEY must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes). ` +
      'Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return key;
}

function readOrCreateInKeychain(
  load: () => KeyringModule | undefined,
  entryOptions: KeyringEntryOptions | undefined,
): Buffer | undefined {
  const keyring = load();
  if (!keyring) {
    log.info('OS keychain module unavailable; admin session key will use the database');
    return undefined;
  }

  try {
    const entry = new keyring.Entry(KEYCHAIN_SERVICE, SECRET_NAME, entryOptions);
    const existing = entry.getPassword();
    if (existing) {
      const key = parseHexKey(existing);
      if (key) return key;
      log.warn('OS keychain holds a malformed admin session key; replacing it');
    }

    const created = randomBytes(KEY_BYTES);
    entry.setPassword(created.toString('hex'));
    return created;
  } catch (err) {
    // No D-Bus / Secret Service, a locked keychain, or a denied prompt. All of
    // these are recoverable: the database fallback keeps the feature working.
    log.info({ err }, 'OS keychain unreachable; admin session key will use the database');
    return undefined;
  }
}

function readOrCreateInDatabase(db: Database.Database): Buffer {
  const row = db
    .prepare('SELECT value FROM server_secrets WHERE name = ?')
    .get(SECRET_NAME) as { value: string } | undefined;

  if (row) {
    const key = parseHexKey(row.value);
    if (key) return key;
    log.warn('Stored admin session key is malformed; regenerating (existing sessions will be invalidated)');
  }

  const created = randomBytes(KEY_BYTES);
  db.prepare(
    'INSERT INTO server_secrets (name, value, created_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(name) DO UPDATE SET value = excluded.value, created_at = excluded.created_at',
  ).run(SECRET_NAME, created.toString('hex'), new Date().toISOString());
  return created;
}

/**
 * Resolve the persistent key that seals admin session cookies, creating one on
 * first use.
 *
 * Resolution order, first hit wins:
 * 1. `LUCIFER_ADMIN_COOKIE_KEY` — operator-managed, 64 hex characters.
 * 2. OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret
 *    Service) via the optional `@napi-rs/keyring` native module. On Linux the
 *    entry is pinned to the Secret Service so a host without one falls through
 *    to step 3 instead of landing in the volatile kernel keyring.
 * 3. The `server_secrets` table in `lucifer.db`.
 *
 * Step 3 stores the key beside the data it protects, which makes `lucifer.db`
 * the trust boundary — weaker than a keychain, but the only option that works
 * on a headless box, and the alternative (no session cookie at all) is what the
 * operator is trying to avoid.
 *
 * Throws `AdminSessionKeyConfigError` only when `LUCIFER_ADMIN_COOKIE_KEY` is
 * set but unusable; every other failure degrades to the next step.
 */
export function resolveAdminSessionKey(
  db: Database.Database,
  options: AdminSessionKeyOptions = {},
): AdminSessionKeyResolution {
  const fromEnv = readFromEnv();
  if (fromEnv) {
    log.info('Admin session key loaded from LUCIFER_ADMIN_COOKIE_KEY');
    return { key: fromEnv, source: 'env' };
  }

  const fromKeychain = readOrCreateInKeychain(
    options.loadKeyringModule ?? loadKeyring,
    keychainEntryOptions(options.platform),
  );
  if (fromKeychain) {
    log.info('Admin session key loaded from the OS keychain');
    return { key: fromKeychain, source: 'keychain' };
  }

  log.info('Admin session key loaded from the local database');
  return { key: readOrCreateInDatabase(db), source: 'database' };
}

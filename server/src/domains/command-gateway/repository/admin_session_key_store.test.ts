import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  AdminSessionKeyConfigError,
  deriveInstanceId,
  keychainEntryOptions,
  resolveAdminSessionKey,
  type KeyringEntryOptions,
  type KeyringModule,
} from './admin_session_key_store.js';

function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_secrets (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

/** A keychain that is simply not installed on this machine. */
const noKeyring = () => undefined;

/** Stands in for the deployment under test. */
const INSTANCE = deriveInstanceId('/srv/lucifer/data/lucifer.db');

/** Entry options handed to the fake keychain, newest last. */
const seenEntryOptions: Array<KeyringEntryOptions | undefined> = [];

/** `service:account` pairs the fake keychain was asked for, newest last. */
const seenEntryIds: string[] = [];

/** An in-memory stand-in for the OS keychain, so the branch is deterministic. */
function fakeKeyring(store: Map<string, string>, behaviour: 'ok' | 'throws' = 'ok'): () => KeyringModule {
  return () => ({
    Entry: class {
      constructor(
        private readonly service: string,
        private readonly account: string,
        options?: KeyringEntryOptions,
      ) {
        seenEntryOptions.push(options);
        seenEntryIds.push(`${service}:${account}`);
        if (behaviour === 'throws') throw new Error('Secret Service unavailable (no D-Bus)');
      }
      private get id() { return `${this.service}:${this.account}`; }
      getPassword() { return store.get(this.id) ?? null; }
      setPassword(password: string) { store.set(this.id, password); }
    },
  });
}

function readStoredKey(db: Database.Database): string | undefined {
  const row = db
    .prepare("SELECT value FROM server_secrets WHERE name = 'admin_session_key'")
    .get() as { value: string } | undefined;
  return row?.value;
}

describe('admin_session_key_store', () => {
  let db: Database.Database;
  const originalEnv = process.env.LUCIFER_ADMIN_COOKIE_KEY;

  beforeEach(() => {
    db = createTestDatabase();
    seenEntryOptions.length = 0;
    seenEntryIds.length = 0;
    delete process.env.LUCIFER_ADMIN_COOKIE_KEY;
  });

  afterEach(() => {
    db.close();
    if (originalEnv === undefined) delete process.env.LUCIFER_ADMIN_COOKIE_KEY;
    else process.env.LUCIFER_ADMIN_COOKIE_KEY = originalEnv;
  });

  describe('environment variable branch', () => {
    it('resolveAdminSessionKey_envKeySet_usesItAndSkipsEveryFallback', () => {
      const hex = 'a'.repeat(64);
      process.env.LUCIFER_ADMIN_COOKIE_KEY = hex;
      const keychain = new Map<string, string>();

      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(keychain) });

      expect(result.source).toBe('env');
      expect(result.key.toString('hex')).toBe(hex);
      expect(keychain.size).toBe(0);
      expect(readStoredKey(db)).toBeUndefined();
    });

    it('resolveAdminSessionKey_envKeySurroundedByWhitespace_isAccepted', () => {
      process.env.LUCIFER_ADMIN_COOKIE_KEY = `  ${'b'.repeat(64)}\n`;

      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring });

      expect(result.source).toBe('env');
      expect(result.key).toHaveLength(32);
    });

    it.each([
      ['too short', 'abcdef'],
      ['not hex', 'z'.repeat(64)],
      ['64 bytes instead of 32', 'a'.repeat(128)],
    ])('resolveAdminSessionKey_envKeyMalformed_%s_throwsInsteadOfSilentlyFallingBack', (_label, value) => {
      process.env.LUCIFER_ADMIN_COOKIE_KEY = value;

      expect(() => resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring }))
        .toThrow(/LUCIFER_ADMIN_COOKIE_KEY must be 64 hex characters/);
    });

    it('resolveAdminSessionKey_envKeyMalformed_throwsATypedErrorCallersCanTreatAsFatal', () => {
      process.env.LUCIFER_ADMIN_COOKIE_KEY = 'nope';

      // The composition root reads this type to tell an operator's configuration
      // mistake apart from the fallbacks it is supposed to swallow.
      expect(() => resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring }))
        .toThrow(AdminSessionKeyConfigError);
    });
  });

  describe('OS keychain branch', () => {
    it('resolveAdminSessionKey_keychainEmpty_generatesAndStoresThere', () => {
      const keychain = new Map<string, string>();

      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(keychain) });

      expect(result.source).toBe('keychain');
      expect(result.key).toHaveLength(32);
      expect(keychain.get(`lucifer-gate:admin_session_key:${INSTANCE}`)).toBe(result.key.toString('hex'));
      // The database must stay clean when the keychain answered.
      expect(readStoredKey(db)).toBeUndefined();
    });

    it('resolveAdminSessionKey_keychainHoldsAKey_returnsTheSameKeyAcrossRestarts', () => {
      const keychain = new Map<string, string>();
      const first = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(keychain) });

      const second = resolveAdminSessionKey(createTestDatabase(), INSTANCE, { loadKeyringModule: fakeKeyring(keychain) });

      expect(second.source).toBe('keychain');
      expect(second.key.toString('hex')).toBe(first.key.toString('hex'));
    });

    it('resolveAdminSessionKey_keychainHoldsGarbage_replacesItWithAValidKey', () => {
      const keychain = new Map<string, string>([[`lucifer-gate:admin_session_key:${INSTANCE}`, 'not-a-key']]);

      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(keychain) });

      expect(result.source).toBe('keychain');
      expect(keychain.get(`lucifer-gate:admin_session_key:${INSTANCE}`)).toBe(result.key.toString('hex'));
    });

    it('resolveAdminSessionKey_keychainThrows_fallsBackToTheDatabase', () => {
      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(new Map(), 'throws') });

      expect(result.source).toBe('database');
      expect(readStoredKey(db)).toBe(result.key.toString('hex'));
    });

    // The library's default Linux selection falls back from Secret Service to the
    // kernel keyring, which is wiped on reboot. Taking that branch would look like
    // success while silently invalidating every session at the next restart, so the
    // entry is pinned and its absence is allowed to throw into the database fallback.
    it('resolveAdminSessionKey_onLinux_pinsTheEntryToSecretServiceRatherThanTheKernelKeyring', () => {
      resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(new Map()), platform: 'linux' });

      expect(seenEntryOptions).toEqual([{ linux: { store: 'secret-service' } }]);
    });

    it.each(['darwin', 'win32'] as const)(
      'resolveAdminSessionKey_on_%s_passesNoLinuxOnlyOptions',
      (platform) => {
        resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(new Map()), platform });

        expect(seenEntryOptions).toEqual([undefined]);
      },
    );

    it('keychainEntryOptions_defaultsToTheCurrentPlatform', () => {
      expect(keychainEntryOptions()).toEqual(keychainEntryOptions(process.platform));
    });

    it('resolveAdminSessionKey_twoInstancesOnOneHost_doNotShareTheKeychainEntry', () => {
      // Same OS account, same keychain, different deployments. A shared entry
      // would give both the same sealing key, and since browsers do not scope
      // cookies by port, a session minted against one admin secret would open
      // on the instance that uses the other.
      const keychain = new Map<string, string>();
      const other = deriveInstanceId('/srv/lucifer-staging/data/lucifer.db');

      const first = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: fakeKeyring(keychain) });
      const second = resolveAdminSessionKey(createTestDatabase(), other, { loadKeyringModule: fakeKeyring(keychain) });

      expect(seenEntryIds).toEqual([
        `lucifer-gate:admin_session_key:${INSTANCE}`,
        `lucifer-gate:admin_session_key:${other}`,
      ]);
      expect(second.key.toString('hex')).not.toBe(first.key.toString('hex'));
    });
  });

  describe('deriveInstanceId', () => {
    it('deriveInstanceId_sameDatabasePath_isStableAcrossRestarts', () => {
      expect(deriveInstanceId('/srv/lucifer/data/lucifer.db'))
        .toBe(deriveInstanceId('/srv/lucifer/data/lucifer.db'));
    });

    it('deriveInstanceId_equivalentRelativePath_resolvesToTheSameId', () => {
      expect(deriveInstanceId('/srv/lucifer/data/../data/lucifer.db'))
        .toBe(deriveInstanceId('/srv/lucifer/data/lucifer.db'));
    });

    it('deriveInstanceId_differentDatabasePaths_differ', () => {
      expect(deriveInstanceId('/srv/a/lucifer.db')).not.toBe(deriveInstanceId('/srv/b/lucifer.db'));
    });

    it('deriveInstanceId_anyPath_leaksNothingReadableAboutIt', () => {
      // The id lands in logs and in the sealed `aud` claim, so it must not carry
      // the filesystem layout with it.
      const id = deriveInstanceId('/srv/lucifer/data/lucifer.db');

      expect(id).toMatch(/^[0-9a-f]{16}$/);
      expect(id).not.toContain('lucifer');
    });
  });

  describe('database branch', () => {
    it('resolveAdminSessionKey_noEnvAndNoKeychain_generatesAndPersistsInTheDatabase', () => {
      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring });

      expect(result.source).toBe('database');
      expect(result.key).toHaveLength(32);
      expect(readStoredKey(db)).toBe(result.key.toString('hex'));
    });

    it('resolveAdminSessionKey_calledTwice_reusesTheStoredKeySoSessionsSurviveRestart', () => {
      const first = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring });

      const second = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring });

      expect(second.key.toString('hex')).toBe(first.key.toString('hex'));
    });

    it('resolveAdminSessionKey_storedRowIsMalformed_regeneratesAndOverwritesIt', () => {
      db.prepare('INSERT INTO server_secrets (name, value, created_at) VALUES (?, ?, ?)')
        .run('admin_session_key', 'corrupted', new Date().toISOString());

      const result = resolveAdminSessionKey(db, INSTANCE, { loadKeyringModule: noKeyring });

      expect(result.key).toHaveLength(32);
      expect(readStoredKey(db)).toBe(result.key.toString('hex'));
    });
  });
});

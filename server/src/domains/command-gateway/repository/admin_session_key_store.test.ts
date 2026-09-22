import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { resolveAdminSessionKey, type KeyringModule } from './admin_session_key_store.js';

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

/** An in-memory stand-in for the OS keychain, so the branch is deterministic. */
function fakeKeyring(store: Map<string, string>, behaviour: 'ok' | 'throws' = 'ok'): () => KeyringModule {
  return () => ({
    Entry: class {
      constructor(private readonly service: string, private readonly account: string) {
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

      const result = resolveAdminSessionKey(db, { loadKeyringModule: fakeKeyring(keychain) });

      expect(result.source).toBe('env');
      expect(result.key.toString('hex')).toBe(hex);
      expect(keychain.size).toBe(0);
      expect(readStoredKey(db)).toBeUndefined();
    });

    it('resolveAdminSessionKey_envKeySurroundedByWhitespace_isAccepted', () => {
      process.env.LUCIFER_ADMIN_COOKIE_KEY = `  ${'b'.repeat(64)}\n`;

      const result = resolveAdminSessionKey(db, { loadKeyringModule: noKeyring });

      expect(result.source).toBe('env');
      expect(result.key).toHaveLength(32);
    });

    it.each([
      ['too short', 'abcdef'],
      ['not hex', 'z'.repeat(64)],
      ['64 bytes instead of 32', 'a'.repeat(128)],
    ])('resolveAdminSessionKey_envKeyMalformed_%s_throwsInsteadOfSilentlyFallingBack', (_label, value) => {
      process.env.LUCIFER_ADMIN_COOKIE_KEY = value;

      expect(() => resolveAdminSessionKey(db, { loadKeyringModule: noKeyring }))
        .toThrow(/LUCIFER_ADMIN_COOKIE_KEY must be 64 hex characters/);
    });
  });

  describe('OS keychain branch', () => {
    it('resolveAdminSessionKey_keychainEmpty_generatesAndStoresThere', () => {
      const keychain = new Map<string, string>();

      const result = resolveAdminSessionKey(db, { loadKeyringModule: fakeKeyring(keychain) });

      expect(result.source).toBe('keychain');
      expect(result.key).toHaveLength(32);
      expect(keychain.get('lucifer-gate:admin_session_key')).toBe(result.key.toString('hex'));
      // The database must stay clean when the keychain answered.
      expect(readStoredKey(db)).toBeUndefined();
    });

    it('resolveAdminSessionKey_keychainHoldsAKey_returnsTheSameKeyAcrossRestarts', () => {
      const keychain = new Map<string, string>();
      const first = resolveAdminSessionKey(db, { loadKeyringModule: fakeKeyring(keychain) });

      const second = resolveAdminSessionKey(createTestDatabase(), { loadKeyringModule: fakeKeyring(keychain) });

      expect(second.source).toBe('keychain');
      expect(second.key.toString('hex')).toBe(first.key.toString('hex'));
    });

    it('resolveAdminSessionKey_keychainHoldsGarbage_replacesItWithAValidKey', () => {
      const keychain = new Map<string, string>([['lucifer-gate:admin_session_key', 'not-a-key']]);

      const result = resolveAdminSessionKey(db, { loadKeyringModule: fakeKeyring(keychain) });

      expect(result.source).toBe('keychain');
      expect(keychain.get('lucifer-gate:admin_session_key')).toBe(result.key.toString('hex'));
    });

    it('resolveAdminSessionKey_keychainThrows_fallsBackToTheDatabase', () => {
      const result = resolveAdminSessionKey(db, { loadKeyringModule: fakeKeyring(new Map(), 'throws') });

      expect(result.source).toBe('database');
      expect(readStoredKey(db)).toBe(result.key.toString('hex'));
    });
  });

  describe('database branch', () => {
    it('resolveAdminSessionKey_noEnvAndNoKeychain_generatesAndPersistsInTheDatabase', () => {
      const result = resolveAdminSessionKey(db, { loadKeyringModule: noKeyring });

      expect(result.source).toBe('database');
      expect(result.key).toHaveLength(32);
      expect(readStoredKey(db)).toBe(result.key.toString('hex'));
    });

    it('resolveAdminSessionKey_calledTwice_reusesTheStoredKeySoSessionsSurviveRestart', () => {
      const first = resolveAdminSessionKey(db, { loadKeyringModule: noKeyring });

      const second = resolveAdminSessionKey(db, { loadKeyringModule: noKeyring });

      expect(second.key.toString('hex')).toBe(first.key.toString('hex'));
    });

    it('resolveAdminSessionKey_storedRowIsMalformed_regeneratesAndOverwritesIt', () => {
      db.prepare('INSERT INTO server_secrets (name, value, created_at) VALUES (?, ?, ?)')
        .run('admin_session_key', 'corrupted', new Date().toISOString());

      const result = resolveAdminSessionKey(db, { loadKeyringModule: noKeyring });

      expect(result.key).toHaveLength(32);
      expect(readStoredKey(db)).toBe(result.key.toString('hex'));
    });
  });
});

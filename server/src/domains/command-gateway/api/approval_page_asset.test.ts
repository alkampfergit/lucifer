import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import Database from 'better-sqlite3';
import { registerApprovalRoutes } from './register_approval_routes.js';
import { createWebApprovalChannel } from '../service/web_approval_channel.js';
import { createApprovalStore } from '../repository/approval_store.js';
import { createAuditLog } from '../repository/audit_log.js';
import { hashApiKey } from '../repository/api_key_store.js';

const ADMIN_SALT = 'assetsalt1234567890abcdef';
const ADMIN_HASH = hashApiKey('luc_admin_asset-secret', ADMIN_SALT);

function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'prefix')),
      duration TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      expires_at TEXT,
      approved_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      request_id TEXT NOT NULL,
      command TEXT,
      api_key_name TEXT,
      ip TEXT,
      rule_action TEXT,
      duration TEXT,
      approved_by TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      error TEXT
    );
  `);
  return db;
}

function registerWithFreshDeps(): void {
  const db = createTestDatabase();
  try {
    registerApprovalRoutes({
      router: express(),
      adminSecretHash: ADMIN_HASH,
      adminSecretSalt: ADMIN_SALT,
      webChannel: createWebApprovalChannel(),
      approvalStore: createApprovalStore(db),
      auditLog: createAuditLog(db),
    });
  } finally {
    db.close();
  }
}

describe('approval page asset', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registerApprovalRoutes_assetMissingFromBuild_throwsInsteadOfServingPlaceholder', () => {
    // Simulate the published-package layout, where the build never copied
    // approval_page.html next to the compiled module.
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(() => registerWithFreshDeps()).toThrow(/approval_page\.html/i);
  });

  it('registerApprovalRoutes_assetPresent_resolvesItNextToTheModule', () => {
    const existsSync = vi.spyOn(fs, 'existsSync');

    expect(() => registerWithFreshDeps()).not.toThrow();

    // The asset must be found beside this module, which is the only layout that
    // holds for both `tsx` development runs and the compiled `dist` tree.
    const checkedPaths = existsSync.mock.calls.map((call) => String(call[0]));
    expect(checkedPaths).toContain(path.join(import.meta.dirname, 'approval_page.html'));
  });
});

describe('copy-assets build step', () => {
  it('copyAssets_htmlUnderServerSrc_mirrorsItIntoTheOutputTree', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lucifer-assets-'));

    try {
      execFileSync(
        process.execPath,
        ['scripts/copy-assets.mjs', `--out=${outRoot}`],
        { cwd: repoRoot, stdio: 'pipe' },
      );

      const copied = path.join(
        outRoot,
        'domains', 'command-gateway', 'api', 'approval_page.html',
      );

      expect(fs.existsSync(copied)).toBe(true);
      const html = fs.readFileSync(copied, 'utf8');
      expect(html).toContain('<title>Lucifer Approvals</title>');
      expect(html).toContain('aria-label="Server pages"');
      expect(html).toContain('href="/admin/approvals"');
      expect(html).toContain('id="history-list"');
      expect(html).toContain('/api/v1/admin/approvals/history');
      expect(html).toContain('setInterval(loadHistory, 60_000)');
      expect(html).toMatch(/request_decided[\s\S]*loadHistory\(\)/);
    } finally {
      fs.rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

# Changelog

All notable changes to Lucifer Gate are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Tag names use the bare `x.y.z` form (no `v` prefix), per AGENTS rule 8.

## [Unreleased] — heading toward 1.0

Target content for 1.0 (tracked in [`docs/quality/PRE-1.0-CHECKPOINT.md`](docs/quality/PRE-1.0-CHECKPOINT.md) §9):

- Close the P0 pre-1.0 checklist: this changelog (R2), docs A1 / D1 (shipped in 0.8.3), and any remaining Must-fix items.
- Stabilise the public HTTP surface on `command-gateway` and `request-proxy`.
- Lock the layered dependency direction (Types → Config → Repository → Service → Runtime → UI/API) as a hard CI invariant.

## [0.11.0] — 2026-09-22

### Added
- **Cookie-backed admin sessions for `/admin/approvals` (#58).** Tick "Remember me on this device" on the login form and the server issues an AES-256-GCM sealed, `HttpOnly` cookie so the page stops asking for the admin secret on every visit. Two new routes: `POST /api/v1/admin/approvals/session` (bearer in, cookie out) and `DELETE …/session` (sign out). The cookie holds a session assertion — `{ v, sub, iat, exp, csrf }` — never the admin secret, and lasts **30 days absolute**; activity does not extend it. On by default; disable with `"adminCookieSession": { "enabled": false }` in `lucifer.json`, which unregisters the session routes entirely. See [ADR-013](docs/context/DECISIONS.md).
- `LUCIFER_ADMIN_COOKIE_KEY` environment variable (64 hex characters) to manage the session sealing key yourself. Otherwise the key is resolved from the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service, via the new optional `@napi-rs/keyring` dependency) and finally from a new `server_secrets` table in `lucifer.db`.

### Security
- Cookie-authenticated state-changing admin routes now require CSRF proof: the readable `lucifer_admin_csrf` cookie echoed in an `X-Lucifer-CSRF` header, compared `timingSafeEqual` against the token sealed *inside* the session cookie (so cookie injection does not defeat it), on top of `SameSite=Strict`. Failures return `403 CSRF_INVALID` and deliberately do not count toward the per-IP auth lockout. Callers using `Authorization: Bearer` — CLI, curl, scripts — are unaffected.
- `lucifer.db` is now opened with mode `0600`, because `server_secrets` may hold the session sealing key.

### Changed
- Admin auth consults the session cookie only when no `Authorization` header was sent. A present-but-wrong bearer secret is still a failed login even if the caller holds a valid cookie, so the per-IP lockout keeps counting real guesses and existing bearer behaviour is byte-for-byte unchanged.

## [0.10.2] — 2026-09-22

### Security
- `npm audit` now reports **0 vulnerabilities** across the whole tree (was 15: 2 low, 4 moderate, 9 high). This supersedes PR #48's original `ip-address` 10.1.0 → 10.2.0 bump and, unlike 0.8.13, covers development scope as well as runtime.
  - Retired the `express-rate-limit` → `ip-address` `10.1.1` override added in 0.8.13. It was explicitly marked "retirable once `express-rate-limit` bumps", and by pinning an exact version it had become the thing *blocking* the fix: `npm audit fix` could not move `ip-address` off a version covered by GHSA-mwp4-54f8-5fhr / GHSA-4xrf-jv44-h6hh / GHSA-22jq-vg5j-6vgg (all high, `<=10.3.0`, SSRF and trust-boundary bypass). `express-rate-limit` 8.3.2 → 8.7.0 declares `ip-address: ^10.2.0`, so dropping the override resolves it at 10.7.2 with no override needed.
  - `tsx` 4.21.0 → 4.23.15 (inside the existing `^4.21.0` range) to move `esbuild` 0.27.7 → 0.28.2, closing GHSA-g7r4-m6w7-qqqr (arbitrary file read via the dev server on Windows; vulnerable range `0.27.3 - 0.28.0`). `npm audit fix` on its own resolved this by *downgrading* `esbuild` to 0.27.2, because `tsx@4.21.0` pins `esbuild ~0.27.0`; bumping `tsx` is the forward fix.
  - Remaining advisories closed by `npm audit fix` within existing ranges: `axios` 1.15.0 → 1.20.0 (high), `form-data` 4.0.5 → 4.0.6 (high), `brace-expansion` 1.1.13 → 1.1.21 and 5.0.5 → 5.0.12 (high), `js-yaml` 4.1.1 → 4.3.2 (high), `nanoid` 3.3.11 → 3.3.19 (high), `postcss` 8.5.8 → 8.5.28 (high), `vite` 8.0.5 → 8.3.0 (high), `@vitest/mocker` / `vitest` 4.1.2 → 4.1.11 (moderate), `qs` 6.15.3 → 6.16.0 (moderate), `@humanfs/node` 0.16.7 → 0.16.8 (moderate), `body-parser` (under `telegram-test-api`) 1.20.4 → 1.20.8 (low).
  - The `telegram-test-api` and `express` → `body-parser` override blocks are untouched.
  - Raised the direct `express-rate-limit` range `^8.3.2` → `^8.7.0`. With the override retired, the old floor was the remaining exposure: `express-rate-limit` 8.3.2–8.5.x depend on an *exact* `ip-address@10.1.0`, which npm cannot resolve away from and which GHSA-mwp4-54f8-5fhr (`<=10.3.0`) covers. 8.6.0 is the first release to widen that to `^10.2.0`. `lucifer-gate` is published and consumers resolve from this range rather than from the lockfile, so the floor — not just the locked version — has to be patched. Lockfile resolution is unchanged (8.7.0 either way).

### Changed
- `vite` 8.3.0 no longer depends on `esbuild`, and `rolldown` 1.0.0-rc.12 → 1.2.9 dropped its `@rolldown/binding-wasm32-wasi` optional dependency. That removes `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`, and `tslib` from the lockfile. These are genuine upstream removals, not the Windows-side platform pruning warned about in 0.8.13 — the lockfile was still regenerated with `npm install --package-lock-only --os=linux --cpu=x64`, `win32` entries are intact, and `npm ci` accepts it.

## [0.10.1] — 2026-09-22

### Changed
- `server/src/domains/command-gateway/api/register_execute_routes.ts` (188 → 181 lines): extracted the rule-resolution + dispatch block into a helper `service/resolve_execution_plan.ts` that returns a discriminated `ExecutionPlan` union (`alias-args-bypass` / `rule-deny` / `always-approve` / `cached-approval` / `manual-approve`). The route handler switches on `plan.kind` and keeps every audit append, HTTP status/code, and the ADR-009 alias-bypass-before-rule-match ordering unchanged. Closes #30 by completing the a/b/c/d decomposition started in PR #45 (parts (a), (c), (d)); this PR is part (b). Focused unit tests cover the planner's branch ordering and each plan kind.

## [0.9.0] — 2026-07-31

### Added
- `lucifer.json` aliases gained two operator-configured knobs, closing the gap between exact-name-only aliases and raw shell commands: `args` (fixed argv appended to the spawned executable, e.g. `"args": ["summary"]`) and `allowArgs` (opt-in; when `true`, a caller may invoke `<name> <args>` and the text after the alias name is whitespace-tokenized and appended after any fixed `args`). Both keep the alias's existing shell-free `spawn(path, args, { shell: false })` execution and its `cwd` forced to the alias's own directory — the property that makes aliases work correctly for tools that resolve state/config relative to their own location, which a raw command cannot guarantee. `allowArgs` resolves ADR-009's deferred "first-token match with argument passthrough" alternative; see ADR-012 for the full design and the anti-bypass analysis (`findAliasArgsBypass` still refuses e.g. `smtp;rm -rf /`, allowed or not).
- `lucifer.json` gained `toolsPath`, an array of directories prepended to every executed command's `PATH`. Scoped to raw (non-alias) commands — it lets an operator run e.g. `mytool --flag` via a `command-rules.json` prefix rule without a full path in every rule, without changing rule matching, approval flow, or alias execution (which never consults `PATH`). Documented as strictly PATH-lookup-only: it does not change the executed command's working directory, unlike an alias.

### Fixed
- `loadJsonConfig` swallowed the real `JSON.parse` error into a generic `"Invalid JSON in config file: <path>"` message, and failed outright on a file with a leading UTF-8 BOM (common for files saved via PowerShell/OneDrive on Windows) with no indication why. Now strips a leading BOM before parsing and includes the underlying parser message in the thrown error.
- SonarCloud `typescript:S7758`: `json_config_loader.ts`'s BOM check used `String#charCodeAt()`; switched to `String#codePointAt()` (equivalent here — U+FEFF is within the BMP).

### Documentation
- README: added a "Running from a local checkout with `node`" section documenting `node dist/server/cli.js --config <path>` as the no-`npx`/no-install equivalent of the published `lucifer-gate` CLI.
- `docs/specs/command-execution.md`, `docs/CONFIGURATION.md`, `docs/wiki/common-setup.md`: documented `args`, `allowArgs`, and `toolsPath`, including the `cwd` distinction between an `allowArgs` alias and a `toolsPath`-resolved raw command.
- ADR-012 added to `docs/context/DECISIONS.md`, resolving ADR-009's deferred argument-passthrough decision and recording why a second parallel "tools" config concept was rejected in favor of extending aliases.

## [0.8.13] — 2026-07-31

### Security
- Closed all 5 runtime-scope Dependabot alerts; `npm audit --omit=dev` now reports 0 vulnerabilities. The 27 development-scope alerts are deliberately left for a separate change — they enter through the dev toolchain and never ship, since `files` is `dist/server/` only.
  - `http-proxy-middleware` `^3.0.5` → `^3.0.7` (direct dependency): closes CVE-2026-55603 (high, CRLF injection in `fixRequestBody`) and CVE-2026-55602 (medium, `router` host+path matching bypass). Both are patched within the 3.x line — 3.0.7 and 3.0.6 respectively — so no major bump to 4.x was needed despite Dependabot surfacing `4.1.1` / `4.1.0` as the first patched version.
  - `qs` → 6.15.3 via express, closing CVE-2026-8723 (medium, `qs.stringify` DoS). Reached inside the existing range; no override needed.
  - `body-parser` → 2.3.0 via a new `express`-scoped override, closing CVE-2026-12590 (low, invalid `limit` silently disables size enforcement). The 2.x branch is patched at 2.3.0, not the `1.20.6` Dependabot lists first.
  - `ip-address` → 10.1.1 via a new `express-rate-limit`-scoped override, closing CVE-2026-42338 (moderate, XSS in `Address6` HTML-emitting methods). `express-rate-limit@8.3.2` pins `ip-address` at an exact `10.1.0`, so an override is the only route; pinned to the exact first-patched version rather than `^10.1.1` to stay closest to what the dependency pinned, and retirable once `express-rate-limit` bumps.
  - The pre-existing `telegram-test-api` override block is untouched; both new overrides are scoped to the offending direct dependency rather than applied globally.

## [0.8.12] — 2026-07-31

### Fixed
- The web approval UI at `/admin/approvals` served a 58-byte `Approval page not found` stub in every installed copy of the package. `tsc` never copied `approval_page.html` into `dist`, and `package.json` publishes only `dist/server/`, so the released package shipped the route without its page. The two source-relative fallbacks in `register_approval_routes.ts` pointed at unpublished paths (one with incorrect path arithmetic) and the third depended on the working directory being the repository root — which is why it worked from a checkout and failed for every real install. Reproduced against `lucifer-gate@0.8.11`.
- `scripts/copy-assets.mjs` now mirrors non-TypeScript runtime assets into `dist/server` as part of `build:server`, and exits non-zero if it finds none.
- `registerApprovalRoutes` resolves the page from one location (next to the module, valid under both `tsx` and `dist`) and throws at startup when it is absent instead of degrading to a stub. Per ADR-011.

### Changed
- `docs/specs/approval-channels.md`: corrected the web-admin enablement condition, which still documented the removed `LUCIFER_ADMIN_SECRET` env var instead of the `adminSecretHash` / `adminSecretSalt` pair in `lucifer.json`.
  - The pre-existing `telegram-test-api` override block is untouched; both new overrides are scoped to the offending direct dependency rather than applied globally.

## [0.8.11] — 2026-04-22

### Changed
- `server/src/domains/request-proxy/service/proxy_auth.ts`: decomposed `authorizeProxyRequest` (13 return sites in a single function) into a typed decision chain — `stepAuthModeAndHeader` → `stepExtractAndValidate` → `stepApiKeyShortCircuit` → `stepApproval`. Each step returns a discriminated `StepResult<T>` (`decided` or `continue`), keeping the composed flow linear. Behaviour-preserving: every `recordAudit` call site, every HTTP status/code, and the public signature of `authorizeProxyRequest` are unchanged; all 329 tests pass (#31).

## [0.8.10] — 2026-04-21

### Changed
- `server/src/cli.ts` (350 → 63 lines): subcommand bodies moved into `server/src/cli/` (`print_help`, `init_config`, `run_log`, `run_stats`, `run_pair`, `run_server`) with a small `args.ts` helper. `cli.ts` is now a thin dispatcher.
- `server/src/domains/command-gateway/api/register_execute_routes.ts` (353 → 188 lines): the `always_approve` / cached-approval execute-and-audit pattern is hoisted into `service/execute_and_audit.ts`; the manual-approve try/catch is hoisted into `service/handle_manual_approval.ts`.
- Behaviour-preserving: audit shape, HTTP status codes, ADR-009 alias-bypass ordering, abort-on-disconnect semantics, and rate-limiter placement all unchanged. All 329 tests still pass (#34, #45).

## [0.8.9] — 2026-04-21

### Changed
- `server/src/create_app.ts`: hoisted optional-collaborator branches in `createApp` into named helpers (`wireCommandGateway`, `wireProxyServers`, `resolveConfigPaths`, `enableFileLoggingIfConfigured`), reducing composition-root nesting from 5 to 2. Behaviour-preserving refactor; all 329 tests pass (#33, #44).

## [0.8.8] — 2026-04-21

### Changed
- `command-gateway`: split the single `rateLimitPerMinute` knob into a per-IP limit (`rateLimitPerIpPerMinute`, enforced at the Express edge) and a per-API-key limit (`rateLimitPerKeyPerMinute`, enforced after authentication). Both are optional and fall back to `rateLimitPerMinute` when unset, so existing `lucifer.json` files keep identical behaviour (#36, #43).

### Added
- Tests covering the new precedence logic: config loader accepts / preserves the two new knobs and rejects non-numeric values; route registration wires the exact per-IP / per-key limits (with fallback) to each limiter layer.

## [0.8.3] — 2026-04-20

### Changed
- Docs: added `request-proxy` to `docs/architecture/DOMAIN-BOUNDARIES.md` (registry, boundary map, integration contracts) and to `docs/quality/QUALITY-GRADES.md`, closing pre-1.0 findings A1 + D1 (#28, #38).

### CI
- `.github/workflows/ci.yml` skips all jobs for docs-only PRs via `paths-ignore` (`**.md`, `docs/**`, `LICENSE`, Copilot instructions).

## [0.8.2] — 2026-04-20

### Added
- `docs/quality/PRE-1.0-CHECKPOINT.md`: end-to-end pre-1.0 technical checkpoint covering architecture, design, testing, code quality, operational + security posture, docs, and release readiness (#25, #27).

### Changed
- Skill rules for GH-driving skills refined (owner-only instructions, polling discipline).

## [0.8.1] — 2026-04-19

### Changed
- README trimmed.
- New `docs/CONFIGURATION.md` consolidating env vars, logging, Docker, and file-layout reference.
- Command-execution spec now folds in API and alias notes (#24).

## [0.8.0] — 2026-04-19

### Added
- `request-proxy` domain gains API-key authentication and Telegram approval modes for transparent proxy traffic (#21).

### Removed
- Azure Container Apps deploy workflow removed from CI.

### Changed
- Skill prose: every GH-driving skill now carries an explicit owner-only instructions clause.

## [0.7.4] — 2026-04-17

### Changed
- Skill docs: watermark off-by-one discipline documented so poll loops don't re-process or skip comments.

## [0.7.3] — 2026-04-17

### Changed
- Polling-discipline memories baked directly into the relevant skills.

## [0.7.2] — 2026-04-17

### Fixed
- Rate-limiter aligns on the correct IP source; `redactApiKeyName` gains dedicated tests.
- 6 code-scanning alerts closed.

### Changed
- `dependabot` skill renamed to `gh-security-and-quality` (broader scope: Dependabot + code-scanning + secret scanning).
- `scheduled_tasks.lock` is now git-ignored.

## [0.7.1] — 2026-04-17

### Added
- `dependabot` skill for automated alert triage, including self-entering polling loop.

### Fixed
- 12 Dependabot alerts closed via `npm overrides`.
- `follow-redirects` bumped (#15).

### Changed
- Skills: every poll cycle is delegated to a laconic subagent; `gh pr checks --watch` replaces 5-minute polling while CI runs.
- `github-pr-fixer` hand-off step added to the dependabot flow.

## [0.7.0] — 2026-04-17

### Added
- Transparent HTTP proxy domain (`request-proxy`) (#16).
- Dev-container setup enriched for Claude Code, Codex, `rtk`, and `tokensave`.

### Fixed
- Proxy lifecycle hardened; loopback address is the default; non-HTTP schemes rejected consistently (addressing Copilot review on #16).

## [0.6.0] — 2026-04-15

### Added
- Command aliases.

### Changed
- Skill directory restructured (progressive disclosure; clearer routing).
- AGENTS.md refreshed for the gstack workflow.

### Fixed
- `isLuciferConfig` cognitive complexity reduced (SonarCloud S3776).
- Code-scanning and SonarCloud security hotspots addressed.
- S4721 hotspot suppressed where safe.

## [0.5.3] — 2026-04-13

### Changed
- **Breaking:** `command-gateway` `POST /api/v1/execute` collapsed to a sync-only contract. The endpoint now blocks until the command reaches a terminal state (success / failure / approval-denied) — there is no separate polling step.
- Claude harness updates.

### Fixed
- Round-1 Copilot review comments addressed.

## [0.5.2] — 2026-04-13

### Fixed
- CLI: clean exit for one-shot commands, friendlier `pair` output, `start` subcommand added.

## [0.5.1] — 2026-04-13

### Changed
- Approval flow hardened; default logging improved; `telegram_approve` renamed to `manual_approve`.

### Fixed
- S7721 and S3776 SonarCloud code smells.
- `apiKeyName` removed from log output to close the clear-text logging CodeQL alert.

### Added
- SSE coverage tests for `new_request` and `request_decided` events (J4-S1).

## [0.5.0] — 2026-04-12

### Added
- End-to-end onboarding journey tests for the web admin and Telegram channels.
- `tokensave` added to the codespaces setup.

### Changed
- `pr-cycle` agent rewritten to leave a PR-comment audit trail.

### Fixed
- SonarCloud S4325 (unnecessary type assertion).

## [0.4.3] — 2026-04-12

### Added
- Comprehensive test coverage across the approval stack.
- `telegram-test-api` in `devDependencies` for CI.

### Fixed
- Admin secret handling hardened.
- `dismissExpiredRequest` moved to module scope (S7721).
- SonarCloud code smells on PR #8.

## [0.4.2] — 2026-04-11

### Added
- Telegram pairing wizard, dual logging (console + file), and `pino-pretty` fallback.

### Removed
- React/Vite frontend — the server is now the sole UI host (see `docs/architecture/DOMAIN-BOUNDARIES.md`).

### Fixed
- Push trigger branch corrected from `main` to `master` in the Azure deploy workflow (#6).
- SonarCloud code smells and security hotspot on PR #7.

### Changed
- Architecture, glossary, and README updated to reflect the server-only layout.

## [0.4.0] — 2026-04-11

### Added
- Web approval UI with multi-channel broadcast alongside Telegram.

### Fixed
- Express rate limiting via `express-rate-limit` (CodeQL).
- WCAG contrast compliance for the approval UI.
- Remaining SonarCloud smells across the UI.

### Removed
- `sessionStorage` usage (CodeQL).

## [0.3.1] — 2026-04-10

### Added
- PR-cycle skill.

## [0.3.0] — 2026-04-10

### Added
- "Close the PR" capability in the PR workflow.
- `sonar` skill restructured with progressive disclosure and PR-fix workflow.
- Additional rounds of tests.

### Removed
- Legacy API-key hash fallback.

### Fixed
- `github-pr-fixer` skill added; PR-checks flow addressed.
- Test duplication reduced; remaining SonarCloud issues cleared.
- All SonarCloud violations flagged on PR #3.

## [0.2.2] — 2026-04-10

### Fixed
- Build fix follow-up.

## [0.2.1] — 2026-04-10

### Changed
- `actions/checkout` bumped to v6.

## [0.2.0] — 2026-04-10

### Added
- CI versioning and npm publish workflow (OIDC provenance).
- `sonar` skill + supporting package scripts.

### Fixed
- Publish job uses `lts/*` Node (matches `azdo-cli`).
- `contents:read` restored on the publish-npm job.
- `NODE_AUTH_TOKEN` override removed; npm OIDC provenance used instead.
- Initial SonarCloud passes.

## [0.1.0] — 2026-04-10

### Added
- Initial scaffold of Lucifer Gate: Express server skeleton, JSON config loader, approval flow foundations, devcontainer, harness docs.
- First dependency-direction checker (same-layer imports allowed).

### Changed
- Azure Container Apps selected as the initial deployment target (later removed in 0.8.0).
- Static fallback and workflow hardening.

---

*Older, unreleased history (pre-0.1.0) lives only in `git log`; everything tagged is captured above. Generated from `git log` on 2026-04-20 while implementing #29.*

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

### Fixed
- The web approval UI at `/admin/approvals` served a 58-byte `Approval page not found` stub in every installed copy of the package. `tsc` never copied `approval_page.html` into `dist`, and `package.json` publishes only `dist/server/`, so the released package shipped the route without its page. The two source-relative fallbacks in `register_approval_routes.ts` pointed at unpublished paths (one with incorrect path arithmetic) and the third depended on the working directory being the repository root — which is why it worked from a checkout and failed for every real install. Reproduced against `lucifer-gate@0.8.11`.
- `scripts/copy-assets.mjs` now mirrors non-TypeScript runtime assets into `dist/server` as part of `build:server`, and exits non-zero if it finds none.
- `registerApprovalRoutes` resolves the page from one location (next to the module, valid under both `tsx` and `dist`) and throws at startup when it is absent instead of degrading to a stub. Per ADR-011.

### Changed
- `docs/specs/approval-channels.md`: corrected the web-admin enablement condition, which still documented the removed `LUCIFER_ADMIN_SECRET` env var instead of the `adminSecretHash` / `adminSecretSalt` pair in `lucifer.json`.

### Security
- Closed all 5 runtime-scope Dependabot alerts; `npm audit --omit=dev` now reports 0 vulnerabilities. The 27 development-scope alerts are deliberately left for a separate change — they enter through the dev toolchain and never ship, since `files` is `dist/server/` only.
  - `http-proxy-middleware` `^3.0.5` → `^3.0.7` (direct dependency): closes CVE-2026-55603 (high, CRLF injection in `fixRequestBody`) and CVE-2026-55602 (medium, `router` host+path matching bypass). Both are patched within the 3.x line — 3.0.7 and 3.0.6 respectively — so no major bump to 4.x was needed despite Dependabot surfacing `4.1.1` / `4.1.0` as the first patched version.
  - `qs` → 6.15.3 via express, closing CVE-2026-8723 (medium, `qs.stringify` DoS). Reached inside the existing range; no override needed.
  - `body-parser` → 2.3.0 via a new `express`-scoped override, closing CVE-2026-12590 (low, invalid `limit` silently disables size enforcement). The 2.x branch is patched at 2.3.0, not the `1.20.6` Dependabot lists first.
  - `ip-address` → 10.1.1 via a new `express-rate-limit`-scoped override, closing CVE-2026-42338 (moderate, XSS in `Address6` HTML-emitting methods). `express-rate-limit@8.3.2` pins `ip-address` at an exact `10.1.0`, so an override is the only route; pinned to the exact first-patched version rather than `^10.1.1` to stay closest to what the dependency pinned, and retirable once `express-rate-limit` bumps.
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

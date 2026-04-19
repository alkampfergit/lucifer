# Pre-1.0 Technical Checkpoint

> **Scope:** end-to-end architecture, design, testing, code quality, operational &
> security posture, docs, and 1.0 release readiness.
> **Branch:** `feature/25` (Closes #25)
> **Date:** 2026-04-19
> **Method:** `/plan-eng-review` framing applied to the existing code (no plan file).
> Structural claims backed by the `tokensave` code graph
> (1025 nodes, 1632 edges, 108 files, 247 functions, 64 methods); runtime claims
> backed by `npm test` (323 tests / 29 files — all passing), `npm run lint` (clean),
> `npm run check:structure` (clean). Index contained 26 stale files at capture
> time; this only affects *a few* `dist/` entries in graph output, which are ignored
> below.
> **Deliverable rule:** this report is the artefact. No code changes were folded in.
> Every recommendation is an explicit candidate for a follow-up issue.

---

## 1. Executive verdict

**Ship 1.0 after closing the three Must-fix items listed in §9.** Structurally the
codebase is in good shape: zero circular dependencies, zero recursion cycles, zero
dead code, zero unused imports, zero `TODO`/`FIXME`/`@ts-expect-error` markers, and
a mechanically-enforced layered dependency direction (`Types → Config → Repository
→ Service → Runtime → UI/API`). The gaps that block a confident 1.0 cut are
a *release-hygiene* gap (missing `CHANGELOG.md`) and a small number of
*complexity hotspots* in the newer HTTP-boundary code.

## 2. Repo snapshot

| Metric | Value | Source |
|---|---|---|
| Source files (`.ts`, non-test) | 39 | `find server/src -name "*.ts" -not -name "*.test.ts"` |
| Test files | 29 | `find server/src -name "*.test.ts"` |
| Tests | 323 passing / 29 files | `npm test` |
| Functions | 247 | `tokensave_status` |
| Methods | 64 | `tokensave_status` |
| Interfaces | 68 | `tokensave_status` |
| Type aliases | 13 | `tokensave_status` |
| Circular deps | 0 | `tokensave_circular` |
| Recursion cycles | 0 | `tokensave_recursion` |
| Dead-code symbols | 0 | `tokensave_dead_code` |
| Unused imports | 0 | `tokensave_unused_imports` |
| God classes | 0 | `tokensave_god_class` |
| `TODO` / `FIXME` / `HACK` / `@ts-expect-error` in `server/src` | 0 | grep |
| Lint | clean | `npm run lint` |
| Structure check | clean | `npm run check:structure` |
| Semver tags in history | 21 (latest: `0.8.1`) | `git tag --list` |
| `package.json` version | `0.1.0-alpha.1` (placeholder — CI overrides) | `package.json:3`, `.github/workflows/ci.yml:137` |
| `CHANGELOG.md` | absent | `ls` |
| `VERSION` file | absent | `ls` |

Stack: TypeScript (strict), Node ≥ 22, Express, `better-sqlite3`, `telegraf`, Vitest,
Pino. Distribution: `dist/server/cli.js` as the `lucifer-gate` bin via `npm`.

## 3. Architecture compliance

### 3.1 Layered dependency direction

The rule in [docs/architecture/DEPENDENCY-RULES.md](../architecture/DEPENDENCY-RULES.md)
is enforced mechanically by `scripts/check-dependencies.mjs` (wired into
`npm run build`). `tokensave_circular` reports **0 cycles** and
`npm run check:structure` passes — the invariant holds today.

### 3.2 Domain boundaries

Three domains live under `server/src/domains/`:

| Domain | Files | Role |
|---|---|---|
| `command-gateway` | ~24 | Auth, rules, approvals (Telegram/web/multi/auto), execute, SQLite, audit |
| `platform-api` | ~5 | `/api/health`, app wiring helpers |
| `request-proxy` | ~5 | Transparent HTTP proxy with API-key + Telegram approval modes (landed #21) |

**Finding A1 (confidence 10/10):** `docs/architecture/DOMAIN-BOUNDARIES.md` documents
only `command-gateway` and `platform-api`. The `request-proxy` domain introduced by
PR #21 (commit `7d04582`) is missing from the domain registry, boundary map, and
integration-contract table. This is a hard documentation drift: AGENTS rule 6
requires docs to update in the same change as behaviour.

### 3.3 Composition root

`server/src/create_app.ts:162 createApp()` wires 21 distinct collaborators
(`tokensave_complexity` fan-out=21). A wiring function *should* be the highest-fan-out
node in the graph — that part is expected. What's not expected is `max_nesting=5`
inside a composition root: branching on env vars, config flags, and optional
collaborators inside the same function is the main cause. See Finding C1.

### 3.4 Coupling fan-in hot spots (healthy)

Top fan-in files are all *type* or *repository* boundary files —
`store_interfaces.ts` (7), `proxy_types.ts` (6), `api_key_store.ts` (6),
`command_types.ts` (5). That is the expected shape: shared types and repository
contracts fan in, business logic doesn't. No god modules.

## 4. Design review

### 4.1 Public HTTP surface

| Domain | Routes | Auth |
|---|---|---|
| `command-gateway` | `POST /api/v1/execute`, `GET /admin/approvals`, `GET /api/v1/admin/approvals/pending`, `POST /api/v1/admin/approvals/stream-ticket`, `GET /api/v1/admin/approvals/stream`, `POST /api/v1/admin/approvals/:requestId/decide` | API key (execute), admin bearer (admin) |
| `platform-api` | `GET /api/health` | none |
| `request-proxy` | transparent passthrough on a separate port | API key + (optional) Telegram |

All five admin routes live in one file (`register_approval_routes.ts`); execute in
another. This is consistent with the documented UI-layer rule (UI may only import
`types` + `service`).

### 4.2 Patterns observed

- **Factory functions + small interfaces** for repositories (`createApiKeyStore`,
  `createApprovalStore`, `createCommandRulesStore`, `createPendingRequestStore`)
  and for approval channels (`createAutoApproveChannel`,
  `createTelegramApprovalChannel`, `createWebApprovalChannel`,
  `createMultiApprovalChannel`). Good — easy to substitute, easy to test.
- **Result-like flows at the HTTP boundary** — `authorizeProxyRequest` returns a
  tagged decision object with 13 return sites; the caller dispatches on the tag.
  Consistent with the "prefer result-like flows for expected failures" invariant.
- **Pino child loggers per module** — every subsystem gets a named child logger.

### 4.3 Anti-patterns / smells

- **`authorizeProxyRequest` has 13 return sites** for one flow (175 lines, cc=15,
  fan_out=15). The shape is "validate ↓ / decide ↓ / emit ↓" collapsed into one
  function. See Finding C2.
- **`executeCommand` reaches `max_nesting=6`** — the deepest nesting in the entire
  codebase. See Finding C3.
- **In-memory pending-request store** (documented in
  [QUALITY-GRADES.md:17](./QUALITY-GRADES.md)). A restart drops every in-flight
  approval. Not a bug; an advertised constraint — but a 1.0 release should state it
  in the README's operational-limits section. See Finding R3.

## 5. Testing review

### 5.1 Coverage breadth

323 tests across 29 files. Coverage map (inferred from test-file naming):

| Area | Test files | Notes |
|---|---|---|
| Command gateway — execute routes | `register_execute_routes.test.ts` (503 lines) | Largest single suite — happy path + 409 dup + risk + alias bypass |
| Command gateway — approval routes | `register_approval_routes.test.ts` (612 lines) | Admin routes + SSE tickets — the one non-trivial test surface |
| Command gateway — telegram approval | `request_telegram_approval.test.ts` (391 lines) | Bot integration seams |
| Command gateway — schema contracts | `schema_contracts.test.ts` (344 lines) | Boundary validation |
| Command gateway — CLI | `cli.test.ts` (485 lines) | `--init`, `pair`, option parsing |
| Request-proxy — proxy server | `proxy_server.test.ts` (542 lines) | End-to-end proxy behavior |
| Request-proxy — proxy auth | `proxy_auth.test.ts` (385 lines) | Auth decision tree |
| E2E — Telegram | `telegram-e2e.test.ts` (473 lines) | Integration harness |

### 5.2 Gaps identified

**Finding T1 (confidence 8/10):** `stats` and `log` CLI commands ride on integration
by convention, not dedicated command-level tests (already flagged in
[QUALITY-GRADES.md:19](./QUALITY-GRADES.md) as a known gap). Worth resolving before
1.0 — these are the two operator-facing debug commands.

**Finding T2 (confidence 6/10):** Health route
(`register_health_routes.ts`) exposes a single function but
`create_health_report.ts` pulls runtime metadata. No direct test file for
`create_health_report.ts` was found in the test map. Verify coverage by invoking
the route in an existing test, or add a targeted test.

**Finding T3 (confidence 7/10):** `tokensave_doc_coverage` flags 7 undocumented
symbols in `api_key_store.ts` (hashApiKey, generateApiKey, generateAdminSecret,
createApiKeyStore, ApiKeyStore interface, findByKey, reload). Several of these are
*security-adjacent*. Not strictly a test gap, but coupled with Finding S2 below.

### 5.3 Regression safety

Recent fixes `2268c7b` (rate-limiter IP source), `dd9f496` (6 code-scanning alerts),
and `ec8f2f1` (12 Dependabot alerts) each include tests per their commit messages.
Regression rule upheld.

## 6. Code quality

### 6.1 Complexity hotspots (top 6, excluding `dist/`)

Source: `tokensave_complexity`. Formula: `lines + fan_out×3 + fan_in`; cyclomatic =
branches + 1.

| Rank | Function | File:line | cc | lines | returns | max_nesting |
|---|---|---|---|---|---|---|
| 1 | `registerExecuteRoutes` | `command-gateway/api/register_execute_routes.ts:61` | 21 | 289 | 10 | 5 |
| 2 | `createTelegramApprovalChannel` | `command-gateway/service/request_telegram_approval.ts:56` | 17 | 174 | 7 | 4 |
| 3 | `createApp` | `server/src/create_app.ts:162` | 16 | 124 | 2 | 5 |
| 4 | `authorizeProxyRequest` | `request-proxy/service/proxy_auth.ts:39` | 15 | 175 | 13 | 2 |
| 5 | `registerApprovalRoutes` | `command-gateway/api/register_approval_routes.ts:143` | 15 | 144 | 8 | 3 |
| 6 | `executeCommand` | `command-gateway/service/execute_command.ts` | 19 | ~140 | 5 | 6 |

**Finding C1 (confidence 9/10):** `registerExecuteRoutes` is 289 lines — nearly
*ten times* the documented 30-line function cap in
[CODE-STANDARDS.md:10](./CODE-STANDARDS.md). Split into (a) input validation,
(b) rule-resolution + risk-analysis, (c) approval-wait, (d) execution handler.
Each is independently testable; current tests already exist to guide the cut.

**Finding C2 (confidence 9/10):** `authorizeProxyRequest` — 13 return sites in one
function is an invariant-by-construction that's easy to break on future edits.
Recommend decomposing into a typed decision chain (key-check → rule-check →
approval-check → final verdict), each step returning the same tagged decision
object the current function builds piecewise.

**Finding C3 (confidence 8/10):** `executeCommand` reaches `max_nesting=6`. Deep
nesting tends to hide error paths. Flatten with early returns; no behavior change.

**Finding C4 (confidence 7/10):** `createApp` `max_nesting=5` inside a composition
root is unusual. Each optional-collaborator branch (`if (config.telegram) { ... }`)
can be hoisted into a named helper (`wireTelegramChannel(config)`), which also
makes integration tests cleaner.

### 6.2 File-length hotspots

Seven source/test files exceed 300 lines (the
[CODE-STANDARDS.md:9](./CODE-STANDARDS.md) cap):

- `register_approval_routes.test.ts` (612) — test file, acceptable
- `proxy_server.test.ts` (542) — test file, acceptable
- `register_execute_routes.test.ts` (503) — test file, acceptable
- `cli.test.ts` (485) — test file, acceptable
- `telegram-e2e.test.ts` (473) — test file, acceptable
- `cli.ts` (349) — production code, **over cap**
- `register_execute_routes.ts` (349) — production code, **over cap**
- `schema_contracts.test.ts` (344) — test file, acceptable

**Finding C5 (confidence 9/10):** `cli.ts:349` and `register_execute_routes.ts:349`
both exceed the 300-line file cap. `cli.ts` is a dispatcher for `start`/`--init`/
`pair`/`log`/`stats`; each subcommand is a natural split point.

### 6.3 Duplication

`tokensave_similar` ran per-symbol (no project-wide smell list). No god classes
(`tokensave_god_class` → 0). No dead code. Subjective spot-reads show low
duplication — factories follow a shared pattern but each touches a distinct SQLite
table.

## 7. Operational & security posture

### 7.1 Logging

Pino + per-module child loggers, with a consistent `module` field. `npm test`
output confirms structured JSON log lines for all major subsystems
(`database`, `api-key-store`, `command-rules`, `app`, `auto-approve`, `executor`).

### 7.2 Input validation at the HTTP boundary

`validateExecuteInput` (internal helper in `register_execute_routes.ts:22`) is the
pattern: explicit `typeof` + length guard, returning a typed `ValidationError`
before the handler body. Consistently applied on the execute route. Approval
routes also perform shape checks before acting.

**Finding S1 (confidence 7/10):** There is no repo-wide boundary-validation helper.
Each route rolls its own. That's fine today but accepts drift. Before 1.0, consider
either (a) a shared `validate(schema, body)` helper or (b) a zod/ajv adapter, so
new routes don't have to re-invent shape checks.

### 7.3 Secret handling

Three secret surfaces: API keys (`api_key_store.ts`), admin bearer token
(`admin_secret`), Telegram bot token (`gateway_config.ts:83 getTelegramToken`).

- API keys hashed on load (`hashApiKey(key, salt)`), not stored in plaintext.
- Telegram token pulled from config or env (`getTelegramToken` returns typed).
- `redactApiKeyName` exists and has dedicated tests (commit `2268c7b`).
- Recent security commits (`dd9f496`, `ec8f2f1`) closed 6 + 12 alerts — trend
  shows active hygiene.

**Finding S2 (confidence 8/10):** The symbol doc-coverage output flags the entire
API-key store surface as undocumented. For security-adjacent primitives
(`hashApiKey`, `generateApiKey`, `generateAdminSecret`), a 1–2 line JSDoc per
exported symbol stating the threat model (what it defends against, what it *does
not*) is cheap insurance.

### 7.4 Audit log completeness

`audit_log.ts` is referenced by command-gateway; `tokensave_coupling` shows 4
coupled files. No test-map query turned up an explicit "every-event-logs" test.
A 1.0-worthy regression test is: for each of `{allow-by-rule, deny-by-rule,
require-approval, approve, deny, execute-success, execute-failure, duplicate-409}`,
assert the audit log contains exactly one row. Candidate follow-up, not a blocker.

### 7.5 Rate limiting / DoS surface

`registerExecuteRoutes` imports `express-rate-limit` and wires a rate limiter
via `createRateLimiter`. `authenticate_request.ts` also contains an internal
`createRateLimiter`/`checkRateLimit`. **Two different rate-limiter implementations
in the same domain** — verify they're not both wired on the same route, and pick
one as the canonical layer before 1.0. See Finding S3.

**Finding S3 (confidence 6/10, medium-verify):** Potential redundant rate limiting
in `command-gateway`. Worth a 10-minute read of the request path to confirm
single-source-of-truth.

## 8. Docs & process

### 8.1 AGENTS.md link integrity

Spot-checked: `docs/architecture/ARCHITECTURE.md`, `DEPENDENCY-RULES.md`,
`DOMAIN-BOUNDARIES.md`, `docs/design/DESIGN-PRINCIPLES.md`, `PATTERNS.md`,
`docs/quality/CODE-STANDARDS.md`, `QUALITY-GRADES.md`, `docs/specs/USER-JOURNEYS.md`,
`docs/workflows/TASK-LIFECYCLE.md`, `REVIEW-CHECKLIST.md` — all resolve. Specs
index at `docs/specs/README.md` resolves. `docs/context/GLOSSARY.md` and
`DECISIONS.md` referenced but not verified for content drift (out of scope for
this checkpoint).

### 8.2 Specs vs code drift

Specs directory contains `approval-channels.md`, `command-execution.md`,
`platform-health.md`, `transparent-proxy.md`, `operator-workflows.md`. The
`transparent-proxy.md` spec matches the shape of the new `request-proxy` domain
— good. **But** `DOMAIN-BOUNDARIES.md` does not list `request-proxy` (Finding A1).

### 8.3 QUALITY-GRADES currency

Last reviewed 2026-04-11. PR #21 landed 2026-04-18 with a brand-new domain. The
table does not include `request-proxy`. Part of the same drift as Finding A1.

**Finding D1 (confidence 10/10):** `QUALITY-GRADES.md` needs a `request-proxy` row
before 1.0.

### 8.4 Semver / release discipline

- 21 semver tags following the `x.y.z` convention (AGENTS rule 8: no `v` prefix) ✓
- Latest tag: `0.8.1`
- `package.json` version: `0.1.0-alpha.1` — **intentional placeholder** ✓
- No `CHANGELOG.md` ✗
- No `VERSION` file ✗

**Finding R1 — resolved / not a drift.** The `version` field in
`package.json` is a placeholder. The publish pipeline derives the real
version from the nearest semver tag in
`.github/workflows/ci.yml` (`version` job, lines 46–108) and overwrites
`package.json` at publish time with
`npm version "$VERSION" --no-git-tag-version --allow-same-version`
(line 137) before `npm publish`. The committed value is therefore
expected to lag the tag stream and is not a ship blocker. No action
required; an optional hardening would be a CI comment in
`package.json` (via a separate `.md` or a `publishConfig` note) that
states the field is CI-managed, to prevent future readers from
re-flagging it.

**Finding R2 (confidence 10/10):** No `CHANGELOG.md`. With 21 tags worth of
history, reconstructing release notes at 1.0 is cheap now and expensive later.

### 8.5 Review/workflow adherence

Recent commits on master (#21, prior fixes) each pair a behaviour change with
doc or test updates — `feat(#21)`, `fix(security)`, `docs(skills)`, `refactor`.
Commit-type hygiene per CODE-STANDARDS §Commit Messages is solid.

## 9. Release-readiness matrix

| Area | Verdict | Notes |
|---|---|---|
| Dependency direction | ✅ clean | Enforced by CI |
| Domain boundaries | ⚠️ doc drift (A1) | request-proxy missing |
| Tests green | ✅ 323/323 |  |
| Lint clean | ✅ |  |
| Structure check | ✅ |  |
| Complexity caps | ⚠️ 3 hotspots (C1, C2, C3) | All in newer HTTP code |
| File-length caps | ⚠️ 2 source files over (C5) |  |
| Semver tag stream | ✅ consistent `x.y.z` | AGENTS rule 8 |
| package.json version | ✅ CI-managed | Placeholder overwritten by publish pipeline |
| CHANGELOG | ❌ missing (R2) |  |
| Security posture | ✅ trending green | 18 alerts recently closed |
| Logging | ✅ consistent Pino |  |
| Docs coverage (JSDoc) | ⚠️ security symbols undocumented (S2) |  |
| Operational limits documented | ⚠️ in-memory pending store not in README (R3) |  |

### 9.1 Must-fix before 1.0 (P0)

1. **A1 + D1 — doc drift from #21.** Add `request-proxy` to
   `DOMAIN-BOUNDARIES.md` (registry, boundary map, integration contracts) and a
   row to `QUALITY-GRADES.md`.
2. **R2 — CHANGELOG.** At minimum, generate a 1.0 CHANGELOG from `git log` that
   lists every tagged release from 0.1.0 through 0.8.1 and the 1.0 summary.
3. **C1 — `registerExecuteRoutes` decomposition.** 289 lines with `cc=21` is a
   future-regression magnet. Split as described in §6.1.

> R1 (package.json version drift) was investigated and dropped: the
> publish pipeline overwrites the field at publish time
> (`.github/workflows/ci.yml:137`), so the committed placeholder is
> intentional. See §8.4.

### 9.2 Should-fix before 1.0 (P1)

5. **C2** — decompose `authorizeProxyRequest` into a typed decision chain.
6. **C3** — flatten `executeCommand` from `max_nesting=6` to ≤3.
7. **C4** — pull optional-collaborator branches out of `createApp`.
8. **C5** — split `cli.ts` (per-subcommand) and `register_execute_routes.ts`
   (per the C1 split).
9. **S2** — add JSDoc to the API-key-store public surface.
10. **S3** — audit `command-gateway` request path for redundant rate limiting.
11. **R3** — README section on operational limits (single-process state,
    SQLite-only).

### 9.3 Nice-to-have / post-1.0 (P2)

12. **S1** — shared boundary-validation helper.
13. **T1** — dedicated tests for `stats` / `log` CLI commands.
14. **T2** — direct test for `create_health_report`.
15. Audit-log completeness regression test.

## 10. Not in scope (explicit)

- No code refactors were applied. Every finding above is a *candidate* for a
  follow-up issue.
- No tests were added.
- No dependency upgrades or `npm audit` triage — that lives in
  `gh-security-and-quality`.
- No SonarCloud issue pull — separate skill (`sonar`).
- No runtime load / performance benchmarking.
- No UI/UX audit of the admin approval page.

## 11. What already exists (pre-1.0 work that's quietly done)

- Mechanical enforcement of dependency direction.
- Pino structured logging across every module.
- Rate limiting on the execute route.
- API-key hashing with salt.
- Audit log with `better-sqlite3`.
- Telegram approval, web approval, auto-approve, and multi-approval channels.
- Transparent proxy with API-key + Telegram modes (PR #21).
- Security-alert triage cadence (skills: `gh-security-and-quality`, `sonar`).
- Review / task-lifecycle docs and checklists.

## 12. Failure modes (one per new codepath, for 1.0 hardening)

| Codepath | Realistic failure | Test? | Handled? | User experience |
|---|---|---|---|---|
| `authorizeProxyRequest` | Upstream creds rotated mid-request | partial | yes (returns typed reject) | 401 with specific code |
| `createTelegramApprovalChannel` | Telegram API 5xx during callback | partial | retry-via-timeout | request eventually times out |
| `executeCommand` | Child process exceeds stdout buffer | unknown | unknown | **potential silent truncation** — verify |
| `registerExecuteRoutes` duplicate detection | Race between two in-flight requests with same ID | yes (409 test) | yes | clear 409 |
| In-memory `pending_request_store` | Server restart mid-approval | not applicable | no (advertised) | pending request lost |
| SSE `/admin/approvals/stream` | Client disconnects uncleanly | unknown | verify | connection cleanup |

The `executeCommand` stdout-buffer case is the most concerning unknown; others are
either handled or documented. Recommend one targeted test before 1.0.

## 13. Outside-voice note

`/plan-eng-review` usually calls an outside AI (Codex / independent subagent) to
challenge the plan. This checkpoint reviews *existing code*, not a plan. An outside
voice pass on 1.0 readiness should run against *this report* before the 1.0 cut —
not as part of this PR.

## 14. How to read this report

- Findings are labelled with a letter (A=architecture, C=complexity/code,
  D=docs, R=release, S=security, T=testing) + number, and a confidence score
  (1–10).
- Each finding has a file:line anchor or a `tokensave_*` query that produced it.
- P0/P1/P2 buckets in §9 are the single place to prioritise.

---

*Generated on branch `feature/25` for issue #25. No behaviour changes introduced
by this PR — report-only.*

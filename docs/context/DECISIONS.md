# Architecture Decision Records (ADRs)

> Every significant architectural decision is recorded here.
> An ADR captures what was decided, why it was decided, and what alternatives were rejected.

## When to Write an ADR

Write an ADR when:
- A new technology, library, or framework is adopted.
- A structural pattern is chosen over alternatives.
- A domain boundary is created, split, or merged.
- A dependency rule exception is granted.
- A convention is established that future code must follow.

## Active ADRs

---

## ADR-001: Use Vite React frontend with an Express delivery tier

**Date**: 2026-04-06
**Status**: Superseded by ADR-008
**Deciders**: alkampfergit

### Context

Lucifer starts from an empty repository and needs a Node + React web application that is simple to run locally, straightforward for agents to reason about, and easy to deploy to Azure.

### Decision

Use Vite + React + TypeScript for the frontend and an Express + TypeScript server for the API and production asset hosting.

### Consequences

- (+) Fast frontend developer experience with a boring, well-known toolchain.
- (+) A single Node runtime fits naturally in a container image for Azure Container Apps.
- (-) Frontend and backend build outputs must be coordinated in CI.

### Alternatives Considered

- **Next.js**: Rejected to keep the starter lighter and closer to a generic Node + React baseline.
- **Separate frontend and backend deployments**: Rejected for the initial scaffold because it adds unnecessary deployment complexity.

---

## ADR-002: Initialize the repository with the ai-landscape harness-engineering template

**Date**: 2026-04-06
**Status**: Accepted
**Deciders**: alkampfergit

### Context

The repository should start with reusable instructions, architecture docs, quality checklists, and skills so coding agents can work effectively from the first change.

### Decision

Copy the ai-landscape template into Lucifer and customize the key architecture, quality, and context documents for this project.

### Consequences

- (+) The repository begins with a complete harness-engineering layout instead of ad hoc notes.
- (+) Future work can evolve from documented architecture and review expectations.
- (-) The docs must be maintained as the application grows.

### Alternatives Considered

- **Minimal README-only setup**: Rejected because it does not provide enough structure for agent-driven development.
- **Invent a new doc layout**: Rejected because the template already encodes the desired patterns.

---

## ADR-003: Deploy Docker images through Azure Container Apps with GitHub Actions

**Date**: 2026-04-06
**Status**: Superseded (2026-04-19)
**Deciders**: alkampfergit

### Context

The app needs a deployment path to Azure that fits a single Node runtime, embraces containerization, and can be automated from GitHub.

### Decision

Build a Docker image from the repository and deploy it to Azure Container Apps using GitHub Actions plus Azure credentials and Azure Container Registry.

### Consequences

- (+) Deployment stays close to the application runtime and uses the same Docker artifact across environments.
- (+) CI and deployment conventions are visible in the repository.
- (-) Deployment requires repository-level Azure credentials and registry configuration.

### Alternatives Considered

- **Azure App Service source deployment**: Rejected because the project now standardizes on container delivery.
- **Manual portal deployments**: Rejected because they are harder to reproduce and review.

### Superseded 2026-04-19

The `azure-container-apps.yml` GitHub Actions workflow was removed. Deployment
to Azure Container Apps (or any other target) is no longer automated from the
repository. `ci.yml` still builds the Docker image for verification and
publishes the npm package; any environment promotion is now done out of band.

---

## ADR-004: Telegram as the approval channel for command gating

**Date**: 2026-04-10
**Status**: Accepted
**Deciders**: alkampfergit

### Context

Lucifer needs a human-in-the-loop approval mechanism for commands from AI agents. The channel must be accessible on mobile, support interactive buttons, and be usable without building custom UI.

### Decision

Use Telegram Bot API (via telegraf) as the sole approval channel for v1. Approvals arrive as inline keyboard messages with buttons for exact/prefix approval at various durations.

### Consequences

- (+) Mobile-accessible, real-time notifications, no custom UI needed for v1
- (+) Inline keyboards provide a natural UX for approve/deny decisions
- (-) Requires users to set up a Telegram bot via @BotFather
- (-) Single-channel dependency; Telegram outages block all approval-gated commands

### Alternatives Considered

- **Web-based approval UI**: Rejected for v1; requires building and hosting a separate interface
- **Slack**: Viable but Telegram was preferred for the specific use case (personal tool)
- **Email**: Rejected; too slow for real-time command approval

---

## ADR-005: Hybrid storage (JSON config + SQLite runtime)

**Date**: 2026-04-10
**Status**: Accepted
**Deciders**: alkampfergit

### Context

Lucifer needs persistent storage for API keys, command rules, approval decisions, and audit logs. The original requirement was "no database, simple configuration files."

### Decision

Use JSON files for human-editable configuration (lucifer.json, api-keys.json, command-rules.json) and SQLite (better-sqlite3) for runtime state (approval decisions and audit log). SQLite is still a single file on disk with no external server dependency.

### Consequences

- (+) Config files are human-readable and editable with any text editor
- (+) SQLite provides concurrent-safe writes, queryable audit data, and WAL mode
- (+) No external database server or service required
- (-) SQLite is not human-readable; requires CLI tools or the `lucifer log`/`stats` commands

### Alternatives Considered

- **All JSON files**: Rejected because concurrent writes between server and CLI admin are unsafe without file locking
- **Full external database (Postgres, etc.)**: Rejected; too heavy for a single-instance tool

---

## ADR-006: Exact-match and prefix-match command approvals

**Date**: 2026-04-10
**Status**: Accepted
**Deciders**: alkampfergit

### Context

When a human approves a command via Telegram, should that approval apply only to the exact command string, or to all commands sharing the same prefix?

### Decision

Support both exact and prefix matching. The Telegram approval buttons offer both options. Prefix approvals are capped at 8 hours maximum (never permanent) to limit privilege escalation risk.

### Consequences

- (+) Reduces approval fatigue for commonly used command prefixes (e.g., "git pull")
- (+) Exact-match remains available for one-off commands
- (-) Prefix matching can inadvertently approve dangerous variants (e.g., "git push --force" matching "git push")

### Alternatives Considered

- **Exact-match only**: Rejected because AI agents generate many command variants, causing fatal approval fatigue
- **Glob/regex patterns**: Deferred to future version; adds complexity and config management burden

---

## ADR-007: Unify approval surfaces behind an ApprovalChannel abstraction

**Date**: 2026-04-11
**Status**: Accepted
**Deciders**: alkampfergit

### Context

Lucifer already supports Telegram approvals, but development and operational
workflows need additional surfaces:

- development mode should be able to bypass human approval cleanly
- operators may want a browser-based approval surface without removing Telegram
- the execute flow should not duplicate business logic for each approval path

### Decision

Model human approval behind `ApprovalChannel` and provide concrete
implementations for Telegram, web admin, auto-approve, and a multi-channel
wrapper that resolves whichever channel decides first.

### Consequences

- (+) The execute flow depends on one approval contract instead of hard-coding Telegram
- (+) Web admin approval can be enabled independently with `LUCIFER_ADMIN_SECRET`
- (+) Development mode stays simple through `--auto-approve`
- (-) Approval channel lifecycle and cancellation semantics must stay consistent across implementations

### Alternatives Considered

- **Hard-code Telegram everywhere**: Rejected because it couples the command flow to a single transport
- **Separate execute flows per channel**: Rejected because it duplicates approval orchestration and makes behavior drift likely

---

## ADR-008: Remove the unused bundled React/Vite frontend

**Date**: 2026-04-11
**Status**: Accepted
**Deciders**: alkampfergit

### Context

The repository still contained the starter React/Vite application, but the real
product workflows already lived elsewhere:

- command execution and approvals are backend APIs
- the operator approval UI is a plain server-served HTML page
- the React app only rendered starter copy plus a health check

Keeping the frontend added build, dependency, and documentation weight without
supporting the core product.

### Decision

Remove the bundled React/Vite frontend and keep Lucifer backend-first. Retain
the `/api/health` endpoint and the server-delivered admin approval UI.

### Consequences

- (+) Smaller dependency surface and faster build/dev workflow
- (+) Architecture aligns with the actual shipped behavior
- (+) Less template residue for future work to work around
- (-) A richer browser UI will need to be reintroduced intentionally if the product later needs one

### Alternatives Considered

- **Keep the frontend as a placeholder**: Rejected because it was already drifting into misleading template code
- **Rewrite the admin approval UI into React immediately**: Rejected because there is no current product requirement for that extra surface

---

## ADR-009: Command aliases resolved at execution time, rule-matched on the alias name

**Date**: 2026-04-15
**Status**: Accepted
**Deciders**: alkampfergit

### Context

Operators wanted a way to register short names in `lucifer.json` that point at scripts or executables on disk, so that `POST /api/v1/execute` can launch them without involving a shell and with a predictable working directory.

Two design axes needed a decision:

1. **Where does alias resolution happen?** In the API layer before rule matching, or in the service layer at execution time.
2. **What does `command-rules.json` match against for an alias invocation?** The alias name as sent by the caller, or the resolved script path.

### Decision

Add an optional `aliases` map to `lucifer.json` of the shape `{ [name]: { path, type } }`, where `type` is `"bash"` or `"elf"`.

- **Resolution point**: service layer (`resolveAlias` in `execute_command.ts`). The HTTP payload is unchanged; the API layer does not need to know about aliases.
- **Match semantics (v1)**: exact full-string match. `"deploy"` invokes the alias; `"deploy --dry-run"` does not.
- **Execution**: `spawn` with `shell: false`. `bash` aliases launch via `bash -- <path>` (the `--` ends option parsing); `elf` aliases execute the path directly. The script's parent directory becomes the child `cwd`, and any caller-supplied `cwd` is ignored. Relative alias paths in `lucifer.json` are normalized against the config file's directory at load time.
- **Rule matching**: `command-rules.json` continues to match against the raw command string sent by the caller — i.e. the alias *name*, not the resolved script path.
- **Fallback**: no alias match (or no `aliases` configured) → existing shell-based path unchanged.

### Consequences

- (+) Shell-injection-free: shell metacharacters inside an alias `path` are never interpreted.
- (+) Rule authoring is unchanged — operators gate aliases the same way they gate any other command.
- (+) Opt-in: no impact on callers or configs that don't use aliases.
- (-) Exact-string match means `"<alias> --flag"` falls through to the shell and is usually denied by policy. Surprising for operators used to shell-alias semantics. Documented in README.
- (-) Rules cannot target the resolved script path. Acceptable because the alias admin and the rule admin are the same role.
- (-) Caller-supplied `cwd` is silently dropped for alias invocations. Documented, not logged.

### Alternatives Considered

- **Resolve aliases in the API layer and match rules against the resolved script path**. Rejected: pushes filesystem paths into the rule engine and makes a typo in an alias path silently shift rule applicability. Matching on the caller-provided name is simpler and less surprising.
- **Dedicated alias endpoint (`POST /api/v1/alias/:name`)**. Rejected: splits audit, approval, and rule flows across two endpoints. Keeping one `/execute` endpoint means alias and non-alias commands share identical machinery.
- **More alias types (`python`, `node`, custom interpreter templates)**. Deferred. Two types cover the v1 need; adding more is additive.
- **First-token match with argument passthrough** (`"deploy --dry-run"` → alias `deploy` with argv `["--dry-run"]`). Deferred: requires a separate decision on how to tokenize the remainder of the command string (naive whitespace vs shell-style vs an API change), and changes the behavior of inputs that currently fall through to the shell.

---

## ADR-010: Transparent HTTP proxy as a separate domain on its own ports

**Date**: 2026-04-17
**Status**: Accepted
**Deciders**: alkampfergit

### Context

Lucifer is primarily a command firewall, but operators also want it to act as
a transparent HTTP proxy in front of upstream AI APIs (e.g. OpenAI). The
proxy must inject authentication headers server-side so callers don't hold
the credential, while preserving path, method, body, and query string.

Three design axes needed decisions:

1. **Where does the proxy live?** Inside `command-gateway`, inside
   `platform-api`, or in its own domain.
2. **Where does the config live?** Embedded in `lucifer.json` (like
   `aliases`) or in a separate file.
3. **Does the feature share the main gateway port?** Sub-path on the
   existing listener, or dedicated listeners on operator-chosen ports.

### Decision

- **New domain `request-proxy`** with `types/`, `config/`, and `service/`
  layers. No `api/` layer: the proxy exposes no surface on the main Express
  app.
- **Dedicated config file `proxy-config.json`** alongside `lucifer.json`.
  File absent → feature disabled. File present with `{ "proxies": [] }` →
  feature enabled, no listeners.
- **One dedicated HTTP listener per mapping**, on an operator-chosen port.
  Ports must not collide with each other or with the main gateway port;
  validated at startup.
- **Library**: `http-proxy-middleware` (well-maintained, Express-compatible,
  wraps `http-proxy`). No bespoke proxy logic.
- **Header semantics**: configured headers *overwrite* caller-supplied
  headers of the same name. The primary use is credential injection where
  the caller must not be able to override the configured value.

### Consequences

- (+) Clear separation: command-gateway stays focused on command firewalling.
- (+) Secrets (proxy auth headers) live in their own file operators can
  mount as a secret / restrict via file permissions independently of
  `lucifer.json`.
- (+) Opt-in: legacy installs that never create `proxy-config.json` see no
  behavior change.
- (+) Dedicated listeners mean proxy traffic bypasses the gateway's API-key
  middleware and rate limiter — appropriate because the proxy has its own
  auth model (the injected credential on the outbound side).
- (-) Two config files to manage instead of one.
- (-) Operators must pick and manage additional ports.
- (-) No policy enforcement on proxied traffic beyond header injection
  (explicitly out of scope for v1).

### Alternatives Considered

- **Embed proxy mappings in `lucifer.json`**. Rejected: auth headers are
  secrets, and bundling them into the main config works against operators
  who want to rotate credentials or mount them from a secret manager
  independently.
- **Sub-path on the main gateway port** (e.g. `/proxy/openai/*`). Rejected:
  it forces the caller to know the proxy exists and rewrites path prefixes
  — no longer "transparent". Also couples proxy lifecycle to the gateway
  port and to its API-key middleware.
- **Put the proxy inside `command-gateway`**. Rejected: HTTP proxying has
  no relation to command approval or execution; mixing them would make
  `command-gateway`'s responsibilities harder to reason about.
- **Hand-rolled proxy using Node streams**. Rejected per the issue brief —
  use a well-maintained library.
- **Let configured headers *merge* with caller-supplied headers rather than
  overwrite**. Rejected: caller-supplied `Authorization` overriding the
  configured credential would defeat the feature's primary purpose.

---

## ADR-011: Runtime assets are copied by the build, and missing ones fail startup

**Date**: 2026-07-31
**Status**: Accepted
**Deciders**: alkampfergit

### Context

`tsc` emits only `.js` from `.ts`, so `approval_page.html` — the web approval
UI — was never copied into `dist`. Because `package.json` publishes only
`dist/server/`, the released package contained the admin route but not the page
it serves. `registerApprovalRoutes` hid this: it probed three candidate paths and
fell back to a 58-byte `<h1>Approval page not found</h1>` stub. Two of those
candidates pointed into `server/src`, which is never published, and one depended
on the process working directory happening to be the repository root.

The result was a server that logged `Web approval UI enabled at /admin/approvals`
and returned HTTP 200, while being impossible to approve anything through. It
reached a published release because the route test asserted only status 200,
`text/html`, and a non-empty body — all of which the stub satisfies.

### Decision

1. The build copies non-TypeScript runtime assets into the output tree via
   `scripts/copy-assets.mjs`, wired into `build:server`. The script exits
   non-zero if it finds no assets, so the extension list cannot silently drift
   away from the tree.
2. Runtime assets are resolved from a single location: next to the importing
   module. That one path holds for both `tsx` development runs and the compiled
   `dist` tree, so cwd- and source-relative fallbacks are removed.
3. A missing asset throws at startup rather than degrading. Tests assert on real
   page markers, never just status and content type.

### Consequences

- (+) A packaging regression fails the build or the boot, not a human opening a
  page hours later.
- (+) One resolution path instead of three, none of which depended on cwd.
- (+) The failure message names the missing file and the fix (`npm run build`).
- (-) Adding a new runtime asset type means updating `assetExtensions`; the
  zero-asset guard makes that omission loud rather than silent.
- (-) The gateway now refuses to start on a broken build even when Telegram
  could have served approvals on its own. Accepted: a half-working approval
  surface is worse than a clear failure.

### Alternatives Considered

- **Bundle the HTML into the TypeScript source as a string literal**. Rejected:
  a 13 KB page with its own CSS and JS becomes unreadable and undiffable, and
  loses editor tooling.
- **Add `server/src/**/*.html` to `package.json` `files`**. Rejected: it ships
  source paths that the compiled code cannot resolve without keeping the broken
  source-relative fallbacks alive.
- **Keep the placeholder but make it explain the problem**. Rejected: the
  channel reports itself as enabled, so a running server with an unusable
  approval surface still looks healthy to every automated check.
- **`resolveJsonModule`-style import of the asset**. Rejected: TypeScript has no
  equivalent for HTML, and a bundler is disproportionate for one file.

---

## ADR-012: Alias caller-argument passthrough via opt-in `allowArgs`

**Date**: 2026-07-31
**Status**: Accepted
**Deciders**: alkampfergit

### Context

ADR-009 explicitly deferred "first-token match with argument passthrough" as
requiring a separate decision. An operator hit the gap directly: a tool
(`Smtp.exe`) needs a caller-controllable argument (e.g. `--unread`), and
neither existing option fit — a plain alias rejects any argument outright
(`ALIAS_ARGS_NOT_SUPPORTED`), and a `toolsPath`-resolved raw shell command
finds the executable but runs it with the daemon's own `cwd`, not the
executable's directory, so tools that resolve state/config relative to their
own location silently produce no output.

Aliases already solve the `cwd` problem correctly (the script's parent
directory, always) — the only missing piece was letting the caller add
arguments without losing that guarantee or reopening the shell-injection
surface ADR-009's exact-match rule closed.

### Decision

Add an optional `allowArgs: boolean` (default `false`) to `CommandAlias`.

- **Opt-in per alias**: existing aliases and configs are unaffected unless an
  operator explicitly sets `allowArgs: true`.
- **Match semantics (v1)**: when `allowArgs` is true, `resolveAlias` accepts
  `<name> <rest>` in addition to the existing exact-name match, requiring a
  whitespace boundary immediately after `<name>` (not just any string with
  that prefix). `<rest>` is tokenized by naive whitespace-splitting — no
  quoted-string support — and appended to `spawnArgs` after any fixed `args`.
- **Execution**: unchanged from ADR-009 — `spawn(path, args, { shell: false
  })`, `cwd` forced to the alias's own directory. Caller-supplied tokens are
  argv elements, never shell input, so shell metacharacters in a token carry
  no special meaning regardless of `allowArgs`.
- **Anti-bypass check preserved**: `findAliasArgsBypass` only treats a
  command as a legitimate args invocation when the alias has `allowArgs:
  true` *and* the whitespace-boundary condition holds; e.g. `smtp;rm -rf /`
  (no boundary) is still flagged as a bypass and rejected, exactly as for an
  alias without `allowArgs`.
- **Rule matching unchanged**: `command-rules.json` continues to prefix-match
  the full raw command string, so a `manual_approve` rule on the alias name
  still gates every invocation, arguments included, and an approver sees the
  literal arguments before approving.

### Consequences

- (+) Closes the gap ADR-009 deferred, using the same shell-free execution
  guarantee — no new attack surface versus a fixed-args-only alias.
- (+) `toolsPath` (added alongside this) remains scoped to what it's actually
  good for: raw commands that don't care about their own directory. Tools
  that need their own `cwd` and caller arguments use `allowArgs` instead of a
  parallel "tools" config concept.
- (-) Naive whitespace tokenization has no quoted-string support in v1;
  `--subject "hello world"` becomes three tokens, not two. Documented as a
  known gap, not solved here.
- (-) Approval caching by "prefix" (first two tokens, per the wiki's shared
  approval behavior) means a human approving `smtp --unread` by prefix also
  approves any other invocation sharing those first two tokens. Operators
  wanting per-argument approval granularity should use "exact" caching.

### Alternatives Considered

- **A separate `tools` config list of `{ name, path }`, independent of
  `aliases`**. Rejected: it would duplicate the exact `path` + `cwd =
  dirname(path)` + shell-free-spawn logic aliases already implement
  correctly, for no behavioral difference — two systems doing the same
  thing invites drift.
- **Shell-style quoted-argument parsing in v1**. Deferred: adds a real
  parsing surface (escaping, nested quotes) for a v1 feature meant to close
  a specific, narrow gap. Naive whitespace-splitting is simpler to audit and
  sufficient for the motivating case.
- **Always-on argument passthrough for every alias (no `allowArgs` flag)**.
  Rejected: silently changes the security posture of every existing alias
  config on upgrade. Opt-in keeps ADR-009's exact-match guarantee as the
  default.

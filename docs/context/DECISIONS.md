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
**Status**: Accepted
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
**Status**: Accepted
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

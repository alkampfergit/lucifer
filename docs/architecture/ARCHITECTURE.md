# Architecture Map

> This document provides the top-level view of the system's architecture.
> Read this first when working on any structural change.

## System Overview

Lucifer Gate is a Node/TypeScript application that sits between an external
caller and the local shell.

- The Express server exposes health, execution, status, and optional admin approval endpoints.
- The `command-gateway` domain owns API key auth, rate limiting, rule matching,
  risk analysis, approval orchestration, command execution, and audit logging.
- Runtime state lives in SQLite under the configured `dataDir`.
- Operator-managed configuration lives in JSON files under `config/`.
- The React frontend currently remains a lightweight browser shell for platform
  health; the approval UI is a server-delivered HTML page in the backend.

## Domain Map

| Domain | Description | Status | Quality Grade |
|---|---|---|---|
| `command-gateway` | Core domain: request auth, policy rules, approval channels, command execution, audit | Active | See QUALITY |
| `platform-api` | Server bootstrap plus platform-facing HTTP surface such as `/api/health` and static asset hosting | Active | See QUALITY |
| `web-shell` | Browser-side React app that fetches and renders platform health status | Active | See QUALITY |
| `shared` | Reserved location for future versioned contracts and stateless shared utilities | Reserved | See QUALITY |

## Layer Structure (per domain)

Each domain is internally divided into layers with strict dependency direction:

```
Types → Config → Repository → Service → Runtime → UI/API
  ←  dependencies flow LEFT to RIGHT only  →
```

- **Types**: DTOs and validated shapes shared inside the domain.
- **Config**: Environment parsing and default values.
- **Repository**: Data access or integration wrappers.
- **Service**: Business logic and orchestration.
- **Runtime**: Bootstrap and dependency wiring.
- **UI/API**: Browser UI or HTTP endpoint surfaces.

See [DEPENDENCY-RULES.md](DEPENDENCY-RULES.md) for enforcement details.

## Cross-Domain Communication

Domains communicate through:
1. **HTTP contracts** — the `web-shell` reads the `platform-api` `/api/health` contract.
2. **Runtime wiring** — `server/src/create_app.ts` composes `platform-api` and `command-gateway` without either domain importing the other's internals.
3. **Shared contracts** — future cross-domain DTOs belong in `shared` once a contract is used by more than one domain.

Anti-patterns:
- ❌ Frontend components importing backend implementation details.
- ❌ Backend routes reaching into frontend build code.
- ❌ Cross-domain imports that bypass the `shared` boundary.

## Infrastructure

| Component | Technology | Notes |
|---|---|---|
| Primary database | SQLite via `better-sqlite3` | Stores approvals and audit log under the configured `dataDir` |
| Operator config | JSON files | `lucifer.json`, `api-keys.json`, `command-rules.json` |
| Approval transport | Telegram Bot API via `telegraf` | Primary human approval channel |
| Optional admin surface | Express + server-rendered HTML + SSE | Enabled when `LUCIFER_ADMIN_SECRET` is set |
| Rate limiting | `express-rate-limit` + in-memory auth limiter | Protects execute and admin approval routes |
| Logging | `pino` | Console logs plus optional JSON file logging |
| Command execution | Node child process APIs | Timeout, output caps, and concurrency limits enforced in service layer |
| CI/CD | GitHub Actions | `ci.yml` validates and `azure-container-apps.yml` deploys |
| Observability | Console logs + Azure Container Apps logs/metrics | Expand to structured telemetry when features grow |

## Key Architectural Decisions

For the full list, see [DECISIONS.md](../context/DECISIONS.md).

Most impactful decisions:
1. [ADR-001]: Use Vite React frontend with an Express delivery tier.
2. [ADR-002]: Initialize the repository with the ai-landscape harness-engineering template.
3. [ADR-003]: Deploy Docker images through Azure Container Apps using GitHub Actions.
4. [ADR-004]: Use Telegram as the primary approval channel for command gating.
5. [ADR-005]: Split persistence between JSON config and SQLite runtime state.
6. [ADR-007]: Model approvals behind a channel abstraction so Telegram, web UI, and auto-approve can share the same flow.

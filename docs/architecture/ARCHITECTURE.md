# Architecture Map

> This document provides the top-level view of the system's architecture.
> Read this first when working on any structural change.

## System Overview

```
Lucifer follows a layered domain architecture across a React frontend and an Express backend.
The frontend owns the web shell and boundary validation for API responses.
The backend owns HTTP APIs, static asset hosting, and Azure-ready runtime configuration.
```

## Domain Map

| Domain | Description | Status | Quality Grade |
|---|---|---|---|
| `web-shell` | React UI, client-side state, and browser API access | Active | See QUALITY |
| `platform-api` | Express HTTP endpoints, server bootstrap, and deployment runtime | Active | See QUALITY |
| `shared` | Cross-domain contracts and utilities safe to reuse | Active | See QUALITY |

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
2. **Shared contracts** — future cross-domain types belong in `shared`.
3. **Bootstrapping seams** — top-level app entrypoints wire layers together without bypassing contracts.

Anti-patterns:
- ❌ Frontend components importing backend implementation details.
- ❌ Backend routes reaching into frontend build code.
- ❌ Cross-domain imports that bypass the `shared` boundary.

## Infrastructure

| Component | Technology | Notes |
|---|---|---|
| Primary database | None yet | Starter app ships without persistent storage |
| Event store | None | Not needed for the initial starter |
| Cache | None | Add only when a concrete need exists |
| Message bus | None | Cross-domain communication is synchronous today |
| CI/CD | GitHub Actions | `ci.yml` validates and `azure-webapp.yml` deploys |
| Observability | Console logs + Azure App Service metrics | Expand to structured telemetry when features grow |

## Key Architectural Decisions

For the full list, see [DECISIONS.md](../context/DECISIONS.md).

Most impactful decisions:
1. [ADR-001]: Use Vite React frontend with an Express delivery tier.
2. [ADR-002]: Initialize the repository with the ai-landscape harness-engineering template.
3. [ADR-003]: Deploy through Azure App Service using GitHub Actions.

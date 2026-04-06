# Domain Boundaries

> This document defines every bounded context, its ownership, and the
> contracts through which domains interact. Update this whenever a new
> domain is added or boundaries change.

## Boundary Map

```
┌─────────────────┐   HTTP JSON   ┌────────────────────┐
│    web-shell    │ ────────────► │    platform-api    │
│ React + Vite UI │               │ Express + Node API │
└────────┬────────┘               └─────────┬──────────┘
         │                                  │
         └──────── shared contracts ────────┘
                   (future shared domain)
```

## Domain Registry

### web-shell

- **Responsibility**: Render the starter experience and validate browser-facing API responses.
- **Bounded context**: UI components, browser fetches, and view-state for the Lucifer landing screen.
- **Published events**: None yet.
- **Consumed events**: None; the domain consumes HTTP responses only.
- **Public API surface**: The rendered landing page and browser requests to `/api/health`.
- **Data ownership**: Client-side ephemeral state only.

### platform-api

- **Responsibility**: Expose HTTP endpoints, serve built frontend assets, and honor Azure runtime configuration.
- **Bounded context**: Express route handlers, environment parsing, and server-side health reporting.
- **Published events**: None yet.
- **Consumed events**: None yet.
- **Public API surface**: `/api/health` and the static site entrypoint.
- **Data ownership**: Process environment and server-generated health metadata.

### shared

- **Responsibility**: Hold contracts and utilities that may be safely reused across domains.
- **Bounded context**: Versioned DTOs and stateless helpers with no domain ownership ambiguity.
- **Published events**: None yet.
- **Consumed events**: None yet.
- **Public API surface**: Shared TypeScript modules only.
- **Data ownership**: None; this domain is contract-only.

## Integration Contracts

| Source Domain | Target Domain | Mechanism | Contract Location |
|---|---|---|---|
| `web-shell` | `platform-api` | HTTP GET `/api/health` | `server/src/domains/platform-api/types/health_report.ts` |
| `platform-api` | `web-shell` | Static asset hosting | `dist/client/index.html` |

## Rules for Modifying Boundaries

1. **Adding a new domain**: Use the `add-domain` skill and update this file.
2. **Splitting a domain**: Create an ADR first and preserve the current contract during migration.
3. **Merging domains**: Requires doc updates here, in `ARCHITECTURE.md`, and in ADRs.
4. **Adding a cross-domain dependency**: Route it through `shared` or an explicit API contract.

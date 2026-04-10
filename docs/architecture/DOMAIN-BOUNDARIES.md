# Domain Boundaries

> This document defines every bounded context, its ownership, and the
> contracts through which domains interact. Update this whenever a new
> domain is added or boundaries change.

## Boundary Map

```
                              ┌────────────────────┐
                              │  command-gateway   │
                              │ Auth, Rules, Exec  │
                              │ Telegram, SQLite   │
                              └────────┬───────────┘
                                       │
┌─────────────────┐   HTTP JSON   ┌────┴───────────────┐
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

### command-gateway

- **Responsibility**: Authenticate API callers, match commands against policy rules, manage Telegram approval flow, execute approved commands, and log all activity.
- **Bounded context**: API key validation, command-rules matching, SQLite approval/audit storage, Telegram bot integration, child process execution.
- **Published events**: None (approval decisions stored in SQLite, audit log appended).
- **Consumed events**: Telegram callback queries (inline button presses).
- **Public API surface**: `POST /api/v1/execute`, `GET /api/v1/status/:requestId`.
- **Data ownership**: SQLite database (`data/lucifer.db`) for approvals and audit log. Reads JSON config files (`api-keys.json`, `command-rules.json`) owned by the operator.
- **Key interfaces**: `ApprovalChannel` (abstracts Telegram vs auto-approve vs future channels).

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
| `web-shell` | `platform-api` | HTTP GET `/api/health` | Server response shape: `server/src/domains/platform-api/types/health_report.ts`; browser validation contract: `src/domains/web-shell/types/health_status.ts` |
| `platform-api` | `web-shell` | Static asset hosting | `dist/client/index.html` |
| External caller | `command-gateway` | HTTP POST `/api/v1/execute` | Request: `{ command, cwd? }` + `x-api-key` header; Response: `ExecutionResult` |
| External caller | `command-gateway` | HTTP GET `/api/v1/status/:requestId` | Response: `{ requestId, status, stdout?, stderr?, exitCode? }` |
| `command-gateway` | Telegram Bot API | HTTPS (telegraf) | Inline keyboard messages + callback queries |
| `command-gateway` | SQLite | `better-sqlite3` | `data/lucifer.db` (approvals + audit_log tables) |
| `command-gateway` | JSON config | `fs.readFileSync` | `config/api-keys.json`, `config/command-rules.json` |

> Note: `/api/health` does not yet live in a true shared DTO module. The browser-side
> `HealthStatus` contract in `web-shell` must remain in sync with the server's
> `health_report` shape until this contract is moved into `shared`.

## Rules for Modifying Boundaries

1. **Adding a new domain**: Use the `add-domain` skill and update this file.
2. **Splitting a domain**: Create an ADR first and preserve the current contract during migration.
3. **Merging domains**: Requires doc updates here, in `ARCHITECTURE.md`, and in ADRs.
4. **Adding a cross-domain dependency**: Route it through `shared` or an explicit API contract.

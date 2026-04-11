# Domain Boundaries

> This document defines every bounded context, its ownership, and the
> contracts through which domains interact. Update this whenever a new
> domain is added or boundaries change.

## Boundary Map

```
                              ┌────────────────────┐
                              │  command-gateway   │
                              │ Auth, Rules, Exec  │
                              │ Approvals, SQLite  │
                              └────────┬───────────┘
                                       │
                           ┌───────────┴────────────┐
                           │      platform-api      │
                           │  Health + app wiring   │
                           └────────────────────────┘
```

## Domain Registry

### platform-api

- **Responsibility**: Expose platform-level HTTP endpoints and bootstrap the composed server.
- **Bounded context**: Express app setup, environment parsing, and server-side health reporting.
- **Published events**: None yet.
- **Consumed events**: None yet.
- **Public API surface**: `/api/health`.
- **Data ownership**: Process environment and server-generated health metadata.

### command-gateway

- **Responsibility**: Authenticate callers, match commands against policy rules, manage approval flow, execute approved commands, and log all activity.
- **Bounded context**: API key validation, command-rules matching, risk analysis, SQLite approval/audit storage, Telegram bot integration, optional admin approval UI, child process execution.
- **Published events**: None (approval decisions stored in SQLite, audit log appended).
- **Consumed events**: Telegram callback queries and admin UI approval decisions.
- **Public API surface**: `POST /api/v1/execute`, `GET /api/v1/status/:requestId`, and when enabled `GET /admin/approvals`, `GET /api/v1/admin/approvals/pending`, `POST /api/v1/admin/approvals/stream-ticket`, `GET /api/v1/admin/approvals/stream`, `POST /api/v1/admin/approvals/:requestId/decide`.
- **Data ownership**: SQLite database in the configured `dataDir` for approvals and audit log; in-memory pending request store; operator-owned JSON config files (`lucifer.json`, `api-keys.json`, `command-rules.json`).
- **Key interfaces**: `ApprovalChannel` abstracts Telegram, web admin, multi-channel fan-out, and auto-approve development mode.

## Integration Contracts

| Source Domain | Target Domain | Mechanism | Contract Location |
|---|---|---|---|
| External caller | `command-gateway` | HTTP POST `/api/v1/execute` | Request: `{ command, cwd? }` + `x-api-key` header; Response: `ExecutionResult` |
| External caller | `command-gateway` | HTTP GET `/api/v1/status/:requestId` | Response: `{ requestId, status, stdout?, stderr?, exitCode? }` |
| Admin operator | `command-gateway` | Bearer-authenticated HTTP + SSE | Admin approval routes in `server/src/domains/command-gateway/api/register_approval_routes.ts` |
| `command-gateway` | Telegram Bot API | HTTPS (telegraf) | Inline keyboard messages + callback queries |
| `command-gateway` | SQLite | `better-sqlite3` | `<dataDir>/lucifer.db` (approvals + audit log tables) |
| `command-gateway` | JSON config | filesystem reads | `lucifer.json`, `api-keys.json`, `command-rules.json` |

## Rules for Modifying Boundaries

1. **Adding a new domain**: Use the `add-domain` skill and update this file.
2. **Splitting a domain**: Create an ADR first and preserve the current contract during migration.
3. **Merging domains**: Requires doc updates here, in `ARCHITECTURE.md`, and in ADRs.
4. **Adding a cross-domain dependency**: Route it through an explicit API contract, or introduce a new shared seam with an ADR first.

# Transparent Proxy Access Journeys

## J11: Open Transparent Proxy

> **Actor**: AI Agent
> **Goal**: Reach an upstream AI API through a local Lucifer proxy port with no per-caller authentication (today's default behavior).

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J11-S1 | As an AI Agent, I send any request to a proxy port with `authMode: 'none'` so that it is forwarded to the upstream unchanged | Request path, method, query, and body are preserved; configured `headers` are injected on the outgoing request; no authentication check is performed | `covered` — `proxy_server.test.ts` (existing forwarding / header / multi-listener tests) |

## J12: Token-Gated Transparent Proxy

> **Actor**: AI Agent
> **Goal**: Authenticate to the proxy using the upstream SDK's native auth header (Anthropic `x-api-key`, OpenAI/Cohere `Authorization: Bearer`, Azure `api-key`, …) so that client SDKs work unmodified.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J12-S1 | As an Operator, I set `authMode: 'api-key'` on a proxy mapping so that requests without a valid lucifer-gate token are rejected | Requests missing the configured `apiKeyHeader` return `401`; requests with an unknown or revoked token return `401`; no request reaches the upstream | `covered` — `proxy_auth.test.ts`, `proxy_server.test.ts` |
| J12-S2 | As an AI Agent, I place my lucifer-gate token in the SDK's native auth header so that the existing SDK works unchanged | `Authorization: Bearer <token>` (OpenAI), `x-api-key: <token>` (Anthropic), and `api-key: <token>` (Azure) all validate when the mapping's `apiKeyHeader` and optional `apiKeyPrefix` match | `covered` — `proxy_server.test.ts` (per-provider header shapes) |
| J12-S3 | As the system, I strip the caller's auth header before forwarding so that the lucifer-gate token never reaches the upstream | On successful validation, the configured `apiKeyHeader` is deleted from the outgoing request; the upstream receives only the credentials injected via `mapping.headers` | `covered` — `proxy_server.test.ts` (header-strip assertion) |
| J12-S4 | As the system, I reject requests where the configured header is malformed (wrong prefix, empty value) | Missing `apiKeyPrefix` when one is configured → `401`; empty token value → `401` | `covered` — `proxy_auth.test.ts` |

## J13: Telegram-Approved Transparent Proxy

> **Actor**: AI Agent + Approver
> **Goal**: Require human approval via Telegram for proxy traffic, with per-session caching so approval is not asked for every request.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J13-S1 | As an Operator, I set `authMode: 'api-key-telegram'` so that every validated request also requires Telegram approval | With no cached approval, the proxy calls the Telegram approval channel before forwarding; on denied it returns `403`; on approved it forwards | `covered` — `proxy_auth.test.ts`, `proxy_server.test.ts` |
| J13-S2 | As the system, I cache approved decisions per `(api-key-id, port)` for a configurable TTL so agents are not re-prompted for every request | A second request within `telegramApprovalTtlSeconds` reuses the prior approval without calling the approval channel; after TTL expiry, approval is requested again | `covered` — `proxy_approval_cache.test.ts`, `proxy_auth.test.ts` |
| J13-S3 | As the system, I fail closed when the approval channel times out or errors | Approval timeout returns `408`; approval-channel errors return `503`; neither response is cached | `covered` — `proxy_auth.test.ts` |
| J13-S4 | As an Operator, I see proxy auth and approval decisions in `lucifer-gate log` so proxy activity is auditable alongside command activity | Auth accept / deny, approval requested / approved / denied / timeout events are written to the same `audit_log` SQLite table used by the command gateway, with `type` prefixed `proxy_` | `covered` — `create_app.test.ts` (audit bridge), `proxy_auth.test.ts` |
| J13-S5 | As an Operator, I get a startup error if I configure `api-key-telegram` without an approval channel | If `authMode: 'api-key-telegram'` is used but no Telegram/web approval channel is wired, server startup fails fast with a descriptive error | `covered` — `create_app.test.ts` |

## Section Summary

| Status | Count |
|---|---|
| `covered` | 10 |
| `partial` | 0 |
| `uncovered` | 0 |

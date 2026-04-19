# Transparent Proxy

## What it does

Runs one or more HTTP listeners alongside the main gateway. Each listener
forwards every incoming request to a configured base URL, preserving path,
method, query string, and body, and injecting a configured set of headers
on the outgoing request.

Primary use case: put an AI-agent upstream (e.g. the OpenAI API) behind a
local port so callers never need to know the upstream URL or hold the
credential directly.

Each listener can optionally require per-request authentication using an
existing lucifer-gate API key, and can additionally require human approval
via the same Telegram channel used for command execution. See
[Authentication modes](#authentication-modes) below.

## Config file

`proxy-config.json` (same directory as `lucifer.json`):

```json
{
  "proxies": [
    {
      "port": 6060,
      "baseUrl": "https://api.openai.com",
      "headers": { "Authorization": "Bearer sk-..." }
    }
  ]
}
```

Field rules:

- `port` — integer, 1–65535. Must not collide with the main gateway port
  or with any other proxy port. Collisions fail fast at startup.
- `baseUrl` — absolute URL with `http:` or `https:` scheme. Validated with
  `new URL()` at load time.
- `headers` — optional map of string → string. Injected on every outgoing
  request. **Overwrites** any caller-supplied header of the same name (the
  primary use is credential injection, which must not be overridable by the
  caller).
- `host` — optional bind address. Defaults to `127.0.0.1` (loopback only)
  so a credentialed proxy is not accidentally exposed to the local
  network. Set explicitly (e.g. `"0.0.0.0"`) to opt into broader binding;
  the operator accepts responsibility for fronting the listener with its
  own access control when doing so.
- `authMode` — optional, one of `"none"` (default), `"api-key"`, or
  `"api-key-telegram"`. See [Authentication modes](#authentication-modes).
- `apiKeyHeader` — required when `authMode` is not `"none"`. The name of
  the request header the caller places the lucifer-gate token in.
  Case-insensitive.
- `apiKeyPrefix` — optional. When present, the caller's header value must
  start with this prefix and it is stripped before token validation
  (e.g. `"Bearer "` for OpenAI-style `Authorization: Bearer …`).
- `telegramApprovalTtlSeconds` — optional, default `3600`. Only used in
  `"api-key-telegram"` mode. Lifetime (in seconds) of an approved decision
  in the in-memory cache, keyed by `(api-key-id, port)`. Set to `0` to
  disable caching and require approval for every request.

File semantics:

- File missing → proxy feature disabled (legacy deployments unchanged).
- File present with `proxies: []` → loaded, no listeners started.
- File present with any invalid entry → server fails to start.

## Authentication modes

The `authMode` field on each mapping controls how requests reaching the
listener are authenticated. The lucifer-gate token is placed in the
**upstream SDK's native auth header** so client SDKs work without
modification (Anthropic `x-api-key`, OpenAI/Cohere `Authorization: Bearer
…`, Azure `api-key`, etc.).

### `"none"` (default, back-compat)

Pass-through. Requests are forwarded unchanged — today's behavior.

### `"api-key"`

On every request the listener:

1. Reads the header named by `apiKeyHeader` (case-insensitive).
2. If `apiKeyPrefix` is configured, requires the value to start with that
   prefix and strips it.
3. Validates the resulting token against `api-keys.json` — the same store
   that gates `/api/v1/execute`.
4. If missing or invalid → `401 {"error": "unauthorized"}`.
5. On success, **deletes** the caller's header from the outgoing request
   so the lucifer-gate token never reaches the upstream. The upstream
   receives only the credentials injected via `headers`.

Example `proxy-config.json` entries per provider:

```json
{
  "proxies": [
    {
      "port": 6060,
      "baseUrl": "https://api.openai.com",
      "authMode": "api-key",
      "apiKeyHeader": "authorization",
      "apiKeyPrefix": "Bearer ",
      "headers": { "Authorization": "Bearer sk-openai-REAL" }
    },
    {
      "port": 6061,
      "baseUrl": "https://api.anthropic.com",
      "authMode": "api-key",
      "apiKeyHeader": "x-api-key",
      "headers": { "x-api-key": "sk-ant-REAL" }
    },
    {
      "port": 6062,
      "baseUrl": "https://myresource.openai.azure.com",
      "authMode": "api-key",
      "apiKeyHeader": "api-key",
      "headers": { "api-key": "azure-REAL" }
    }
  ]
}
```

### `"api-key-telegram"`

Everything `"api-key"` does, plus a Telegram approval gate. On a cache
miss for `(api-key-id, port)`:

1. The listener asks the configured Telegram approval channel (same one
   used for command execution) to approve a descriptor like
   `HTTP proxy POST /v1/chat/completions (port 6060) by <keyName>`.
2. If the approver presses *Approve*, the request is forwarded and the
   decision is cached for `telegramApprovalTtlSeconds`.
3. If the approver presses *Deny* → `403 {"error": "forbidden"}`.
4. If no response arrives within `approvalTimeoutSeconds` (from
   `lucifer.json`) → `408 {"error": "approval_timeout"}`.
5. If the channel itself errors → `503 {"error": "approval_error"}`.

Neither denial nor timeout is cached; the next request asks again.

## Request forwarding

- Path and query string are forwarded unchanged:
  `http://localhost:6060/v1/chat/completions?x=1` →
  `https://api.openai.com/v1/chat/completions?x=1`.
- The upstream `Host` header is rewritten to the target's host
  (`changeOrigin: true`), which is required by most TLS-terminating
  upstreams.
- Streaming responses pass through (the underlying `http-proxy` library
  supports streaming by default), so SSE-style endpoints like
  `/v1/chat/completions` with `stream: true` work as expected.
- Upstream connection errors surface as HTTP `502` with body
  `{ "error": "bad_gateway", "message": "Upstream request failed" }`.

## Lifecycle

Proxy listeners are created when the main server starts and closed when
the server stops. They are independent of command-gateway lifecycle — the
feature can be enabled even if no command-gateway config files are
present, provided every mapping uses `authMode: "none"`. Using
`"api-key"` or `"api-key-telegram"` requires the gateway to be
initialised so `api-keys.json` and the approval channel are available.

Startup is all-or-nothing:

- If any listener fails to bind, all already-started listeners are closed
  before the startup error is rethrown. The caller never observes a
  half-started set.
- If a mapping uses an auth mode but the corresponding dependency is
  missing (no `api-keys.json`, or no approval channel configured),
  startup fails fast with a descriptive error.
- Likewise, if the proxy layer fails to come up after the approval
  channel, `createApp().start()` rolls back the approval channel before
  rethrowing.

Shutdown is best-effort: a listener that never bound (e.g. because
startup failed partway) does not prevent cleanup of the others.

## Auditing

When the gateway is initialised, proxy auth and approval decisions are
written to the same SQLite `audit_log` table used by command execution.
`lucifer-gate log` surfaces them alongside command entries. Event types:

- `proxy_auth_ok` — request passed `"api-key"` validation
- `proxy_auth_denied` — missing, malformed, or invalid token
- `proxy_approval_requested` — sent to Telegram
- `proxy_approval_approved` — approved (with `approvedBy` set to
  `"telegram"` on a fresh approval or `"cache"` on a cache hit)
- `proxy_approval_denied` — Telegram denial
- `proxy_approval_timeout` — no response within the configured window
- `proxy_approval_error` — the approval channel itself failed

## What it does NOT do (yet)

- Per-path routing within a single mapping.
- Rate limiting on proxy ports.
- TLS termination on proxy listeners (run TLS in an upstream reverse
  proxy).
- Rewriting response bodies or streaming policy enforcement.
- Persisting `"api-key-telegram"` approvals across restarts (approvals
  are cached in-memory only).

# Transparent Proxy

## What it does

Runs one or more HTTP listeners alongside the main gateway. Each listener
forwards every incoming request to a configured base URL, preserving path,
method, query string, and body, and injecting a configured set of headers
on the outgoing request.

Primary use case: put an AI-agent upstream (e.g. the OpenAI API) behind a
local port so callers never need to know the upstream URL or hold the
credential directly.

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

File semantics:

- File missing → proxy feature disabled (legacy deployments unchanged).
- File present with `proxies: []` → loaded, no listeners started.
- File present with any invalid entry → server fails to start.

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
present.

## What it does NOT do (yet)

- Per-path routing within a single mapping.
- Rate limiting on proxy ports.
- TLS termination on proxy listeners (run TLS in an upstream reverse
  proxy).
- Rewriting response bodies or streaming policy enforcement.

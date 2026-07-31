# Command Execution

## Purpose

Accept authenticated command requests, apply policy, obtain approval when
needed, execute the command, and return the result.

## Entry Points

- `POST /api/v1/execute`

## Inputs

- Header: `x-api-key`
- Body: `{ command: string, cwd?: string }`

## Core Behavior

- Rejects missing or invalid API keys.
- Applies per-key IP allowlists when configured.
- Rate-limits callers.
- Validates `command` and optional absolute `cwd`.
- Matches the command against the first prefix rule in `command-rules.json`.
- `always_deny` returns `403`.
- `always_approve` executes immediately.
- `manual_approve` checks cached approvals first, then requests approval and
  blocks the HTTP response until the approver decides or the approval times
  out.

## Result States

- `completed`
- `failed`
- `denied`
- `timed_out`

## API contract

### Request

```bash
curl -X POST http://localhost:3001/api/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: luc_yourkey" \
  -d '{"command":"git status"}'
```

### Success response

```json
{
  "requestId": "uuid",
  "status": "completed",
  "exitCode": 0,
  "stdout": "...",
  "stderr": "",
  "durationMs": 42
}
```

Status values observed on success and failure paths: `completed`, `failed`,
`denied`, `timed_out`.

### Error responses

All errors return:

```json
{ "code": "ERROR_CODE", "message": "Human readable", "retryable": true }
```

| Code | Meaning |
|---|---|
| `MISSING_API_KEY` | No `x-api-key` header supplied. |
| `INVALID_API_KEY` | Header supplied but the key is unknown or disabled. |
| `IP_NOT_ALLOWED` | Caller IP is outside the per-key allowlist. |
| `RATE_LIMITED` | Caller exceeded its rate budget. |
| `COMMAND_DENIED` | Policy matched `always_deny` or the default-deny rule. |
| `COMMAND_TOO_LONG` | Command body exceeds the configured max length. |
| `INVALID_CWD` | `cwd` is not an absolute path, or is otherwise rejected. |
| `DENIED` | Human approver denied the command (via Telegram or web admin). |
| `DUPLICATE_IN_FLIGHT` | An identical command from this API key is already awaiting approval. Retry once it settles. |
| `APPROVAL_TIMEOUT` | No human decision before `approvalTimeoutSeconds` elapsed. |
| `APPROVAL_ERROR` | The approval channel itself failed (bot offline, upstream error, etc.). |

## Aliases

`lucifer.json` may include an `aliases` map that points a name at a script
or executable on disk. When the incoming command matches an alias name
exactly, Lucifer runs the referenced file directly (no shell) with the
script's parent directory as the working directory.

```json
{
  "aliases": {
    "deploy":  { "path": "/opt/ops/deploy.sh",   "type": "bash" },
    "healthz": { "path": "/opt/ops/bin/healthz", "type": "elf" },
    "unread-summary": { "path": "/opt/ops/bin/smtp", "type": "elf", "args": ["summary", "--unread"] }
  }
}
```

### `type` values

- `bash` — launched via `bash -- <path> [args...]`. The `--` prevents a path
  that happens to start with `-` from being interpreted as a bash option.
- `elf` — launched directly with `[args...]` (must be executable and on a
  filesystem without `noexec`).

### `args` (fixed, operator-configured only)

Optional array of strings appended to the spawned argv, in order. `args` is
set once by the operator in `lucifer.json` — it is never derived from the
caller's `command` string. This is how you give an executable a fixed,
baked-in invocation (e.g. "always run `smtp summary`") without allowing the
caller to control what arguments are passed.

### `allowArgs` (caller-supplied arguments, opt-in)

Optional boolean, default `false`. When `true`, a caller may invoke the
alias as `<name> <args>` — e.g. `{"command":"unread-summary --unread
--limit 10"}` — and the text after the alias name is whitespace-tokenized
and appended after any fixed `args`. Resolution to ADR-009's deferred
"first-token match with argument passthrough" alternative (see
[docs/context/DECISIONS.md](../context/DECISIONS.md), ADR-012).

Still spawned with `shell: false`, so caller-supplied tokens are inert argv
elements passed directly to the executable — they are never interpreted by
a shell, regardless of content (`;`, `|`, backticks, etc. have no special
meaning in an argv element). Tokenization is naive whitespace-splitting: no
quoted-string support in v1, so `--subject "hello world"` becomes three
tokens (`--subject`, `hello`, `world`), not two. `command-rules.json`
continues to prefix-match the full raw command string, so a `manual_approve`
rule on the alias name gates every invocation, arguments included, and the
approver sees the exact arguments before approving.

When `allowArgs` is `false` (the default), free-form caller-supplied
arguments are rejected outright with `ALIAS_ARGS_NOT_SUPPORTED` — unchanged
from the original ADR-009 behavior.

### Path resolution

Relative `path` values are resolved against the **config file's directory**,
not the daemon's working directory. So `"./scripts/deploy.sh"` in
`config/lucifer.json` always means `config/scripts/deploy.sh` regardless of
where the server was started from. Absolute paths are used as-is.

### Interaction with command rules

Command rules in `command-rules.json` still apply to the alias name as sent
by the caller — e.g. `{ "prefix": "deploy", "action": "manual_approve" }`
gates the `deploy` alias through human approval.

### Match semantics

Exact-string match only. An alias `deploy` does not match `deploy --dry-run`;
the latter falls through to the normal shell path.

### Caller-supplied `cwd`

Callers supplying a `cwd` have it ignored for alias invocations — the
working directory is always the alias script's parent directory.

## Tools path

`lucifer.json` may include a `toolsPath` array of directories:

```json
{
  "toolsPath": ["/opt/agent-tools", "./bin"]
}
```

Every executed command's child process gets these directories prepended to
its `PATH` environment variable, in the given order, ahead of the daemon's
own `PATH`. This is for **raw (non-alias) commands** — it lets an operator
run `mytool --flag` via `command-rules.json` without spelling out
`/opt/agent-tools/mytool --flag` in every rule and every request. It has no
effect on alias execution, which already spawns an absolute `path` directly
and never consults `PATH`.

Relative entries are resolved against the config file's directory, same as
alias `path` values. `toolsPath` is purely additive to the search path — it
does not change command-rule matching, approval flow, or the shell-free
execution guarantee for aliases.

## Notes

- The endpoint is synchronous. There is no async / `?sync=true` /
  `/status/:requestId` surface — the caller always receives the terminal
  result (or a terminal error) on the original request.
- If an identical command from the same API key is already awaiting approval,
  the duplicate request is rejected with `409 DUPLICATE_IN_FLIGHT`; the caller
  should retry once the first request settles.

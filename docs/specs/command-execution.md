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
    "healthz": { "path": "/opt/ops/bin/healthz", "type": "elf" }
  }
}
```

### `type` values

- `bash` — launched via `bash -- <path>`. The `--` prevents a path that
  happens to start with `-` from being interpreted as a bash option.
- `elf` — launched directly (must be executable and on a filesystem without
  `noexec`).

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

## Notes

- The endpoint is synchronous. There is no async / `?sync=true` /
  `/status/:requestId` surface — the caller always receives the terminal
  result (or a terminal error) on the original request.
- If an identical command from the same API key is already awaiting approval,
  the duplicate request is rejected with `409 DUPLICATE_IN_FLIGHT`; the caller
  should retry once the first request settles.

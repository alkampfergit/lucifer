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

## Notes

- The endpoint is synchronous. There is no async / `?sync=true` /
  `/status/:requestId` surface — the caller always receives the terminal
  result (or a terminal error) on the original request.
- If an identical command from the same API key is already awaiting approval,
  the duplicate request is rejected with `409 DUPLICATE_IN_FLIGHT`; the caller
  should retry once the first request settles.

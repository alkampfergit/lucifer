# Command Execution

## Purpose

Accept authenticated command requests, apply policy, obtain approval when
needed, execute the command, and return or expose the result.

## Entry Points

- `POST /api/v1/execute`
- `GET /api/v1/status/:requestId`

## Inputs

- Header: `x-api-key`
- Body: `{ command: string, cwd?: string }`
- Query: `sync=true` for blocking approval/execution flow

## Core Behavior

- Rejects missing or invalid API keys.
- Applies per-key IP allowlists when configured.
- Rate-limits callers.
- Validates `command` and optional absolute `cwd`.
- Matches the command against the first prefix rule in `command-rules.json`.
- `always_deny` returns `403`.
- `always_approve` executes immediately.
- `manual_approve` checks cached approvals first, then requests approval.

## Result States

- `pending_approval`
- `denied`
- `executing`
- `completed`
- `failed`
- `timed_out`

## Notes

- Async mode is the default.
- Sync mode waits for approval and execution unless an identical request is
  already pending.
- Completed async results are cached in memory for a short time.

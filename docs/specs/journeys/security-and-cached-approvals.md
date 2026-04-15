# Security & Cached Approval Journeys

## J6: Security & Access Control

> **Actor**: AI Agent (malicious or misconfigured)
> **Goal**: The system rejects unauthorized or dangerous requests.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J6-S1 | As the system, I reject requests with missing or invalid API keys | `POST /api/v1/execute` without a valid `x-api-key` returns `401` | `covered` — `authenticate_request.test.ts`, `register_execute_routes.test.ts` |
| J6-S2 | As the system, I enforce IP allowlists when configured on an API key | Requests from non-allowed IPs are rejected even with a valid key | `covered` — `authenticate_request.test.ts` |
| J6-S3 | As the system, I rate-limit callers to prevent abuse | Excessive requests within the rate window are rejected with `429` | `covered` — `register_execute_routes.test.ts` |
| J6-S4 | As the system, I apply `always_deny` rules so that blocked commands never execute | Commands matching an `always_deny` rule return `403` immediately | `covered` — `match_command_rule.test.ts`, `register_execute_routes.test.ts` |
| J6-S5 | As the system, I analyze command risk so that dangerous commands are flagged | Risk analysis detects destructive patterns (force push, rm -rf, etc.) and includes warnings in the approval message | `covered` — `analyze_command_risk.test.ts`, `telegram-e2e.test.ts` |

## J7: Cached Approvals

> **Actor**: AI Agent (repeat commands)
> **Goal**: Previously approved commands skip the approval flow.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J7-S1 | As the system, I check cached approvals before prompting a human | If a stored approval (exact or prefix) covers the command and has not expired, execution proceeds without human intervention | `covered` — `approval_store.test.ts`, `telegram-e2e.test.ts` |
| J7-S2 | As the system, I expire time-limited approvals so that stale permissions do not persist | Approvals with 2h or 8h durations are no longer matched after expiry | `covered` — `approval_store.test.ts` |

## Section Summary

| Status | Count |
|---|---|
| `covered` | 7 |
| `partial` | 0 |
| `uncovered` | 0 |

# User Journeys & User Stories

> Every feature exists to serve a user journey.
> Every user journey decomposes into testable user stories.
> Every user story must have at least one automated test that proves it works.
>
> If a story has no test, the feature is not shipped — it is a hypothesis.

## How to Read This Document

- **Journey**: A named, end-to-end path a real actor takes through the system.
- **Story**: A discrete, testable behavior within a journey.
- **Coverage tag**: Links each story to the test file(s) that verify it.
  - `covered` — at least one automated test exists.
  - `partial` — test exists but does not cover all acceptance criteria.
  - `uncovered` — no automated test exists yet. **This is a debt item.**

When adding a feature, add the journey and stories here *first*.
The stories define what "done" means. Tests prove it.

---

## Actors

| Actor | Description |
|---|---|
| **Operator** | The human who installs, configures, and runs Lucifer Gate |
| **AI Agent** | An external AI tool (Claude Code, Codex, etc.) that submits shell commands via the API |
| **Approver** | The human who reviews and approves/denies commands via Telegram or web admin |
| **Platform** | Automated systems (CI, health checks, monitoring) that interact with Lucifer |

---

## J1: First-Time Setup

> **Actor**: Operator
> **Goal**: Go from zero to a running Lucifer Gate instance with at least one approval channel configured.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J1-S1 | As an Operator, I run `--init` so that a working config directory is scaffolded with default files | `config/lucifer.json`, `api-keys.json`, and `command-rules.json` are created; a new API key is printed to stdout; the CLI exits cleanly without needing CTRL+C | `covered` — `cli.test.ts` |
| J1-S2 | As an Operator, I pair a Telegram chat so that approval messages reach my device | Running `pair --config <path>` with a valid bot token lists recent chats, sends a verification code, and writes the chat ID into `lucifer.json` | `covered` — `telegram_pairing.test.ts` |
| J1-S3 | As an Operator, I start the server so that the API is available for agents | `lucifer-gate start --config <path>` boots Express, loads config, enables configured approval channels, and responds to `/api/health`. `lucifer-gate --config <path>` with no subcommand behaves identically (backwards-compatible implicit form) | `covered` — `create_app.test.ts`, `create_health_report.test.ts`, `cli.test.ts` |
| J1-S4 | As an Operator, I complete the full onboarding journey (init, configure Telegram, start, submit, approve, verify) end-to-end | The entire chain from `--init` through a Telegram-approved command execution completes successfully | `covered` — `telegram-e2e.test.ts` ("first onboarding journey") |
| J1-S5 | As an Operator, I run `pair` before any chat has messaged the bot so that I can complete pairing without restarting the command | If no chats exist, the flow prints guidance and polls until a chat appears (CTRL+C to cancel) instead of crashing with a stack trace | `covered` — `telegram_pairing.test.ts` ("waits for chats when waitForChats is true") |
| J1-S6 | As an Operator, I run one-shot commands (`--help`, `--init`, `pair`, `log`, `stats`) so that they exit on their own without CTRL+C | Each non-server subcommand returns process exit code 0 as soon as it finishes; only `start` keeps the event loop alive | `covered` — `cli.test.ts` ("exits cleanly") |

---

## J2: Command Execution (Happy Path)

> **Actor**: AI Agent
> **Goal**: Submit a shell command and receive the execution result.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J2-S1 | As an AI Agent, I submit a command with a valid API key so that it enters the execution pipeline | `POST /api/v1/execute` with valid `x-api-key` is accepted and its terminal result is returned in the same response | `covered` — `register_execute_routes.test.ts` |
| J2-S2 | As an AI Agent, I submit an `always_approve` command so that it executes immediately without human approval | Command matching an `always_approve` rule executes and returns the result without prompting any approval channel | `covered` — `match_command_rule.test.ts`, `register_execute_routes.test.ts` |
| J2-S3 | As an AI Agent, I get the full execution result in a single request/response | `POST /api/v1/execute` blocks until the command completes, is denied, or approval times out, then returns the full result | `covered` — `telegram-e2e.test.ts`, `register_execute_routes.test.ts` |
| J2-S4 | As an AI Agent, I retry politely when a duplicate command is already awaiting approval | A duplicate in-flight command from the same API key is rejected with `409 DUPLICATE_IN_FLIGHT` and marked retryable | `covered` — `register_execute_routes.test.ts` |
| J2-S5 | As an AI Agent, I submit a command with an optional `cwd` so that execution happens in a specific directory | Absolute `cwd` is validated and passed to the child process | `covered` — `execute_command.test.ts` |

---

## J3: Human Approval via Telegram

> **Actor**: Approver
> **Goal**: Review command requests on Telegram and approve or deny them.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J3-S1 | As an Approver, I receive a Telegram message with the command details and inline approval buttons | Bot sends a message containing the command text, risk info, and 7 buttons (1 once + 3 exact + 2 prefix + 1 deny) | `covered` — `telegram-e2e.test.ts`, `request_telegram_approval.test.ts` |
| J3-S2 | As an Approver, I press an exact-approval button so that only this specific command is approved | Exact approval stores the full command string; the command executes and completes | `covered` — `telegram-e2e.test.ts` |
| J3-S3 | As an Approver, I press a prefix-approval button so that similar commands are also approved | Prefix approval stores the first two tokens; subsequent commands with the same prefix auto-approve from cache | `covered` — `telegram-e2e.test.ts` |
| J3-S4 | As an Approver, I press the deny button so that the command is rejected | The AI Agent's blocked POST resolves with `403` / `status: denied` | `covered` — `telegram-e2e.test.ts` |
| J3-S5 | As an Approver, I press a permanent-approval button so that this command never asks again | Permanent exact approval is stored; same command auto-approves indefinitely | `covered` — `telegram-e2e.test.ts` |

| J3-S6 | As an Approver, I press the "Approve Once" button so that this specific request executes but no cached approval is stored | The command executes successfully; repeating the same command requires a new approval | `covered` — `telegram-e2e.test.ts` ("deny and approve-once journey") |

---

## J4: Human Approval via Web Admin

> **Actor**: Approver (browser)
> **Goal**: Review and approve/deny commands through the web admin interface.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J4-S1 | As an Approver, I open `/admin/approvals` and see pending requests streamed via SSE | Page loads, authenticates via admin secret, and displays pending command requests in real time | `covered` — `register_approval_routes.test.ts` (SSE real-time events: new_request + request_decided) |
| J4-S2 | As an Approver, I approve a command via the web admin so that it executes | Admin POST to approve endpoint transitions the request to executing → completed | `covered` — `web_approval_channel.test.ts` |
| J4-S3 | As an Approver, I deny a command via the web admin so that it is rejected | Admin POST to deny endpoint transitions the request to denied | `covered` — `web_approval_channel.test.ts` |

---

## J5: Multi-Channel Approval

> **Actor**: Approver (Telegram + web admin simultaneously)
> **Goal**: When both channels are active, the first decision wins.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J5-S1 | As the system, when both Telegram and web admin are enabled, the first approval/denial resolves the request | Multi-channel wrapper races both channels; first decision wins; losing channel is cancelled | `covered` — `multi_approval_channel.test.ts` |

---

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

---

## J7: Cached Approvals

> **Actor**: AI Agent (repeat commands)
> **Goal**: Previously approved commands skip the approval flow.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J7-S1 | As the system, I check cached approvals before prompting a human | If a stored approval (exact or prefix) covers the command and has not expired, execution proceeds without human intervention | `covered` — `approval_store.test.ts`, `telegram-e2e.test.ts` |
| J7-S2 | As the system, I expire time-limited approvals so that stale permissions do not persist | Approvals with 2h or 8h durations are no longer matched after expiry | `covered` — `approval_store.test.ts` |

---

## J8: Operator Observability

> **Actor**: Operator
> **Goal**: Understand what happened on the system after the fact.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J8-S1 | As an Operator, I run `lucifer-gate log` so that I see recent command activity | CLI reads the SQLite audit log and prints recent entries | `covered` — `cli.test.ts` ("Log and stats journey") |
| J8-S2 | As an Operator, I run `lucifer-gate stats` so that I see aggregate usage metrics | CLI reads the SQLite store and prints summary statistics | `covered` — `cli.test.ts` ("Log and stats journey") |
| J8-S3 | As an Operator, I check `/api/health` so that I verify the server is running | Health endpoint returns environment, name, node version, status, timestamp | `covered` — `create_health_report.test.ts`, `create_app.test.ts` |

---

## J9: Auto-Approve (Development Mode)

> **Actor**: Operator (local development)
> **Goal**: Skip human approval entirely for local testing.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J9-S1 | As an Operator, I start with `--auto-approve` so that all commands execute without human approval | Auto-approve channel resolves immediately for every request | `covered` — `auto_approve_channel.test.ts` |

---

## J10: Configuration Management

> **Actor**: Operator
> **Goal**: Manage API keys and command rules through JSON config files.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J10-S1 | As an Operator, I edit `api-keys.json` to add or revoke API keys | Server loads API keys from JSON; keys not in the file are rejected | `covered` — `api_key_store.test.ts`, `gateway_config.test.ts` |
| J10-S2 | As an Operator, I edit `command-rules.json` to control which commands need approval | Rules are matched in order by prefix; first match determines the action | `covered` — `match_command_rule.test.ts`, `gateway_config.test.ts` |
| J10-S3 | As an Operator, I configure `lucifer.json` with server and channel settings | Main config file is loaded and validated at startup | `covered` — `gateway_config.test.ts` |

---

## Coverage Summary

| Status | Count | Percentage |
|---|---|---|
| `covered` | 33 | 100% |
| `partial` | 0 | 0% |
| `uncovered` | 0 | 0% |
| **Total** | **33** | |

### Debt Items

No outstanding debt items.

---

## Rules

- Every new feature must add its stories to this document *before* implementation begins.
- Stories define "done" — implementation is complete only when all acceptance criteria have passing tests.
- The coverage summary must be updated in the same PR that changes test coverage.
- `uncovered` stories are tracked as debt items at the bottom of this document.
- Run the `verify-user-stories` skill to audit coverage programmatically.

# Command Execution & Approval Journeys

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

## J4: Human Approval via Web Admin

> **Actor**: Approver (browser)
> **Goal**: Review and approve/deny commands through the web admin interface.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J4-S1 | As an Approver, I open `/admin/approvals` and see pending requests streamed via SSE | Page loads, authenticates with the admin secret (or an existing session cookie, see J4-S7), and displays pending command requests in real time | `covered` — `register_approval_routes.test.ts` (SSE real-time events: new_request + request_decided), `approval_page_dom.test.ts` |
| J4-S2 | As an Approver, I approve a command via the web admin so that it executes | Admin POST to approve endpoint transitions the request to executing → completed | `covered` — `web_approval_channel.test.ts` |
| J4-S3 | As an Approver, I deny a command via the web admin so that it is rejected | Admin POST to deny endpoint transitions the request to denied | `covered` — `web_approval_channel.test.ts` |
| J4-S4 | As an Approver, I reopen the web admin and see recent command calls so that completed requests are not lost from view | After authentication, the page lists the 20 most recent authenticated command submissions from the persistent audit log, newest first | `covered` — `audit_log.test.ts`, `register_approval_routes.test.ts`, `approval_page_asset.test.ts` |
| J4-S5 | As an Approver, I use the admin page menu to navigate available browser pages | The menu lists server-delivered browser pages only, marks the current approvals page as active, and can accommodate future pages without exposing API or SSE endpoints | `covered` — `approval_page_asset.test.ts` |
| J4-S6 | As an Approver, I see recent calls update without reopening the admin page | The history refreshes once per minute and when an approval request is received or decided through the web admin | `covered` — `approval_page_asset.test.ts`, `register_approval_routes.test.ts` |
| J4-S7 | As an Approver, I tick "Remember me on this device" so that reloading the admin page does not ask for the admin secret again | `POST /api/v1/admin/approvals/session` exchanges the secret for a sealed `HttpOnly` cookie valid 30 days (absolute, never extended) plus a readable CSRF companion; the page then authenticates by cookie, sends `X-Lucifer-CSRF` on every write, and stops holding the secret | `covered` — `register_approval_routes.session.test.ts`, `admin_session.test.ts`, `approval_page_dom.test.ts` |
| J4-S8 | As an Approver, I sign out so that this device stops being remembered | `DELETE /api/v1/admin/approvals/session` expires both cookies and the page returns to the login form | `covered` — `register_approval_routes.session.test.ts`, `approval_page_dom.test.ts` |
| J4-S9 | As an Approver, I am returned to the login form — not locked out — when my remembered session no longer works | An expired, tampered, or foreign-instance cookie yields `401` and the page falls back to the login form; a visit with no session marker sends no probe at all, so reloads never consume the five-failure lockout | `covered` — `register_approval_routes.session.test.ts`, `admin_session.test.ts`, `approval_page_dom.test.ts` |

## J5: Multi-Channel Approval

> **Actor**: Approver (Telegram + web admin simultaneously)
> **Goal**: When both channels are active, the first decision wins.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J5-S1 | As the system, when both Telegram and web admin are enabled, the first approval/denial resolves the request | Multi-channel wrapper races both channels; first decision wins; losing channel is cancelled | `covered` — `multi_approval_channel.test.ts` |

## Section Summary

| Status | Count |
|---|---|
| `covered` | 21 |
| `partial` | 0 |
| `uncovered` | 0 |

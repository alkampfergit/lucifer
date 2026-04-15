# Operations & Configuration Journeys

## J8: Operator Observability

> **Actor**: Operator
> **Goal**: Understand what happened on the system after the fact.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J8-S1 | As an Operator, I run `lucifer-gate log` so that I see recent command activity | CLI reads the SQLite audit log and prints recent entries | `covered` — `cli.test.ts` ("Log and stats journey") |
| J8-S2 | As an Operator, I run `lucifer-gate stats` so that I see aggregate usage metrics | CLI reads the SQLite store and prints summary statistics | `covered` — `cli.test.ts` ("Log and stats journey") |
| J8-S3 | As an Operator, I check `/api/health` so that I verify the server is running | Health endpoint returns environment, name, node version, status, timestamp | `covered` — `create_health_report.test.ts`, `create_app.test.ts` |

## J9: Auto-Approve (Development Mode)

> **Actor**: Operator (local development)
> **Goal**: Skip human approval entirely for local testing.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J9-S1 | As an Operator, I start with `--auto-approve` so that all commands execute without human approval | Auto-approve channel resolves immediately for every request | `covered` — `auto_approve_channel.test.ts` |

## J10: Configuration Management

> **Actor**: Operator
> **Goal**: Manage API keys and command rules through JSON config files.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J10-S1 | As an Operator, I edit `api-keys.json` to add or revoke API keys | Server loads API keys from JSON; keys not in the file are rejected | `covered` — `api_key_store.test.ts`, `gateway_config.test.ts` |
| J10-S2 | As an Operator, I edit `command-rules.json` to control which commands need approval | Rules are matched in order by prefix; first match determines the action | `covered` — `match_command_rule.test.ts`, `gateway_config.test.ts` |
| J10-S3 | As an Operator, I configure `lucifer.json` with server and channel settings | Main config file is loaded and validated at startup | `covered` — `gateway_config.test.ts` |

## Section Summary

| Status | Count |
|---|---|
| `covered` | 7 |
| `partial` | 0 |
| `uncovered` | 0 |

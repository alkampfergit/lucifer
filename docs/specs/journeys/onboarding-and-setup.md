# Onboarding & Setup Journeys

## J1: First-Time Setup

> **Actor**: Operator
> **Goal**: Go from zero to a running Lucifer Gate instance with at least one
> approval channel configured.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J1-S1 | As an Operator, I run `--init` so that a working config directory is scaffolded with default files | `config/lucifer.json`, `api-keys.json`, and `command-rules.json` are created; a new API key is printed to stdout; the CLI exits cleanly without needing CTRL+C | `covered` — `cli.test.ts` |
| J1-S2 | As an Operator, I pair a Telegram chat so that approval messages reach my device | Running `pair --config <path>` with a valid bot token lists recent chats, sends a verification code, and writes the chat ID into `lucifer.json` | `covered` — `telegram_pairing.test.ts` |
| J1-S3 | As an Operator, I start the server so that the API is available for agents | `lucifer-gate start --config <path>` boots Express, loads config, enables configured approval channels, and responds to `/api/health`. `lucifer-gate --config <path>` with no subcommand behaves identically (backwards-compatible implicit form) | `covered` — `create_app.test.ts`, `create_health_report.test.ts`, `cli.test.ts` |
| J1-S4 | As an Operator, I complete the full onboarding journey (init, configure Telegram, start, submit, approve, verify) end-to-end | The entire chain from `--init` through a Telegram-approved command execution completes successfully | `covered` — `telegram-e2e.test.ts` ("first onboarding journey") |
| J1-S5 | As an Operator, I run `pair` before any chat has messaged the bot so that I can complete pairing without restarting the command | If no chats exist, the flow prints guidance and polls until a chat appears (CTRL+C to cancel) instead of crashing with a stack trace | `covered` — `telegram_pairing.test.ts` ("waits for chats when waitForChats is true") |
| J1-S6 | As an Operator, I run one-shot commands (`--help`, `--init`, `pair`, `log`, `stats`) so that they exit on their own without CTRL+C | Each non-server subcommand returns process exit code 0 as soon as it finishes; only `start` keeps the event loop alive | `covered` — `cli.test.ts` ("exits cleanly") |

## Section Summary

| Status | Count |
|---|---|
| `covered` | 6 |
| `partial` | 0 |
| `uncovered` | 0 |

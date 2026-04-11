# Approval Channels

## Purpose

Resolve `telegram_approve` command requests through a common approval contract.

## Available Channels

### Telegram

- Enabled when `LUCIFER_TELEGRAM_TOKEN` and a chat ID are available.
- Sends inline keyboard buttons for exact or prefix approval durations.
- Stores approvals in SQLite.

### Web Admin

- Enabled when `LUCIFER_ADMIN_SECRET` is set.
- Serves `/admin/approvals`.
- Uses bearer auth for admin APIs.
- Streams pending requests over SSE.
- Stores approvals in SQLite.

### Auto-Approve

- Enabled by CLI flag `--auto-approve`.
- Intended for local development only.

### Multi-Channel

- Used when Telegram and web admin are both enabled.
- The first decision wins.
- Losing channels are cancelled for that request.

## Approval Shapes

- Match types: `exact`, `prefix`
- Durations: `2`, `8`, `permanent`

## Stored Approval Behavior

- Exact approvals match the full command string.
- Prefix approvals match the derived first two tokens of the command.
- Cached approvals are checked before prompting a human.

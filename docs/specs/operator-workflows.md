# Operator Workflows

## Init

`lucifer-gate --init [dir]`

- Creates `config/` and `data/`.
- Writes `lucifer.json`, `api-keys.json`, and `command-rules.json`.
- Prints a newly generated API key once.

## Pair Telegram Chat

`lucifer-gate pair --config <path>`

- Requires `LUCIFER_TELEGRAM_TOKEN`.
- Lists recent chats that messaged the bot.
- If no chats have messaged the bot yet, the command prints a helpful
  message and polls Telegram until at least one chat appears. CTRL+C to
  cancel.
- Sends a verification code.
- Writes the selected chat ID into `lucifer.json`.

## Start Server

`lucifer-gate start --config <path>`

- `start` is the preferred, explicit form. Running `lucifer-gate --config <path>`
  with no subcommand still starts the server for backwards compatibility.
- Loads JSON config.
- Resolves `dataDir` relative to the config file.
- Enables file logging when `logFile` is configured.
- Enables approval channels based on env vars and flags.

## One-Shot Commands Exit Cleanly

`--help`, `--init`, `pair`, `log`, and `stats` all exit as soon as their work
is finished. Only `start` (and the implicit equivalent) keeps the process
alive. CTRL+C is only needed to stop the server.

## Audit Queries

- `lucifer-gate log [--limit N]`
- `lucifer-gate stats`

These commands read the SQLite runtime store and summarize recent activity.

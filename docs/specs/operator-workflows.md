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
- Sends a verification code.
- Writes the selected chat ID into `lucifer.json`.

## Start Server

`lucifer-gate --config <path>`

- Loads JSON config.
- Resolves `dataDir` relative to the config file.
- Enables file logging when `logFile` is configured.
- Enables approval channels based on env vars and flags.

## Audit Queries

- `lucifer-gate log [--limit N]`
- `lucifer-gate stats`

These commands read the SQLite runtime store and summarize recent activity.

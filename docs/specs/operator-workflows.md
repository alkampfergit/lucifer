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

## Report The Installed Version

`lucifer-gate --version` (short form `-v`)

- Prints the bare version on stdout — no prefix, so a script can capture it
  directly, the way `node --version` and `npm --version` behave.
- Answered before any config file is read, so it works from any directory.
  A missing `config/lucifer.json` is irrelevant to the question being asked.
- The version is read from the package manifest shipped with the build, which
  CI rewrites at publish time. The value committed in `package.json` is
  therefore not what an installed build reports.

## Unknown Options Are Rejected

Server mode accepts `--config`, `--port`, and `--auto-approve` (plus `--help`
and `--version`, which are handled anywhere). Anything else exits with code 1
and `Unknown option: <option>`, mirroring the existing `Unknown command`
behaviour for positionals.

Without this, a mistyped option fell through to server startup and the
operator got a config-loading stack trace that said nothing about the option
they actually got wrong.

`--data-dir` and `--limit` belong to `log` and `stats`; they are not server
options and were never read by the server.

## One-Shot Commands Exit Cleanly

`--help`, `--version`, `--init`, `pair`, `log`, and `stats` all exit as soon
as their work is finished. Only `start` (and the implicit equivalent) keeps
the process alive. CTRL+C is only needed to stop the server.

## Audit Queries

- `lucifer-gate log [--limit N]`
- `lucifer-gate stats`

These commands read the SQLite runtime store and summarize recent activity.

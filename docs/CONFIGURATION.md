# Configuration Reference

Operator-facing reference for how Lucifer Gate is configured. Per-feature
behaviour contracts live in [`docs/specs/*`](specs/); this file focuses on
where settings live, how they are loaded, and what environment variables
affect the runtime.

## Config files

All config files live in the directory passed to `--config` (conventionally
`./config`). Paths inside them (e.g. `dataDir`, alias `path` entries) are
resolved relative to the config file's own directory unless absolute.

| File | Scope | Spec |
|---|---|---|
| `lucifer.json` | Server settings: port, timeouts, limits, `dataDir`, `logFile`, aliases, admin cookie sessions, paired Telegram chat ID | [specs/operator-workflows.md](specs/operator-workflows.md) |
| `api-keys.json` | Hashed API keys + optional per-key IP allowlists | [specs/command-execution.md](specs/command-execution.md) |
| `command-rules.json` | Command policy: `always_approve` / `always_deny` / `manual_approve` rules, matched top-to-bottom, first match wins | [specs/command-execution.md](specs/command-execution.md) |
| `proxy-config.json` | Optional transparent HTTP proxy listeners. File missing → feature disabled. | [specs/transparent-proxy.md](specs/transparent-proxy.md) |

Generate the first three with `lucifer-gate --init [dir]`. That command
also prints a freshly-generated API key once; copy it.

### `command-rules.json` shape

```json
{
  "rules": [
    { "prefix": "echo ", "action": "always_approve" },
    { "prefix": "git pull", "action": "manual_approve" },
    { "prefix": "rm ", "action": "always_deny" }
  ],
  "defaultAction": "always_deny"
}
```

See [specs/command-execution.md](specs/command-execution.md) for the full
matching contract.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `LUCIFER_TELEGRAM_TOKEN` | Yes (prod) | Telegram bot token from @BotFather. Use `skip` to disable Telegram entirely in dev. |
| `LUCIFER_TELEGRAM_CHAT_ID` | No | Telegram chat ID. Prefer the `pair` subcommand, which writes it into `lucifer.json`. Set as env to override the config value. |
| `LUCIFER_ADMIN_SECRET` | No | Bearer token for the web approval UI (`/admin/approvals`). See [specs/approval-channels.md](specs/approval-channels.md). |
| `LUCIFER_ADMIN_COOKIE_KEY` | No | 64 hex characters (32 bytes) used to seal admin session cookies. Set it to manage the key yourself; otherwise Lucifer generates and stores one. A malformed value is a startup error, not a silent fallback. |
| `PORT` | No | Server port (default `3001`). |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error`. Default `debug` in dev, `info` when `NODE_ENV=production`. |
| `NODE_ENV` | No | Set to `production` for production defaults (info log level, no pretty-printing). |

## Logging

Lucifer logs to **both console and file** by default.

- **Console** output is human-readable (colourised) when `pino-pretty` is on
  the path, and falls back to structured JSON otherwise. `pino-pretty` is a
  dev-time dependency only — `npx lucifer-gate` produces JSON console output,
  which is expected and fully functional.
- **File** output is always structured JSON (one object per line), written
  to `data/lucifer.log` by default. Each line is a complete JSON object, so
  it can be searched, filtered, and fed into log aggregators directly.

File logging is controlled from `lucifer.json`:

```json
{
  "logFile": "lucifer.log",
  ...
}
```

The `logFile` path is resolved relative to `dataDir` (default
`data/lucifer.log`). Remove the key to disable file logging. `--init`
generates the config with file logging enabled.

## Docker

```bash
docker build -t lucifer-gate .
docker run -p 3001:3001 \
  -e LUCIFER_TELEGRAM_TOKEN=your_token \
  -e LUCIFER_TELEGRAM_CHAT_ID=your_chat_id \
  -v ./config:/app/config \
  -v ./data:/app/data \
  lucifer-gate
```

Mount `./config` read-only if your orchestrator allows it — the server does
not write back to config files at runtime.

## Command aliases

Optional `aliases` map in `lucifer.json` points a name at an on-disk script
or executable. When the incoming command matches an alias name exactly,
Lucifer runs the referenced file directly (no shell) with the script's
parent directory as the working directory. An alias may also set a fixed,
operator-configured `args` array. Full contract:
[specs/command-execution.md](specs/command-execution.md#aliases).

## Extra tool search paths

Optional `toolsPath` array in `lucifer.json` lists directories prepended to
the `PATH` environment variable of every executed command (both raw shell
commands and, harmlessly, aliases, which already use an absolute path).
Use it so raw commands can resolve executables that live outside the
daemon's own `PATH` without spelling out a full path in `command-rules.json`
every time. Relative entries are resolved against the config file's
directory, same as alias `path` values. Full contract:
[specs/command-execution.md](specs/command-execution.md#tools-path).

## Admin cookie sessions

The web approval UI can remember a browser instead of asking for the admin
secret on every visit. Tick **Remember me on this device** on the login form
and the server issues a sealed, `HttpOnly` cookie valid for **30 days,
absolute** — the expiry is never extended by activity, so after 30 days the
secret is required again.

The feature is on by default. Turn it off in `lucifer.json`:

```json
{
  "adminCookieSession": { "enabled": false }
}
```

With it disabled the `/session` routes are not registered at all and admin
auth is bearer-only, exactly as before.

### Where the sealing key lives

Resolved once at startup, first hit wins:

1. `LUCIFER_ADMIN_COOKIE_KEY` (64 hex characters).
2. The OS keychain — Windows Credential Manager, macOS Keychain, or the Linux
   Secret Service — via the optional `@napi-rs/keyring` native module. It is an
   `optionalDependency`; a machine without it, or without a running Secret
   Service, simply falls through.
3. The `server_secrets` table in `lucifer.db`, created on first use.

Step 3 stores the key beside the data it protects, so `lucifer.db` becomes the
trust boundary for admin sessions. Lucifer sets the database file to mode
`0600` on open. Use step 1 or 2 when you need the key outside that boundary.

Losing or rotating the key invalidates every outstanding session; operators and
users just log in again.

Full contract: [specs/approval-channels.md](specs/approval-channels.md).

## Transparent HTTP proxy

Optional `proxy-config.json` enables one or more HTTP listeners that
forward to configured upstreams with server-side credential injection.
Full contract: [specs/transparent-proxy.md](specs/transparent-proxy.md).

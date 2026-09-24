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
| `lucifer.json` | Server settings: port, timeouts, limits, `dataDir`, `logFile`, aliases, optional `tls` block, admin cookie sessions, proxy trust, paired Telegram chat ID | [specs/operator-workflows.md](specs/operator-workflows.md) |
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
| `LUCIFER_TLS_PASSPHRASE` | No | Passphrase for a PKCS#12 bundle or an encrypted PEM key referenced by the `tls` block. Never read from `lucifer.json`. See [specs/tls.md](specs/tls.md). |
| `PORT` | No | Server port. Set by the CLI's `--port` flag, and takes precedence over `"port"` in `lucifer.json`. See [Listener port](#listener-port). |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error`. Default `debug` in dev, `info` when `NODE_ENV=production`. |
| `LOG_FORMAT` | No | Console log format: `pretty` (default) or `json`. `--log-format` takes precedence. The Docker image sets `json`. |
| `NODE_ENV` | No | Set to `production` for production defaults (info log level). It no longer affects the console format. |

## Listener port

The port the gateway binds is resolved once, in this order:

1. `--port` on the CLI, which sets `PORT`.
2. The `PORT` environment variable.
3. `"port"` in `lucifer.json`.
4. `443` when a `tls` block is configured; otherwise `3001`.

The same resolved port is what `proxy-config.json` mappings are checked
against for collisions, so a mapping can never quietly claim the port the
gateway itself is about to bind.

If the port cannot be bound — `EACCES` for a privileged port such as `443`
run without elevation, `EADDRINUSE` when another process holds it — startup
exits with code 1 and a log line naming the port and the settings above.

## Logging

Lucifer logs to **both console and file** by default.

- **Console** output is human-readable by default, one line per entry:
  `[07:49:54] INFO: (app) Command gateway initialized`, with structured fields
  indented underneath. Colour is used only when stdout is a TTY. Pass
  `--log-format json` (or set `LOG_FORMAT=json`) to get structured JSON on the
  console instead, e.g. for a log shipper. The Docker image defaults to `json`.
- **File** output is always structured JSON (one object per line), whatever
  the console format, written to `data/lucifer.log` by default. Each line is a
  complete JSON object, so it can be searched, filtered, and fed into log
  aggregators directly.

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

`--log-file <path>` on the CLI writes the JSON log to `<path>` instead,
resolved against the working directory. It replaces the `logFile` setting
rather than adding a second file.

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
   Service, simply falls through. On Linux the entry is pinned to the Secret
   Service: the library's default would otherwise fall back to the kernel
   keyring, which lives in RAM and would drop the key — and every outstanding
   session — at the next reboot.
3. The `server_secrets` table in `lucifer.db`, created on first use.

Steps 2 and 3 are scoped to one deployment: the keychain entry is named
`admin_session_key:<instance id>` under the `lucifer-gate` service, and the
database row lives in that instance's own `lucifer.db`. The instance id is a
short digest of the absolute database path, so it is stable across restarts and
upgrades and is not configurable. Without it two instances run by the same OS
account would draw the same key out of the keychain, and — because browsers do
not scope cookies by port — a session created against one admin secret would
authenticate against the other.

Step 1 is deliberately *not* scoped: naming one `LUCIFER_ADMIN_COOKIE_KEY` for
several instances is a decision, not an accident. Those instances still cannot
be signed into with each other's cookies, because the same instance id is sealed
into the assertion's `aud` claim and checked on every request.

Step 3 stores the key beside the data it protects, so `lucifer.db` becomes the
trust boundary for admin sessions. Lucifer sets the database file **and its
`-wal` / `-shm` sidecars** to mode `0600` on open — the sidecars matter because
in WAL mode every write reaches them first. Use step 1 or 2 when you need the
key outside that boundary.

**On Windows this tightening does nothing.** Windows has no POSIX mode, and
`chmod` there only toggles the read-only flag, so the database keeps whatever
ACL it inherits from `dataDir`. Lucifer treats that as best-effort rather than
a startup failure. If step 3 holds your sealing key on Windows, restrict the
data directory yourself — for example
`icacls <dataDir> /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"` — or set
`LUCIFER_ADMIN_COOKIE_KEY` (step 1) so the key never lands in the database.

Losing or rotating the key invalidates every outstanding session; operators and
users just log in again.

### Running behind a TLS-terminating proxy

Session cookies are marked `Secure` only when Express reports the request as
secure. Lucifer does **not** read `X-Forwarded-Proto` on its own: any client
could then claim TLS and be handed a `Secure` cookie its plain-HTTP browser can
never send back. If a reverse proxy you control terminates TLS in front of
Lucifer, tell Express to trust it:

```json
{
  "trustProxy": 1
}
```

`trustProxy` is passed verbatim to Express's [`trust proxy`][trust-proxy]
setting, so a hop count (`1`), a boolean, a named range (`"loopback"`), or an
explicit list of addresses/subnets all work. Leave it unset when Lucifer is
reached directly — that is the safe default, and it is what keeps forwarding
headers unspoofable.

`trustProxy` also decides which address the admin auth lockout counts against:
it is keyed on `req.ip`, which Express derives from `X-Forwarded-For` only for
peers this setting trusts. Set it when Lucifer sits behind a proxy, or every
client will share the proxy's address and one attacker's five failed guesses
will lock everybody out.

Without it behind an HTTPS proxy the cookies still work; they just lack the
`Secure` flag. `SameSite=Strict` and `HttpOnly` apply either way.

[trust-proxy]: https://expressjs.com/en/guide/behind-proxies.html

Full contract: [specs/approval-channels.md](specs/approval-channels.md).

## Transparent HTTP proxy

Optional `proxy-config.json` enables one or more HTTP listeners that
forward to configured upstreams with server-side credential injection.
Full contract: [specs/transparent-proxy.md](specs/transparent-proxy.md).

## HTTPS (TLS)

Optional `tls` block in `lucifer.json` makes the main gateway port serve
HTTPS. Omit it and the listener stays plain HTTP, as before.

```json
{
  "tls": {
    "source": "pem",
    "certFile": "certs/server.crt",
    "keyFile": "certs/server.key"
  }
}
```

`source` is one of:

| `source` | Fields | Notes |
|---|---|---|
| `pem` | `certFile`, `keyFile`, optional `caFile` | Certificate and key as separate PEM files. `caFile` holds the intermediates and is appended to `certFile` so clients receive the full chain. |
| `pfx` | `pfxFile` | PKCS#12 bundle (`.pfx` / `.p12`). Unlock with `LUCIFER_TLS_PASSPHRASE`. |
| `windows-store` | exactly one of `store.dnsName` / `store.thumbprint` / `store.subject`, optional `store.location` / `store.name` | Windows only. `dnsName` names the certificate by host name (`"pippo.codewrecks.com"`); `thumbprint` takes the SHA-1 (40 hex) or SHA-256 (64 hex) fingerprint; `subject` is a literal substring of the subject DN. The issuing intermediates are read from the store alongside the certificate. The private key must be exportable; `LocalMachine` usually needs elevation. The store is read through the native Windows CryptoAPI (`crypt32.dll`), so no process is spawned and nothing is written to disk. |

Optional `minVersion` is `TLSv1.2` (default) or `TLSv1.3`. Certificate paths
are resolved relative to the config file's directory. Certificates are read
once at startup, so rotation requires a restart, and a bad certificate fails
startup rather than silently downgrading to HTTP. The port serves HTTPS only
— there is no companion plain-HTTP port.

The block is read from the file named by `--config`. `npm run dev` and
`npm start` take no such flag and fall back to `./config/lucifer.json` when it
exists. Full contract: [specs/tls.md](specs/tls.md).

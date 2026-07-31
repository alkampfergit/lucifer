# Common setup

This page applies to both Telegram and Admin UI approval.

## 1. Generate configuration and credentials

Run initialization once:

```bash
npx lucifer-gate --init .
```

This creates `config/lucifer.json`, `config/api-keys.json`, and
`config/command-rules.json`. It prints the generated API key and admin secret
once. Store both securely: callers use the API key and the approval UI/API
uses the admin secret.

Initialization refuses to overwrite an existing configuration directory.

## 2. Configure command policy

Rules are checked from top to bottom and the first matching prefix wins. A
minimal policy that requires approval for `git pull` is:

```json
{
  "rules": [
    { "prefix": "git pull", "action": "manual_approve" },
    { "prefix": "echo ", "action": "always_approve" },
    { "prefix": "rm ", "action": "always_deny" }
  ],
  "defaultAction": "always_deny"
}
```

Keep `defaultAction` restrictive and add explicit `manual_approve` rules for
commands that should reach a human.

## 3. Start and check the server

```bash
npx lucifer-gate --config ./config/lucifer.json
curl http://localhost:3001/api/health
```

The default HTTP port is `3001`. The server must have at least one approval
channel configured; continue with the [Telegram scenario](telegram-approval.md)
or [Admin UI scenario](admin-ui-approval.md).

## 4. Submit a command

Use the API key printed by `--init`:

```bash
curl -X POST http://localhost:3001/api/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"command":"git pull origin main"}'
```

For a `manual_approve` rule, the request remains pending until an approver
decides. Approval executes the command; denial returns `403`.

## 5. Invoke a configured alias (tool)

Aliases map a short name to a specific executable, so callers never see or
control the underlying path. Given this `aliases` block in `lucifer.json`:

```json
{
  "aliases": {
    "deploy": { "path": "/opt/ops/deploy.sh", "type": "bash" }
  }
}
```

call it by sending the alias name as the `command`, exactly as configured —
no arguments, flags, or shell metacharacters:

```bash
curl -X POST http://localhost:3001/api/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"command":"deploy"}'
```

Sending `{"command":"deploy --dry-run"}` is rejected with
`ALIAS_ARGS_NOT_SUPPORTED` — appending arguments to an alias name is treated
as a bypass attempt, not a way to pass parameters to the tool, **unless**
the alias explicitly opts in with `allowArgs: true` (below).

### Giving an alias fixed arguments

If a tool needs specific arguments every time it runs, bake them into the
alias with `args` — a fixed array set by the operator, not something the
caller can change:

```json
{
  "aliases": {
    "unread-summary": {
      "path": "/opt/ops/bin/smtp",
      "type": "elf",
      "args": ["summary", "--unread"]
    }
  }
}
```

`args` must be the executable's own `path`, on its own — do not append
arguments onto `path` as a single string (e.g.
`"path": "/opt/ops/bin/smtp summary"`); that is not a valid file path and
fails with `ENOENT` because Lucifer looks for a file with that exact literal
name, space included.

### Letting a caller pass arguments to a tool

Some tools need a caller-controllable argument (e.g. `--unread`, `--limit
10`) rather than a fixed value baked in at config time. Set `allowArgs:
true` on the alias:

```json
{
  "aliases": {
    "GetUnreadEmail": {
      "path": "A:\\Develop\\github\\agent-tooling\\tools\\Smtp.exe",
      "type": "elf",
      "args": ["summary"],
      "allowArgs": true
    }
  }
}
```

```bash
curl -X POST http://localhost:3001/api/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"command":"GetUnreadEmail --unread --limit 10"}'
```

The text after the alias name is split on whitespace and appended after any
fixed `args`, so this runs `Smtp.exe summary --unread --limit 10`. It is
still spawned with no shell involved (`shell: false`), so the arguments are
passed to the executable literally — they can never be interpreted as shell
syntax. There's no quoted-string support yet, so `--subject "hello
world"` becomes three separate tokens (`--subject`, `hello`, `world`), not
one two-token pair — quote-aware tools should expect that.

Note this is different from `toolsPath` below: an `allowArgs` alias always
runs with its own directory as `cwd`, which is why it's the right fit for
a tool that resolves config/state relative to its own location (like
`Smtp.exe` in this example) — a raw command via `toolsPath` runs with the
daemon's `cwd` instead, and a tool relying on its own directory would
silently produce no useful output there.

### Letting raw commands find tools outside PATH

If you want to run a **raw** command (not an alias) by name — e.g.
`{"command":"mytool --flag"}` gated by a `command-rules.json` prefix rule —
without spelling out its full path everywhere, add its directory to
`toolsPath` in `lucifer.json`:

```json
{
  "toolsPath": ["A:\\Develop\\github\\agent-tooling\\tools"]
}
```

Every command's `PATH` gets these directories prepended, so `mytool` (or
`mytool.exe`) resolves the same way it would from a shell with that
directory on `PATH`. This only affects the raw/shell execution path —
aliases always spawn their configured `path` directly and never consult
`PATH`. **`toolsPath` only helps the shell find the executable — it does
not change the working directory.** If the tool needs to run from its own
directory (most tools that read relative config/state do), use an
`allowArgs` alias instead, as above.

## Shared approval behavior

- **Once** executes the current request without caching approval.
- **Exact** stores the complete command string.
- **Prefix** stores the first two command tokens.
- Time-limited approvals expire after 2 or 8 hours.
- Permanent approvals do not expire; use them only for narrowly scoped,
  trusted commands.
- Cached approvals are checked before a new human prompt.

## Configuration locations

| File | Purpose |
|---|---|
| `lucifer.json` | Server settings, timeouts, data directory, and paired Telegram chat |
| `api-keys.json` | Hashed caller API keys and optional IP allowlists |
| `command-rules.json` | Allow, deny, and manual-approval policy |
| `<dataDir>/lucifer.db` | Resolved approvals and audit log |

See the [configuration reference](../CONFIGURATION.md) for environment
variables, logging, Docker, aliases, and proxy configuration.

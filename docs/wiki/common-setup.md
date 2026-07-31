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
as a bypass attempt, not a way to pass parameters to the tool.

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

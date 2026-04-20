# Lucifer Gate

AI agent command firewall with Telegram-based human approval.

Lucifer sits between your AI agent and the shell. It authenticates callers via
API keys, matches commands against a policy file, and gates unknown commands
through Telegram for human approval. Approved commands build up a permission
library over time. Think "sudo via Telegram."

## Quick start (2 minutes, no Telegram needed)

```bash
# Generate config files + API key
npx lucifer-gate --init .

# Start in dev mode (auto-approves everything, no Telegram)
LUCIFER_TELEGRAM_TOKEN=skip npx lucifer-gate --config ./config/lucifer.json --auto-approve

# In another terminal, test it:
curl -X POST http://localhost:3001/api/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY_FROM_INIT" \
  -d '{"command":"echo hello"}'
```

## How it works

1. Caller sends `POST /api/v1/execute` with API key + command.
2. Lucifer authenticates the key and checks the IP allowlist.
3. Command is matched against `config/command-rules.json`:
   - `always_approve` → execute immediately
   - `always_deny` → reject (`403`)
   - `manual_approve` → check SQLite for a cached approval, or send to Telegram
4. If Telegram approval is needed, a human sees the command with risk warnings
   and taps a button.
5. Approved commands execute and results are returned to the caller.

See [docs/specs/command-execution.md](docs/specs/command-execution.md) for the
full API contract (request shape, success response, error codes) and
[docs/specs/approval-channels.md](docs/specs/approval-channels.md) for how
Telegram, the web admin UI, and auto-approve interact.

## Production setup (with Telegram)

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather) and get the
   token.
2. Send any message to your bot from the chat you want to use for approvals.
3. Pair the chat:

   ```bash
   LUCIFER_TELEGRAM_TOKEN=your_bot_token npx lucifer-gate pair --config ./config/lucifer.json
   ```

   The wizard lists chats that have messaged the bot, sends a 6-digit
   verification code, and writes the chosen chat ID into `lucifer.json`.
4. Start the server:

   ```bash
   LUCIFER_TELEGRAM_TOKEN=your_bot_token npx lucifer-gate --config ./config/lucifer.json
   ```

See [docs/specs/operator-workflows.md](docs/specs/operator-workflows.md) for
the full pairing, `--init`, `log`, and `stats` contract.

When a `manual_approve` command arrives, an inline keyboard appears in
Telegram with buttons for exact / prefix approval and lifetimes of 2h, 8h,
or permanent, plus a Deny button. Approval shapes and storage semantics live
in [docs/specs/approval-channels.md](docs/specs/approval-channels.md).

## CLI

```
lucifer-gate --init [dir]              Generate starter config + API key
lucifer-gate pair [--config <path>]    Pair a Telegram chat for approvals
lucifer-gate --config <path>           Start server with config
lucifer-gate --auto-approve            Dev mode (no Telegram)
lucifer-gate log [--limit N]           Query audit log
lucifer-gate stats                     Show approval statistics
```

## Configuration, logging, Docker, env vars

All operator-side configuration — file locations, environment variables,
logging setup, and the Docker recipe — lives in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Per-feature contracts live under [docs/specs/](docs/specs/):

| Topic | Source of truth |
|---|---|
| Execute API & error codes | [specs/command-execution.md](docs/specs/command-execution.md) |
| Command aliases | [specs/command-execution.md#aliases](docs/specs/command-execution.md#aliases) |
| Approval channels (Telegram, web admin, auto-approve) | [specs/approval-channels.md](docs/specs/approval-channels.md) |
| Operator workflows (init, pair, start, audit) | [specs/operator-workflows.md](docs/specs/operator-workflows.md) |
| Transparent HTTP proxy | [specs/transparent-proxy.md](docs/specs/transparent-proxy.md) |
| Platform health | [specs/platform-health.md](docs/specs/platform-health.md) |
| User journeys | [specs/USER-JOURNEYS.md](docs/specs/USER-JOURNEYS.md) |
| Architecture map | [architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |

For agent-specific instructions (task lifecycle, review checklist, skills),
start at [AGENTS.md](AGENTS.md).

## Operational limits

Before you plan a deployment, note the current shape of the runtime:

- **Single-process state.** Lucifer Gate runs as one Node process. There is no cluster-aware approval fan-out and no leader election — running more than one instance against the same data directory is not supported.
- **In-memory pending approvals are lost on restart.** Requests that are waiting for Telegram or web-admin approval at the moment of a restart are dropped: callers see their in-flight `POST /api/v1/execute` fail, and the approval notification stays orphaned in the channel. Approvals that have already resolved are persisted; only *pending* ones are volatile.
- **SQLite is the sole persistence layer.** Approvals, audit log, and related state all live in `<dataDir>/lucifer.db` via `better-sqlite3`. There is no network database driver, no clustering, and no replication; back up the file directly. Per-domain grading for these trade-offs is tracked in [docs/quality/QUALITY-GRADES.md](docs/quality/QUALITY-GRADES.md).

These are conscious pre-1.0 trade-offs, not bugs. If any of them is a blocker for your environment, open an issue before building on top of the current shape.

## Stack

- Express 5 + TypeScript
- SQLite (better-sqlite3) for approvals + audit log
- Telegraf for Telegram bot
- Optional server-delivered web approval UI with SSE updates
- Pino for structured logging (pino-pretty for human-readable dev console)
- Vitest for testing

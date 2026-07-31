# Operations

## Inspect health and activity

```bash
curl http://localhost:3001/api/health
npx lucifer-gate log --config ./config/lucifer.json --limit 50
npx lucifer-gate stats --config ./config/lucifer.json
```

The file log is written under `dataDir` by default. Runtime approval and audit
state is stored in `<dataDir>/lucifer.db`.

## Backups and restarts

Back up the SQLite database and configuration files together. A restart keeps
resolved approvals but drops pending in-memory approvals. Waiting callers must
retry after the server is available.

## Choosing approval channels

| Configuration | Result |
|---|---|
| Telegram token + paired chat | Telegram approval |
| Generated admin secret hash/salt | Admin UI approval |
| Both | First decision wins; the other channel is cancelled |
| `--auto-approve` | Development bypass; no human decision |

Do not use auto-approve as a production fallback. If no usable channel exists,
startup fails rather than silently executing manual-approval commands.

## Production checklist

- Keep `config/` and `data/` outside the application image when using Docker.
- Restrict permissions on API keys, admin credentials, Telegram tokens, and the
  SQLite database.
- Keep `defaultAction` restrictive and add narrow rules deliberately.
- Use TLS or a private network for the Admin UI.
- Back up `lucifer.db` and test restoration.
- Monitor approval timeouts, channel errors, and denied commands in the audit
  log.
- Remember that only one process may use a data directory.

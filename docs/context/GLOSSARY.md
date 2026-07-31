# Glossary

> Shared terms used across Lucifer docs and code.

| Term | Definition | In-code representation |
|---|---|---|
| `platform-api` | The Express application that exposes HTTP endpoints and serves the build output | `server/src/domains/platform-api/*` |
| `command-gateway` | The command firewall domain that owns auth, rules, approvals, execution, and audit logging | `server/src/domains/command-gateway/*` |
| `health report` | The runtime status document returned by `/api/health` | `HealthReport` |
| `approval channel` | A pluggable way to obtain human or automatic approval for a command request | `ApprovalChannel` |
| `pending request` | An in-memory command awaiting approval resolution | `PendingRequest` |
| `command rule` | A prefix-based policy entry that decides whether a command is auto-approved, denied, or escalated for approval | `CommandRule` |
| `approval match type` | Whether a stored approval applies to the exact command or a derived prefix | `ApprovalMatchType` |
| `execution result` | The status/result payload returned from execute and status endpoints | `ExecutionResult` |
| `audit entry` | A structured record of request, approval, denial, execution, or error events | `AuditEntry` |
| `Lucifer config` | Operator-managed server/runtime configuration loaded from `lucifer.json` | `LuciferConfig` |
| `auto-approve mode` | Development mode that bypasses human approval | `--auto-approve`, `createAutoApproveChannel()` |
| `pairing` | Interactive CLI workflow that binds a Telegram chat to the server config | `runTelegramPairing()` |
| `admin secret` | Bearer token that enables and protects the web approval surface | `adminSecretHash` / `adminSecretSalt` in `lucifer.json` |
| `command alias` | An operator-configured short name in `lucifer.json` that resolves to an on-disk executable, spawned without a shell and with `cwd` forced to the executable's own directory. May carry fixed `args` and/or opt in to caller-supplied arguments via `allowArgs` | `CommandAlias`, `resolveAlias()` |
| `tools path` | Directories prepended to a raw (non-alias) command's `PATH`, so it can resolve executables outside the daemon's own `PATH`. Affects lookup only, not working directory | `toolsPath` in `LuciferConfig` |
| `container app` | Azure-managed containerized application target for the deployed service | `AZURE_CONTAINER_APP_NAME` variable |
| `Azure credentials` | Service principal JSON used by GitHub Actions to authenticate Azure deployment steps | `AZURE_CREDENTIALS` secret |
| `harness engineering` | The practice of encoding agent guidance and checks in the repository | `AGENTS.md`, `docs/`, `.claude/skills/` |

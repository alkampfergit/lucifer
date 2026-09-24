# Operations & Configuration Journeys

## J8: Operator Observability

> **Actor**: Operator
> **Goal**: Understand what happened on the system after the fact.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J8-S1 | As an Operator, I run `lucifer-gate log` so that I see recent command activity | CLI reads the SQLite audit log and prints recent entries | `covered` — `cli.test.ts` ("Log and stats journey") |
| J8-S2 | As an Operator, I run `lucifer-gate stats` so that I see aggregate usage metrics | CLI reads the SQLite store and prints summary statistics | `covered` — `cli.test.ts` ("Log and stats journey") |
| J8-S3 | As an Operator, I check `/api/health` so that I verify the server is running | Health endpoint returns environment, name, node version, status, timestamp | `covered` — `create_health_report.test.ts`, `create_app.test.ts` |
| J8-S4 | As an Operator, I start the server in a console so that I read human-readable log lines | Console prints `[HH:MM:ss] LEVEL: (module) message` by default, regardless of `NODE_ENV`; `--log-format json` or `LOG_FORMAT=json` prints JSON instead; an invalid or missing flag value exits 1 | `covered` — `cli.test.ts` ("console log format", "--log-format"), `logger.test.ts` |
| J8-S5 | As an Operator, I pass `--log-file <path>` so that full-detail JSON logs land where I choose | JSON lines are written to `<path>`, replacing `logFile` from `lucifer.json`, whatever the console format | `covered` — `cli.test.ts` ("console log format") |

## J9: Auto-Approve (Development Mode)

> **Actor**: Operator (local development)
> **Goal**: Skip human approval entirely for local testing.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J9-S1 | As an Operator, I start with `--auto-approve` so that all commands execute without human approval | Auto-approve channel resolves immediately for every request | `covered` — `auto_approve_channel.test.ts` |

## J10: Configuration Management

> **Actor**: Operator
> **Goal**: Manage API keys and command rules through JSON config files.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J10-S1 | As an Operator, I edit `api-keys.json` to add or revoke API keys | Server loads API keys from JSON; keys not in the file are rejected | `covered` — `api_key_store.test.ts`, `gateway_config.test.ts` |
| J10-S2 | As an Operator, I edit `command-rules.json` to control which commands need approval | Rules are matched in order by prefix; first match determines the action | `covered` — `match_command_rule.test.ts`, `gateway_config.test.ts` |
| J10-S3 | As an Operator, I configure `lucifer.json` with server and channel settings | Main config file is loaded and validated at startup | `covered` — `gateway_config.test.ts` |

## J14: HTTPS for the Gateway Listener

> **Actor**: Operator
> **Goal**: Serve the gateway over HTTPS using a certificate they already have.

### Stories

| ID | Story | Acceptance Criteria | Coverage |
|---|---|---|---|
| J14-S1 | As an Operator, I add a `tls` block pointing at a PEM certificate and key so that the gateway serves HTTPS | Listener negotiates TLS 1.2 or better and answers `/api/health`; `minVersion: TLSv1.3` turns a TLS 1.2 client away; without the block the listener stays plain HTTP | `covered` — `tls.test.ts`, `tls_config.test.ts`, `resolve_tls_options.test.ts` |
| J14-S5 | As an Operator whose certificate was issued by an intermediate CA, I point `caFile` at the chain so that clients can build a path to the root | The chain is appended to the leaf and sent during the handshake, not loaded into the client-verification trust store where it would never be transmitted | `covered` — `resolve_tls_options.test.ts`, `tls.test.ts` |
| J14-S6 | As an Operator running `npm run dev` or `npm start`, I get the `tls` block from `./config/lucifer.json` so that the flagless entrypoints serve HTTPS like the CLI does | The default config path is used when the file exists; a checkout without one still starts on built-in defaults | `covered` — `config_path.test.ts` |
| J14-S2 | As an Operator, I point the `tls` block at a PKCS#12 bundle and supply `LUCIFER_TLS_PASSPHRASE` so that I can reuse a `.pfx` I already hold | Bundle is unlocked from the environment variable, never from `lucifer.json`, and the listener serves HTTPS | `covered` — `tls.test.ts`, `resolve_tls_options.test.ts` |
| J14-S3 | As an Operator on Windows, I select a certificate from the Windows certificate store by the host name it was issued for (`pippo.codewrecks.com`), by SHA-1/SHA-256 thumbprint, or by subject, so that I do not export it by hand | Certificate and its issuing intermediates are read into memory under a single-use passphrase; a non-Windows host fails at startup with a message pointing at `pem`/`pfx` | `covered` — `windows_certificate_store.test.ts` drives selection and chain assembly against a real openssl-issued chain on every platform; `windows_store.test.ts` boots the listener from certificates planted in `Cert:\CurrentUser\My` on the Windows CI runner — a self-signed one, and a leaf under a planted `root → intermediate → leaf` chain whose handshake is validated by a client trusting only the root |
| J14-S4 | As an Operator, I get a descriptive startup failure when the TLS config is wrong so that I never silently serve plain HTTP | Unknown `source`, mixed-source fields, a bad thumbprint, or a missing certificate file all throw at startup, naming the field or path | `covered` — `tls_config.test.ts`, `tls.test.ts` |

## Section Summary

| Status | Count |
|---|---|
| `covered` | 15 |
| `partial` | 0 |
| `uncovered` | 0 |

---
name: codeql-spawn-by-design-alerts
description: The standalone CodeQL check fails on nearly every PR touching execute_command.ts with critical js/command-line-injection + high js/path-injection; these are by-design and get dismissed as "won't fix", not fixed.
metadata:
  type: project
---

The standalone `CodeQL` check (app `github-advanced-security`, distinct from the
`Analyze (...)` workflow jobs, which pass) fails on any PR that shifts the line number of
the raw-command fallback in
`server/src/domains/command-gateway/service/execute_command.ts`:

```ts
return spawn(options.command, { shell: true, cwd: ..., detached: true, env }); // NOSONAR
```

It reports `js/command-line-injection` (critical) + `js/path-injection` (high) as *new*
alerts. As of 2026-07-31 this same pair on this same statement had been dismissed as
*won't fix* four times, once per line move: line 37 (#4, #7), line 48 (#24, #25),
line 55 (#27, #28), line 71 (#29, #30 — PR #51). CodeQL does not carry a dismissal across
a moved statement.

Standard dismissal comment used by the owner:
`Intentional command execution in a command gateway. Access gated by API-key auth and configurable command rules.`

**Why:** Lucifer Gate *is* a command firewall — executing caller-supplied shell commands is
the product. Its security control is API-key auth + configurable allow/deny command rules +
Telegram human approval, not input escaping. A code "fix" would either delete the core
feature or add sanitisation implying a guarantee the design does not make.

**How to apply:** When the `CodeQL` check fails on a PR touching this file, do not attempt a
code fix. First confirm it is the same recurrence — check whether the flagged statement is
behaviourally identical to master's and whether the PR introduced any genuinely
caller-controlled input into it (`toolsPath` is operator-config-only, validated in
`gateway_config.ts`; the alias branch spawns `shell: false` with array argv, so it is inert).
If it is the recurrence, the resolution is dismissal, which needs the owner — see
[[pr-cycle-permission-guards]]. Query prior dismissals to confirm precedent:
`gh api 'repos/alkampfergit/lucifer/code-scanning/alerts?state=dismissed&per_page=100'`.

A durable fix (`.github/codeql/codeql-config.yml` query filter) has been recommended to the
owner but not implemented; until it exists, expect this every time.

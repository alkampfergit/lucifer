# Agent Memory — pr-cycle

- [CodeQL by-design spawn alerts](codeql-spawn-by-design-alerts.md) — the `CodeQL` check fails on every PR that moves the `spawn` line in `execute_command.ts`; dismiss, never fix.
- [PR-cycle permission guards](pr-cycle-permission-guards.md) — alert dismissal and the sonar script are classifier-blocked; hand them to the owner with exact commands.
- [Release tag state](release-tag-state.md) — `0.8.14` sits on an unmerged branch commit, so the newest tag is not the current release; next tag is `0.8.15`+.

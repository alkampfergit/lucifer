---
name: pr-cycle-permission-guards
description: Security-alert dismissal via gh api and the sonar fetch_pr_analysis.sh script are both blocked by the permission classifier — plan to hand these to the owner rather than expecting to run them.
metadata:
  type: feedback
---

Two actions the pr-cycle workflow nominally calls for are blocked by the Claude Code
permission classifier and cannot be completed autonomously (observed 2026-07-31, PR #51):

- `gh api -X PATCH repos/alkampfergit/lucifer/code-scanning/alerts/<n> -f state=dismissed ...`
- `./.claude/skills/sonar/scripts/fetch_pr_analysis.sh alkampfergit_lucifer <PR>`

**Why:** Dismissing a security alert and running the Sonar script are treated as
consequential/unsandboxed actions. The block is appropriate — do not try to route around it
with an equivalent tool, and do not treat the denial as a reason to abandon the diagnosis.

**How to apply:** Do the full diagnostic work anyway and hand the owner an exact
copy-pasteable command plus the reasoning, posted as a PR comment. For Sonar, the
`SonarCloud Code Analysis` entry in `gh pr checks <PR>` still gives a pass/fail signal even
when the script is unavailable — use it, and say that the independent verification could not
be run. Expect to stop short of merge whenever clearing the `CodeQL` check is the last
blocker, since only the owner can dismiss — see [[codeql-spawn-by-design-alerts]].

---
name: github-pr-fixer
description: >
  Fix the current GitHub pull request until checks pass or three fix rounds are
  exhausted. Use when an open PR has failing or pending checks and you need to
  inspect GitHub checks with gh, remediate SonarCloud issues with the sonar
  skill, inspect failed workflow jobs or code scanning alerts, push fixes, and
  repeat, or when the user wants to open a PR from the current branch or close
  a ready release PR.
metadata:
  author: codex
  version: 1.2.0
  category: workflow
---

# Skill: GitHub PR Fixer

Use this skill to drive a PR to green with `gh` and the existing `sonar`
skill, or to close a ready release PR when the user explicitly asks for that
release flow, or to open a PR from the current branch.

## Inputs and assumptions

- `gh` is authenticated and can read PRs, checks, and workflow logs.
- The current branch is attached to an open PR, or the user gives a PR number.
- Push access is available.
- For Sonar remediation, use project key `alkampfergit_lucifer` unless the
  user overrides it.

## Route by task

| User wants | Load |
|------------|------|
| Open a PR from the current branch | `references/open-pr.md` |
| Fix failing or pending checks | `references/pr-resolution.md`, then `references/check-diagnosis.md`, then `references/fix-loop.md` |
| Close a ready PR and cut a release tag | `references/pr-resolution.md`, then `references/release-closure.md` |
| Investigate a known standalone CodeQL-style failure pattern | `references/standalone-security-checks.md` |

## Round limit

- Maximum `3` fix rounds.
- A round means: inspect failures, make fixes, validate locally, commit, push,
  and wait for checks again.

## Core workflow

1. Resolve the active PR with `gh`. Do not guess the PR number.
2. Wait for the current check cycle to settle before diagnosing failures.
3. Pick the matching failure path:
   - Sonar path
   - Failed GitHub Actions job path
   - Standalone security check path
4. Implement the smallest root-cause fix.
5. Run standard local validation.
6. Commit, push, and re-watch checks.
7. Stop when checks are green, the blocker is external, or three rounds are
   exhausted.

## Required validation

```bash
npm run lint
npm test
npm run build
```

If the failure is narrowly scoped, targeted tests may run first, but the round
is not complete until the standard repository validation passes.

## Stop conditions

When stopping, report:

- Which checks now pass
- Which checks still fail
- Which rounds were attempted
- The exact blocking check names and URLs

## Guardrails

- Never rerun failing checks blindly without understanding the failure.
- Do not assume a failed `CodeQL` check means the CodeQL workflow jobs failed.
- Do not assume Sonar is the only source of PR failures.
- Do not exceed three fix rounds in one session.
- Do not overwrite unrelated user changes on the branch.
- Do not open a PR from a dirty branch without making that state explicit.
- Do not guess the base branch for a new PR; verify it first.
- Do not create or push a release tag without explicit user confirmation.
- Do not close a release PR until `master`, the tag, and branch cleanup are all
  complete.

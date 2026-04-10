---
name: github-pr-fixer
description: >
  Fix the current GitHub pull request until checks pass or three fix rounds are
  exhausted. Use when an open PR has failing or pending checks and you need to
  watch GitHub checks with gh, remediate SonarCloud issues with the sonar
  skill, inspect failed workflow jobs or code scanning alerts, push fixes, and
  repeat.
metadata:
  author: codex
  version: 1.0.0
  category: workflow
---

# Skill: GitHub PR Fixer

Use this skill to drive a PR to green with `gh` and the existing `sonar`
skill.

This workflow is validated against PR `#3` in `alkampfergit/lucifer`
(`release/0.3.3` to `master`) on 2026-04-10:

- `gh pr checks 3` reported `CodeQL fail` while `SonarCloud Code Analysis`
  passed.
- `gh api 'repos/alkampfergit/lucifer/code-scanning/alerts?pr=3'` identified
  alert `js/insufficient-password-hash` in
  `server/src/domains/command-gateway/repository/api_key_store.ts`.

## Inputs and assumptions

- `gh` is authenticated and can read PRs, checks, and workflow logs.
- The current branch is attached to an open PR, or the user gives a PR number.
- Push access is available.
- For Sonar remediation, use the repository project key
  `alkampfergit_lucifer` unless the user overrides it.

## Round limit

- Maximum `3` fix rounds.
- A round means: inspect failures, make fixes, validate locally, commit, push,
  and wait for checks again.

## Step 1: Resolve the current PR

Use `gh` only. Do not guess the PR number.

```bash
gh pr status
gh pr view --json number,title,headRefName,baseRefName,url
```

Capture:

- PR number
- head branch
- base branch
- PR URL

## Step 2: Wait for the current check cycle

Use watch mode before starting a new diagnosis so you do not read half-finished
results.

```bash
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

Then collect a machine-readable inventory:

```bash
gh pr checks "$PR_NUMBER" --json name,state,link,workflow,bucket
gh pr view "$PR_NUMBER" --json statusCheckRollup
```

Treat these cases differently:

- `SonarCloud Code Analysis` failed or Sonar reports open issues for the PR
- GitHub Actions job failed and the link contains `/actions/runs/<run>/job/<job>`
- A standalone security check failed with no workflow name, such as `CodeQL`

## Step 3: Sonar path

If Sonar is failing, or if the user explicitly wants Sonar issues fixed, load
the `sonar` skill and read only the PR fix workflow:

- `.claude/skills/sonar/SKILL.md`
- `.claude/skills/sonar/references/fix-workflow.md`

Preferred commands:

```bash
SONARCLOUD_PROJECT_KEY=alkampfergit_lucifer \
./.claude/skills/sonar/scripts/fetch_pr_analysis.sh alkampfergit_lucifer "$PR_NUMBER"
```

Use the returned issue list as the fix target inventory. Sonar may be green
even when other GitHub checks still fail, so do not stop after a green Sonar
result.

## Step 4: Failed GitHub Actions job path

For a failed check whose link contains a workflow run and job:

1. Extract the run ID and job ID from the link.
2. View the failing steps first.
3. Fall back to the full log only if needed.

```bash
gh run view "$RUN_ID" --job "$JOB_ID" --log-failed
gh run view "$RUN_ID" --job "$JOB_ID" --log
gh run view "$RUN_ID" --json jobs,name,headSha,conclusion,url
```

Name the failure mode before fixing it. Prefer a minimal root-cause fix over
re-running a job unchanged.

## Step 5: Standalone security check path

Some failures are not normal workflow jobs. PR `#3` produced a standalone
`CodeQL` failure even though the `Analyze (...)` jobs succeeded. In that case:

1. Get the PR head SHA.
2. Fetch failing check-runs for that commit.
3. Read annotations and code scanning alerts.

```bash
PR_SHA="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)"
gh api "repos/alkampfergit/lucifer/commits/$PR_SHA/check-runs"
gh api 'repos/alkampfergit/lucifer/code-scanning/alerts?pr='"$PR_NUMBER"
```

If you need annotations for a specific check-run:

```bash
gh api "repos/alkampfergit/lucifer/check-runs/$CHECK_RUN_ID/annotations"
```

Important:

- Quote `gh api` endpoints that contain `?` when running under `zsh`.
- Use code scanning alerts for CodeQL-style failures; `gh run view` will not
  help when there is no workflow run behind the failing check.

## Step 6: Implement and validate the fix

Use the repository task lifecycle:

1. Reproduce or isolate the failing condition.
2. Apply the smallest fix that addresses the root cause.
3. Run local validation before pushing.

Required local validation:

```bash
npm run lint
npm test
npm run build
```

If the failure is narrowly scoped and `npm test` is expensive, you may run
targeted tests first, but the round is not complete until the standard repo
validation passes.

## Step 7: Commit, push, and re-watch

Use one commit per round unless the branch already contains uncommitted user
changes that must be preserved.

```bash
git status --short --branch
git add -A
git commit -m "fix: address PR check failures (round $ROUND)"
git push
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

After the push completes, return to Step 2.

## Stop conditions

Stop early when:

- All required checks pass
- The remaining failure is external and not fixable from the repository
- A third fix round has completed

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

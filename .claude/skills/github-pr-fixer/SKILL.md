---
name: github-pr-fixer
description: >
  Fix the current GitHub pull request until checks pass or three fix rounds are
  exhausted. Use when an open PR has failing or pending checks and you need to
  watch GitHub checks with gh, remediate SonarCloud issues with the sonar
  skill, inspect failed workflow jobs or code scanning alerts, push fixes, and
  repeat, or when the user wants to close a release PR by confirming a tag,
  rebasing on master, fast-forwarding master, tagging, pushing, and closing the
  PR with gh.
metadata:
  author: codex
  version: 1.1.0
  category: workflow
---

# Skill: GitHub PR Fixer

Use this skill to drive a PR to green with `gh` and the existing `sonar`
skill, and to close a ready PR when the user explicitly asks for release
closure.

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

## Route by task

| User wants | What to do |
|------------|------------|
| Fix failing or pending checks | Follow Steps 1-7 |
| Close a ready PR and cut a release tag | Follow Steps 1-2, confirm the release tag, then use Step 8 |

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

## Step 8: Close a release PR

Use this path only when the user explicitly asks to close the pull request.

### 8.1 Determine the release tag proposal

Start from `master` and inspect the latest tag:

```bash
git fetch origin --tags
git checkout master
git pull --ff-only origin master
git tag --sort=-v:refname | head -20
```

Then inspect the PR branch name:

```bash
gh pr view "$PR_NUMBER" --json headRefName,baseRefName,url,title
```

If the head branch matches `release/<semver>`, treat that version as the
proposed tag. In this repository, `release/0.3.3` implies proposed tag
`0.3.3`.

Before doing any release operation, ask the user to confirm the tag or propose
another one. Do not create or push a tag without explicit confirmation.

What to report in the confirmation prompt:

- latest tag currently on `master`
- proposed next tag
- source branch name

### 8.2 Rebase the branch if needed

After the user confirms the tag, ensure the PR branch is current with `master`.

```bash
git checkout "$HEAD_BRANCH"
git fetch origin
git rebase origin/master
git push --force-with-lease
```

If the branch is already up to date, do not rebase just for the sake of it.

### 8.3 Ensure checks are green before release

Wait again before merging or tagging:

```bash
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

Do not proceed to release if required checks are failing.

### 8.4 Fast-forward `master`, tag, push, close PR

Use fast-forward only. Do not create a merge commit.

```bash
git checkout master
git fetch origin
git pull --ff-only origin master
git merge --ff-only "$HEAD_BRANCH"
git tag "$CONFIRMED_TAG"
git push origin master
git push origin "$CONFIRMED_TAG"
gh pr close "$PR_NUMBER"
```

If the user wants the PR closed with a comment, include one:

```bash
gh pr close "$PR_NUMBER" --comment "Released as $CONFIRMED_TAG"
```

### 8.5 Release guardrails

- Never infer final tag approval from branch naming alone.
- Never create a tag before the user confirms the version.
- Never merge to `master` with anything other than fast-forward for this flow.
- Never close the PR before `master` and the tag are pushed successfully.
- If `git merge --ff-only` fails, stop and explain why instead of forcing a
  merge.

## Guardrails

- Never rerun failing checks blindly without understanding the failure.
- Do not assume a failed `CodeQL` check means the CodeQL workflow jobs failed.
- Do not assume Sonar is the only source of PR failures.
- Do not exceed three fix rounds in one session.
- Do not overwrite unrelated user changes on the branch.

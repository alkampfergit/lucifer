# Fix Loop

## Implement and validate the fix

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

## Commit, push, and re-watch

Use one commit per round unless the branch already contains uncommitted user
changes that must be preserved.

```bash
git status --short --branch
git add -A
git commit -m "fix: address PR check failures (round $ROUND)"
git push
```

## Post a PR comment documenting the fix round

After every push, post a comment on the PR summarizing what was done in this
round. This creates a permanent audit trail of automated fixes visible to
reviewers.

Use this format:

```bash
gh pr comment "$PR_NUMBER" --body "$(cat <<'EOF'
## Fix round $ROUND

**Trigger:** <which check failed and why>

**Changes:**
- <file changed>: <what was fixed and why>
- <file changed>: <what was fixed and why>

**Commit:** `<short sha>` — <commit message>

**Local validation:** lint :white_check_mark: | test :white_check_mark: | build :white_check_mark:
EOF
)"
```

Replace the placeholders with actual values. Be specific about what failed and
what the fix does. Each bullet under Changes should name the exact file and the
concrete change, not vague summaries like "fixed code smells". Include the
failing check name and link when available.

## Re-watch checks

```bash
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

After the push completes, return to the check diagnosis workflow.

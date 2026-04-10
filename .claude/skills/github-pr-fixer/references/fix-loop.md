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
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

After the push completes, return to the check diagnosis workflow.

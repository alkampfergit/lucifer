# Standalone Security Checks

Some failures are not normal workflow jobs. A PR can produce a standalone
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

Known validated case on 2026-04-10:

- PR `#3` in `alkampfergit/lucifer`
- Branch `release/0.3.3` to `master`
- `gh pr checks 3` reported `CodeQL fail`
- `gh api 'repos/alkampfergit/lucifer/code-scanning/alerts?pr=3'` identified
  alert `js/insufficient-password-hash` in
  `server/src/domains/command-gateway/repository/api_key_store.ts`

# PR Fix Workflow — Parallel Subagents

When fixing SonarCloud violations for a pull request, always use parallel
subagents to maximize throughput.

Proven workflow from PR #3 (alkampfergit/lucifer, 2026-04-10).

## Step 1: Enumerate all issues

Fetch all PR issues and security hotspots in one pass:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER&ps=500" \
  | jq '[.issues[] | {key, severity, type, file: (.component | split(":")[1]), line, rule, message}]'
```

Group issues by file. Present a complete inventory table to the user before
starting fixes.

## Step 2: Launch parallel subagents grouped by file

Group fixes by file to avoid conflicts. Launch one subagent per file (or per
group of closely related files). Each subagent prompt must include:

- The exact file path(s) to modify
- The SonarCloud rule ID (e.g., `S2871`, `S3776`)
- The exact line number and violation message
- A concrete fix description (not just "fix this")
- Instruction to run `npm test` and `npm run lint` after fixing

Example grouping from a real session (15 issues, 4 agents):

| Agent | Files | Issues |
|-------|-------|--------|
| Agent 1 | `schema_contracts.test.ts` | S2871 (sort), S3358 (ternary) |
| Agent 2 | `gateway_config.ts` | S3776 (complexity), S7741 x7 (typeof) |
| Agent 3 | `api_key_store.ts` | S3776 (complexity) |
| Agent 4 | Remaining files | S7721, S7735, S4325, S7776 |

## Step 3: Commit, push, and verify

After all agents complete:

```bash
git add -A
git commit -m "Fix SonarCloud violations for PR #N"
git push
```

Wait for SonarCloud re-analysis using `gh`:

```bash
for i in $(seq 1 30); do
  STATUS=$(gh pr checks $PR_NUMBER --json name,state \
    --jq '.[] | select(.name == "SonarCloud Code Analysis") | .state')
  echo "Attempt $i: $STATUS"
  [ "$STATUS" = "SUCCESS" ] && echo "PASSED" && break
  [ "$STATUS" = "FAILURE" ] && echo "FAILED" && break
  sleep 10
done
```

Verify the quality gate:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/qualitygates/project_status?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER" \
  | jq '.projectStatus | {status, conditions: [.conditions[] | select(.status == "ERROR")]}'
```

## Common second-pass failures

If the quality gate still fails after fixing all issues:

- **Duplication > threshold**: Extract shared test setup into a helper file
  (e.g., `test/integration-setup.ts`). Extract repeated patterns into local
  helper functions.
- **Security hotspots not reviewed**: Often false positives in test files
  (`Math.random` for temp dirs, hardcoded test IPs). Require manual review in
  SonarCloud UI or adjusting quality gate settings.
- **Ghost issues with `line: null`**: Issues from previous analysis that were
  fixed. SonarCloud API may still return them briefly. Check
  `api/project_pull_requests/list` for actual `bugs`/`codeSmells` count.

## Common TypeScript fix patterns

| Rule | Pattern | Fix |
|------|---------|-----|
| S2871 | `.sort()` without comparator | `.sort((a, b) => a.localeCompare(b))` |
| S3776 | Cognitive complexity too high | Extract helper functions |
| S3358 | Nested ternary | Replace with if/else |
| S7741 | `typeof x !== 'undefined'` | `x !== undefined` or `x === undefined` |
| S7721 | Function in wrong scope | Move to outer scope |
| S7735 | Negated condition | Flip condition and swap branches |
| S4325 | Unnecessary type assertion | Remove `as Type` or use `vi.mocked()` |
| S7776 | Array used for lookups | Use `Set` + `.has()` |

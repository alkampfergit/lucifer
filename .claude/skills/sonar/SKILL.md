---
name: sonar
description: >
  Fetch SonarCloud issues for a project and break them down by severity using
  the SonarCloud Web API. Use when a prompt includes a SonarCloud project key
  and you need current issue counts or issue details for BLOCKER, CRITICAL,
  MAJOR, MINOR, and INFO severities, or when the user wants a fix-target list
  for high-severity, medium-severity, or BUG issues.
metadata:
  author: codex
  version: 1.2.0
  category: workflow
  required-inputs:
    - sonarcloud project key from the user prompt
  outputs:
    - severity counts
    - issue details grouped by severity
    - fix-target issue list for high, medium, and BUG requests
    - current-PR quality gate, issue, and security hotspot summary
    - verified SonarCloud analysis link for the current PR
    - per-issue source snippets and rule metadata
    - per-issue suggested fixes
---

# Skill: Sonar

Use this skill to query SonarCloud issues directly from the Web API and split
results by severity.

Use the helper script when the user wants rich detail for each violation:

- Script: `scripts/fetch_issue_details.sh`
- Output: one JSON object with issue metadata, rule metadata, flow locations,
  a plain-text source snippet around the failing line, and a suggested fix.

Use these helper scripts for PR-scoped SonarCloud work:

- Script: `scripts/fetch_pr_analysis.sh`
- Output: one JSON object with the current PR from `gh`, SonarCloud PR
  analysis metadata, quality gate status, PR issues, PR security hotspots, and
  a verified canonical SonarCloud analysis URL.

- Script: `scripts/fetch_hotspot_details.sh`
- Output: one JSON object with hotspot metadata, rule metadata, a plain-text
  source snippet, and a suggested fix.

## Scope

This workflow is for any SonarCloud project key provided in the user prompt.

- Base URL: `https://sonarcloud.io`
- Verified against a public project on: `2026-04-10`

Do not hardcode the project key in the skill. Read it from the prompt, then set
`SONARCLOUD_PROJECT_KEY` before querying.

## Quick Start

Set the project key from the prompt:

```bash
export SONARCLOUD_PROJECT_KEY='<project-key-from-prompt>'
export SONARCLOUD_BASE_URL=https://sonarcloud.io
```

Verify the project exists and is visible:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/components/show?component=$SONARCLOUD_PROJECT_KEY"
```

Get one-shot severity counts:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&facets=severities&ps=1" \
  | jq -r '
      .facets[]
      | select(.property == "severities")
      | .values[]
      | "\(.val)\t\(.count)"'
```

## Workflow

### 1. Fetch severity totals

Use the `severities` facet when you want counts only.

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&facets=severities&ps=1"
```

This returns a `facets` section with counts for:
- `BLOCKER`
- `CRITICAL`
- `MAJOR`
- `MINOR`
- `INFO`

### 2. Fetch issues for one severity

Use the `severities` query parameter for issue details.

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=CRITICAL&ps=100" \
  | jq -r '
      .issues[]
      | [
          .severity,
          .component,
          (.line // 0),
          .rule,
          .message
        ]
      | @tsv'
```

Replace `CRITICAL` with any supported severity.

### 3. Fetch all severities in one loop

Use this when you want a repeatable summary plus detailed rows.

```bash
for severity in BLOCKER CRITICAL MAJOR MINOR INFO; do
  echo "== $severity =="
  curl -sS \
    "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=$severity&ps=100" \
    | jq -r '
        "total=" + (.total | tostring),
        (.issues[]? | [
          .component,
          (.line // 0),
          .rule,
          .message
        ] | @tsv)'
  echo
done
```

### 4. Handle pagination

If a severity has more than 100 issues, page through results with `p` and `ps`.

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=MAJOR&ps=100&p=2"
```

Read:
- `.paging.pageIndex`
- `.paging.pageSize`
- `.paging.total`

### 5. Fetch detailed information for one violation

There is no separate public `api/issues/show` endpoint on SonarCloud. Use
`api/issues/search` with `issues=<issue-key>` and `additionalFields=_all` to
fetch a single issue payload.

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&issues=$ISSUE_KEY&additionalFields=_all&ps=1"
```

Useful fields from that payload:

- `.issues[0].message`
- `.issues[0].textRange`
- `.issues[0].flows`
- `.issues[0].impacts`
- `.issues[0].cleanCodeAttribute`
- `.issues[0].tags`
- `.issues[0].rule`
- `.issues[0].organization`

### 6. Fetch the failing code snippet

Use the issue's `component` key plus a line range around the failing line:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/sources/lines?key=$COMPONENT_KEY&from=$FROM_LINE&to=$TO_LINE"
```

SonarCloud returns HTML-marked code. Strip the tags before presenting it:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/sources/lines?key=$COMPONENT_KEY&from=$FROM_LINE&to=$TO_LINE" \
  | jq -r '.sources[] | "\(.line):\(.code)"' \
  | perl -pe 's/<[^>]+>//g; s/&gt;/>/g; s/&lt;/</g; s/&amp;/&/g; s/&quot;/"/g; s/&#39;/'"'"'"'"'"'"'"'"'/g;'
```

### 7. Fetch rule metadata and remediation hints

Use the issue's `organization` and `rule` keys:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/rules/show?organization=$ORGANIZATION_KEY&key=$RULE_KEY"
```

Useful rule fields:

- `.rule.name`
- `.rule.severity`
- `.rule.type`
- `.rule.tags`
- `.rule.sysTags`
- `.rule.impacts`
- `.rule.remFnType`
- `.rule.remFnBaseEffort`
- `.rule.debtOverloaded`

If SonarCloud does not expose a prose fix recipe in the API response, use:

1. the issue `message`
2. the source snippet
3. the flow locations
4. the rule metadata

to explain what is wrong and propose the likely fix.

### 8. Use the helper script for a full detailed report

The helper script wraps the issue, rule, and snippet calls into one command:

```bash
.claude/skills/sonar/scripts/fetch_issue_details.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$ISSUE_KEY"
```

The script returns:

- issue severity, type, rule, message, line, and effort
- flow locations for secondary contributing lines
- rule metadata and remediation function metadata
- a plain-text code snippet around the failing location
- a `suggestedFix` field with a concrete change recommendation

### 9. Get SonarCloud results for the current PR

When the user asks for Sonar results "for the current PR", use `gh` to resolve
the PR number from the checked-out branch first. Do not guess the PR number
from branch names or environment variables if `gh` can answer it directly.

Use:

```bash
gh pr view --json number,url,headRefName,baseRefName,headRefOid,state
```

If the user explicitly names a PR number, use:

```bash
gh pr view <pr-number> --json number,url,headRefName,baseRefName,headRefOid,state
```

Then fetch the matching SonarCloud PR analysis:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/project_pull_requests/list?project=$SONARCLOUD_PROJECT_KEY"
```

Select the PR whose `.key` matches the GitHub PR number.

Fetch the PR quality gate:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/qualitygates/project_status?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER"
```

Fetch PR issues:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER&ps=500&additionalFields=_all"
```

Fetch PR security hotspots:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/hotspots/search?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER&ps=500"
```

Use the helper script for the full combined payload:

```bash
.claude/skills/sonar/scripts/fetch_pr_analysis.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$PR_NUMBER"
```

Or omit the PR number to let the script resolve the current PR with `gh`:

```bash
.claude/skills/sonar/scripts/fetch_pr_analysis.sh \
  "$SONARCLOUD_PROJECT_KEY"
```

### 10. Verify the SonarCloud analysis link for the current PR

Use `gh` to confirm the PR has a SonarCloud check run:

```bash
gh pr view "$PR_NUMBER" --json statusCheckRollup \
  | jq '.statusCheckRollup[] | select(.name == "SonarCloud Code Analysis")'
```

GitHub may expose `detailsUrl` as only `https://sonarcloud.io`, which is not
the deep link to the PR analysis page. In that case, construct the canonical
analysis URL yourself:

```bash
analysis_url="$SONARCLOUD_BASE_URL/project/overview?id=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER"
curl -sS -o /dev/null -w '%{http_code}\n' "$analysis_url"
```

Treat the SonarCloud PR analysis link as verified only when all three checks
pass:

1. `gh` shows a `SonarCloud Code Analysis` check run on the PR
2. `api/project_pull_requests/list` contains the same PR number
3. the canonical analysis URL returns HTTP `200`

`fetch_pr_analysis.sh` performs those checks and returns:

- `github.sonarCheck`
- `analysis.verified`
- `analysis.analysisUrl`
- `analysis.verification`
- `analysis.sonarPullRequest`

### 11. Get detailed fix data for PR issues and security hotspots

For PR issues, use the PR-aware issue helper:

```bash
.claude/skills/sonar/scripts/fetch_issue_details.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$ISSUE_KEY" \
  2 \
  "$PR_NUMBER"
```

This scopes both the issue lookup and the source snippet to the PR when the
issue only exists on new code in the pull request.

For PR security hotspots, use:

```bash
.claude/skills/sonar/scripts/fetch_hotspot_details.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$HOTSPOT_KEY" \
  "$PR_NUMBER" \
  2
```

This returns:

- hotspot key, file path, status, line, and message
- hotspot rule metadata and probability/category data
- hotspot risk description and fix recommendations
- a PR-scoped plain-text snippet around the hotspot
- a `suggestedFix` field with a concrete remediation recommendation

## Special Tasks

Use these shortcuts when the prompt is not just "list issues" but asks for a
remediation target set.

### Task: Fix high-severity, medium-severity, and all BUG issues

Interpret Sonar severity language explicitly:

- `high`: `BLOCKER` and `CRITICAL`
- `medium`: `MAJOR`
- `all bugs`: any issue with `type=BUG`, regardless of severity

When the user asks to "fix high and medium and all bugs", build the target set
as:

1. all `BUG` issues
2. all `BLOCKER` and `CRITICAL` issues
3. all `MAJOR` issues

De-duplicate by issue key before reporting because a `BUG` may also have one of
those severities.

Recommended query:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&ps=500&additionalFields=_all" \
  | jq '
      .issues
      | map(select(
          .type == "BUG"
          or .severity == "BLOCKER"
          or .severity == "CRITICAL"
          or .severity == "MAJOR"
        ))
      | unique_by(.key)'
```

Recommended reporting order:

1. `BUG` issues first
2. remaining `BLOCKER`
3. remaining `CRITICAL`
4. remaining `MAJOR`

For each target issue, report at minimum:

- `key`
- `type`
- `severity`
- `component`
- `line`
- `rule`
- `message`
- `effort`

If the user wants to actually fix them, fetch the detailed payload for each
target issue with `fetch_issue_details.sh`, then implement fixes in this order:

1. `BUG` issues
2. `BLOCKER` or `CRITICAL` issues
3. `MAJOR` issues

Do not claim there are bugs just because there are critical code smells. Sonar
`type` and Sonar `severity` are different dimensions and must be reported
separately.

If no issues match the target set, say that explicitly and include the query
date plus the full severity and type counts so the user can see why nothing was
selected.

## Prompt Handling

When the user says something like:

`Check SonarCloud errors for alkampfergit_lucifer`

extract:

- SonarCloud project key: `alkampfergit_lucifer`

Then run the workflow with that key. Never replace the prompt-provided key with
an example key from this skill.

When the user says something like:

`Fix high and medium Sonar issues and all bugs for alkampfergit_lucifer`

extract:

- SonarCloud project key: `alkampfergit_lucifer`
- task mode: remediation target set

Then:

1. fetch the full issue list
2. filter to `type=BUG` plus severities `BLOCKER`, `CRITICAL`, and `MAJOR`
3. de-duplicate by issue key
4. report the selected issues in the recommended order above
5. if the prompt asks to implement fixes, fetch detailed payloads and work the
   selected issues in priority order

When the user says something like:

`Check Sonar for the current PR and give me what to fix`

extract:

- SonarCloud project key from the prompt
- task mode: current PR analysis

Then:

1. use `gh pr view` to determine the current PR number
2. use `gh pr view --json statusCheckRollup` to verify the SonarCloud check is present
3. query `api/project_pull_requests/list` and verify the PR exists in SonarCloud
4. construct `project/overview?id=...&pullRequest=...` and verify it returns HTTP `200`
5. fetch the PR quality gate, PR issues, and PR security hotspots
6. if issues exist, fetch details for each issue with `fetch_issue_details.sh`
7. if hotspots exist, fetch details for each hotspot with `fetch_hotspot_details.sh`
8. report the gate status, analysis link, issues, hotspots, and concrete fix guidance

## Output Shape

When reporting results, group them by severity and include a few fields per
issue:

- `severity`
- `component`
- `line`
- `rule`
- `message`

Recommended `jq` formatter:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=MAJOR&ps=100" \
  | jq -r '
      .issues[]
      | {
          severity,
          component,
          line: (.line // 0),
          rule,
          message
        }'
```

For a detailed violation report, include:

- `severity`
- `type`
- `component`
- `line`
- `rule`
- `message`
- `flows`
- `snippet`
- `rule metadata`
- `suggested fix`

For a PR analysis report, also include:

- `pr.number`
- `analysis.analysisUrl`
- `analysis.verified`
- `qualityGate.status`
- failing quality gate conditions
- `issues.total`
- `hotspots.total`

## Troubleshooting

### Empty result set

- Check `componentKeys=$SONARCLOUD_PROJECT_KEY` exactly matches the SonarCloud
  project key.
- Confirm the project is public or that your environment provides whatever
  authentication your SonarCloud setup requires.

### Counts do not match the UI

- Re-run the facet query after the latest analysis completes.
- Check whether the UI is filtered by branch, status, or issue type.

### Need machine-readable output

Keep the raw JSON and post-process with `jq` instead of scraping HTML.

## Guardrails

- Prefer `api/issues/search`; do not scrape the web UI.
- Use `facets=severities` for counts and `severities=` for issue detail pages.
- Use `issues=<issue-key>&additionalFields=_all` for a single detailed issue.
- Use `api/sources/lines` for code snippets and strip SonarCloud HTML tags
  before reporting.
- Use `api/rules/show?organization=...&key=...` for rule metadata.
- If the prompt does not include a project key, ask for it instead of guessing.
- Report the query date whenever sharing counts because SonarCloud data changes
  after each analysis.

## PR Fix Workflow — Parallel Subagents

When fixing SonarCloud violations for a pull request, always use parallel
subagents to maximize throughput. Proven workflow from PR #3 (2026-04-10):

### Step 1: Enumerate all issues

Fetch all PR issues and security hotspots in one pass:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER&ps=500" \
  | jq '[.issues[] | {key, severity, type, file: (.component | split(":")[1]), line, rule, message}]'
```

Group issues by file. Present a complete inventory table to the user before
starting fixes.

### Step 2: Launch parallel subagents grouped by file

Group fixes by file to avoid conflicts. Launch one subagent per file (or per
group of closely related files). Each subagent prompt must include:

- The exact file path(s) to modify
- The SonarCloud rule ID (e.g., `S2871`, `S3776`)
- The exact line number and violation message
- A concrete fix description (not just "fix this")
- Instruction to run `npm test` and `npm run lint` after fixing

Example grouping from a real session:

| Agent | Files | Issues |
|-------|-------|--------|
| Agent 1 | `schema_contracts.test.ts` | S2871 (sort), S3358 (ternary) |
| Agent 2 | `gateway_config.ts` | S3776 (complexity), S7741 x7 (typeof) |
| Agent 3 | `api_key_store.ts` | S3776 (complexity) |
| Agent 4 | Remaining files | S7721, S7735, S4325, S7776 |

### Step 3: Commit, push, and verify

After all agents complete:

```bash
# Stage, commit, push
git add -A
git commit -m "Fix SonarCloud violations for PR #N"
git push

# Wait for SonarCloud re-analysis
for i in $(seq 1 30); do
  STATUS=$(gh pr checks $PR_NUMBER --json name,state \
    --jq '.[] | select(.name == "SonarCloud Code Analysis") | .state')
  echo "Attempt $i: $STATUS"
  [ "$STATUS" = "SUCCESS" ] && echo "PASSED" && break
  [ "$STATUS" = "FAILURE" ] && echo "FAILED" && break
  sleep 10
done

# Verify quality gate
curl -sS \
  "$SONARCLOUD_BASE_URL/api/qualitygates/project_status?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER" \
  | jq '.projectStatus | {status, conditions: [.conditions[] | select(.status == "ERROR")]}'
```

If the quality gate still fails (e.g., duplication threshold), fix the
remaining issues and repeat. Common second-pass fixes:

- **Duplication > threshold**: Extract shared test setup into a helper file
  (e.g., `test/integration-setup.ts`). Extract repeated patterns into local
  helper functions.
- **Security hotspots not reviewed**: These are often false positives in test
  files (`Math.random` for temp dirs, hardcoded test IPs). They require manual
  review in the SonarCloud UI or adjusting the project quality gate settings.
- **Ghost issues with `line: null`**: Issues from previous analysis that were
  fixed. SonarCloud API may still return them briefly. Check
  `api/project_pull_requests/list` for the actual `bugs`/`codeSmells` count.

### Common SonarCloud fix patterns (TypeScript)

| Rule | Pattern | Fix |
|------|---------|-----|
| S2871 | `.sort()` without comparator | `.sort((a, b) => a.localeCompare(b))` |
| S3776 | Cognitive complexity too high | Extract helper functions |
| S3358 | Nested ternary | Replace with if/else |
| S7741 | `typeof x !== 'undefined'` | `x !== undefined` or `x === undefined` |
| S7721 | Function defined in wrong scope | Move to outer scope |
| S7735 | Negated condition | Flip condition and swap branches |
| S4325 | Unnecessary type assertion | Remove `as Type` or use `vi.mocked()` |
| S7776 | Array used for lookups | Use `Set` + `.has()` |

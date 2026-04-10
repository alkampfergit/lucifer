---
name: sonar
description: >
  Fetch SonarCloud issues for a project and break them down by severity using
  the SonarCloud Web API. Use when a prompt includes a SonarCloud project key
  and you need current issue counts or issue details for BLOCKER, CRITICAL,
  MAJOR, MINOR, and INFO severities.
metadata:
  author: codex
  version: 1.0.0
  category: workflow
  required-inputs:
    - sonarcloud project key from the user prompt
  outputs:
    - severity counts
    - issue details grouped by severity
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

## Prompt Handling

When the user says something like:

`Check SonarCloud errors for alkampfergit_lucifer`

extract:

- SonarCloud project key: `alkampfergit_lucifer`

Then run the workflow with that key. Never replace the prompt-provided key with
an example key from this skill.

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

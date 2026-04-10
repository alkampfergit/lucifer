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
  version: 2.0.0
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

Query SonarCloud issues and fix violations. Read only what you need.

## Setup

```bash
export SONARCLOUD_PROJECT_KEY='<project-key-from-prompt>'
export SONARCLOUD_BASE_URL=https://sonarcloud.io
```

Do not hardcode the project key. Read it from the user prompt.

## Route by task

| User wants | What to do | Details |
|------------|------------|---------|
| Severity counts | Run the quick query below | This file |
| List issues for a severity | Read [references/api-reference.md](references/api-reference.md) | Steps 1-4 |
| Detailed info for one issue | Read [references/api-reference.md](references/api-reference.md) | Steps 5-8 |
| PR quality gate + issues | Read [references/pr-workflow.md](references/pr-workflow.md) | Full PR analysis |
| Fix PR violations | Read [references/fix-workflow.md](references/fix-workflow.md) | Parallel subagents |
| Fix high/medium/all bugs | Read [references/special-tasks.md](references/special-tasks.md) | Remediation targets |
| Troubleshooting | Read [references/troubleshooting.md](references/troubleshooting.md) | Common problems |

## Quick query: severity counts

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&facets=severities&ps=1" \
  | jq -r '.facets[] | select(.property == "severities") | .values[] | "\(.val)\t\(.count)"'
```

## Quick query: list issues for one severity

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=CRITICAL&ps=100" \
  | jq '[.issues[] | {key, severity, type, file: (.component | split(":")[1]), line, rule, message}]'
```

## Helper scripts

| Script | Purpose |
|--------|---------|
| `scripts/fetch_issue_details.sh PROJECT_KEY ISSUE_KEY` | Full detail for one issue (metadata + snippet + suggested fix) |
| `scripts/fetch_pr_analysis.sh PROJECT_KEY [PR_NUMBER]` | PR quality gate + issues + hotspots + verified analysis URL |
| `scripts/fetch_hotspot_details.sh PROJECT_KEY HOTSPOT_KEY PR_NUMBER` | Full detail for one security hotspot |

## Guardrails

- Use `api/issues/search`, never scrape the web UI.
- If the prompt does not include a project key, ask for it.
- Report the query date when sharing counts (data changes after each analysis).
- Sonar `type` (BUG/CODE_SMELL/VULNERABILITY) and `severity` (BLOCKER..INFO) are different dimensions. Report them separately.

# Special Tasks

## Fix high-severity, medium-severity, and all BUG issues

Interpret Sonar severity language:

- `high` = `BLOCKER` + `CRITICAL`
- `medium` = `MAJOR`
- `all bugs` = any issue with `type=BUG`, regardless of severity

Build the target set:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&ps=500&additionalFields=_all" \
  | jq '.issues | map(select(.type == "BUG" or .severity == "BLOCKER" or .severity == "CRITICAL" or .severity == "MAJOR")) | unique_by(.key)'
```

Report in this order: BUG issues first, then remaining BLOCKER, CRITICAL, MAJOR.

For each issue, report: `key`, `type`, `severity`, `component`, `line`,
`rule`, `message`, `effort`.

Do not claim there are bugs just because there are critical code smells. Sonar
`type` and `severity` are different dimensions.

If no issues match, say so and include the full severity/type counts.

## Prompt handling

| User says | Extract | Action |
|-----------|---------|--------|
| "Check SonarCloud errors for X" | project key: X | Run severity counts + issue list |
| "Fix high and medium Sonar issues for X" | project key: X, task: remediation | Fetch, filter, report, fix in priority order |
| "Check Sonar for the current PR" | project key from prompt, task: PR analysis | Use [references/pr-workflow.md](pr-workflow.md) |

Never replace the prompt-provided key with an example key.

## Output shape

### Summary report

Group by severity, include per issue: `severity`, `component`, `line`, `rule`,
`message`.

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=MAJOR&ps=100" \
  | jq -r '.issues[] | {severity, component, line: (.line // 0), rule, message}'
```

### Detailed violation report

Include: `severity`, `type`, `component`, `line`, `rule`, `message`, `flows`,
`snippet`, `rule metadata`, `suggested fix`.

### PR analysis report

Include: `pr.number`, `analysis.analysisUrl`, `analysis.verified`,
`qualityGate.status`, failing conditions, `issues.total`, `hotspots.total`.

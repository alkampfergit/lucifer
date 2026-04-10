# SonarCloud API Reference

All commands assume these are set:

```bash
export SONARCLOUD_PROJECT_KEY='<key>'
export SONARCLOUD_BASE_URL=https://sonarcloud.io
```

## Step 1: Fetch severity totals

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&facets=severities&ps=1"
```

Returns a `facets` section with counts for: `BLOCKER`, `CRITICAL`, `MAJOR`,
`MINOR`, `INFO`.

## Step 2: Fetch issues for one severity

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=CRITICAL&ps=100" \
  | jq -r '.issues[] | [.severity, .component, (.line // 0), .rule, .message] | @tsv'
```

Replace `CRITICAL` with any supported severity.

## Step 3: Fetch all severities in one loop

```bash
for severity in BLOCKER CRITICAL MAJOR MINOR INFO; do
  echo "== $severity =="
  curl -sS \
    "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=$severity&ps=100" \
    | jq -r '"total=" + (.total | tostring), (.issues[]? | [.component, (.line // 0), .rule, .message] | @tsv)'
  echo
done
```

## Step 4: Handle pagination

If a severity has more than 100 issues, page with `p` and `ps`:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&severities=MAJOR&ps=100&p=2"
```

Read `.paging.pageIndex`, `.paging.pageSize`, `.paging.total`.

## Step 5: Fetch detailed info for one issue

No separate `api/issues/show` on SonarCloud. Use `issues=<key>` with
`additionalFields=_all`:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&issues=$ISSUE_KEY&additionalFields=_all&ps=1"
```

Useful fields: `.issues[0].message`, `.textRange`, `.flows`, `.impacts`,
`.cleanCodeAttribute`, `.tags`, `.rule`, `.organization`.

## Step 6: Fetch the failing code snippet

Use the issue's `component` key and a line range:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/sources/lines?key=$COMPONENT_KEY&from=$FROM_LINE&to=$TO_LINE" \
  | jq -r '.sources[] | "\(.line):\(.code)"' \
  | perl -pe 's/<[^>]+>//g; s/&gt;/>/g; s/&lt;/</g; s/&amp;/&/g; s/&quot;/"/g; s/&#39;/'"'"'/g;'
```

SonarCloud returns HTML-marked code. The `perl` command strips tags.

## Step 7: Fetch rule metadata

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/rules/show?organization=$ORGANIZATION_KEY&key=$RULE_KEY"
```

Useful fields: `.rule.name`, `.rule.severity`, `.rule.type`, `.rule.tags`,
`.rule.impacts`, `.rule.remFnType`, `.rule.remFnBaseEffort`.

If SonarCloud does not expose a prose fix recipe, use the issue message +
source snippet + flow locations + rule metadata to propose the fix.

## Step 8: Use the helper script

Wraps issue + rule + snippet into one command:

```bash
.claude/skills/sonar/scripts/fetch_issue_details.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$ISSUE_KEY"
```

Returns: issue metadata, flow locations, rule metadata, plain-text snippet,
and a `suggestedFix` field.

For PR-scoped issues, add the PR number:

```bash
.claude/skills/sonar/scripts/fetch_issue_details.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$ISSUE_KEY" \
  2 \
  "$PR_NUMBER"
```

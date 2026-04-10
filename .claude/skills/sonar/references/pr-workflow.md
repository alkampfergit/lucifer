# PR Analysis Workflow

Get SonarCloud results for a pull request.

## Step 1: Resolve the PR number

Use `gh` to get the PR from the current branch:

```bash
gh pr view --json number,url,headRefName,baseRefName,headRefOid,state
```

Or for a specific PR:

```bash
gh pr view <pr-number> --json number,url,headRefName,baseRefName,headRefOid,state
```

## Step 2: Fetch PR analysis from SonarCloud

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/project_pull_requests/list?project=$SONARCLOUD_PROJECT_KEY"
```

Select the PR whose `.key` matches the GitHub PR number.

## Step 3: Fetch quality gate

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/qualitygates/project_status?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER"
```

## Step 4: Fetch PR issues

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/issues/search?componentKeys=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER&ps=500&additionalFields=_all"
```

## Step 5: Fetch PR security hotspots

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/hotspots/search?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER&ps=500"
```

## Step 6: Use the helper script

Combines all of the above into one call:

```bash
.claude/skills/sonar/scripts/fetch_pr_analysis.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$PR_NUMBER"
```

Omit PR number to auto-detect from current branch:

```bash
.claude/skills/sonar/scripts/fetch_pr_analysis.sh \
  "$SONARCLOUD_PROJECT_KEY"
```

## Step 7: Verify the SonarCloud analysis link

The analysis link is verified when all three checks pass:

1. `gh` shows a `SonarCloud Code Analysis` check run on the PR
2. `api/project_pull_requests/list` contains the same PR number
3. The canonical URL returns HTTP 200:

```bash
analysis_url="$SONARCLOUD_BASE_URL/project/overview?id=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER"
curl -sS -o /dev/null -w '%{http_code}\n' "$analysis_url"
```

`fetch_pr_analysis.sh` performs all three checks automatically.

## Step 8: Get detail for PR hotspots

```bash
.claude/skills/sonar/scripts/fetch_hotspot_details.sh \
  "$SONARCLOUD_PROJECT_KEY" \
  "$HOTSPOT_KEY" \
  "$PR_NUMBER" \
  2
```

Returns: hotspot metadata, rule metadata, risk description, fix
recommendations, PR-scoped snippet, and `suggestedFix`.

# Troubleshooting

## Empty result set

- Check `componentKeys=$SONARCLOUD_PROJECT_KEY` exactly matches the SonarCloud
  project key.
- Confirm the project is public or that your environment provides whatever
  authentication your SonarCloud setup requires.

## Counts do not match the UI

- Re-run the facet query after the latest analysis completes.
- Check whether the UI is filtered by branch, status, or issue type.

## Need machine-readable output

Keep the raw JSON and post-process with `jq` instead of scraping HTML.

## Ghost issues after fix

After fixing issues, the SonarCloud API may still return old issues with
`line: null`. These are resolved issues that haven't been cleaned up yet.

Check the actual counts via the PR summary instead:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/project_pull_requests/list?project=$SONARCLOUD_PROJECT_KEY" \
  | jq '.pullRequests[] | select(.key == "PR_NUMBER") | .status'
```

The `.status.bugs`, `.status.codeSmells` fields reflect the true current state.

## Quality gate shows ERROR but all issues are fixed

Check which conditions are failing:

```bash
curl -sS \
  "$SONARCLOUD_BASE_URL/api/qualitygates/project_status?projectKey=$SONARCLOUD_PROJECT_KEY&pullRequest=$PR_NUMBER" \
  | jq '.projectStatus.conditions[] | select(.status == "ERROR")'
```

Common non-issue failures:
- `new_duplicated_lines_density` -- reduce test duplication by extracting helpers
- `new_security_hotspots_reviewed` -- mark false positives in SonarCloud UI
- `new_reliability_rating` -- check for remaining BUGs (type, not severity)

## Duplication API

Find which files have duplicated blocks:

```bash
COMP_KEY="$SONARCLOUD_PROJECT_KEY:path/to/file.ts"
curl -sS "$SONARCLOUD_BASE_URL/api/duplications/show?key=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$COMP_KEY', safe=''))")&pullRequest=$PR_NUMBER" \
  | jq '.duplications[] | {blocks: [.blocks[] | {ref: ._ref, startLine: .from, size: .size}]}'
```

The `_ref` values map to files listed in the `.files` object of the response.

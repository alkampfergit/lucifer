#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <project-key> [pull-request-number]" >&2
  exit 1
fi

project_key="$1"
requested_pr_number="${2:-}"
base_url="${SONARCLOUD_BASE_URL:-https://sonarcloud.io}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pr_json="$tmp_dir/pr.json"
repo_json="$tmp_dir/repo.json"
checks_json="$tmp_dir/checks.json"
pull_requests_json="$tmp_dir/pull_requests.json"
quality_gate_json="$tmp_dir/quality_gate.json"
issues_json="$tmp_dir/issues.json"
hotspots_json="$tmp_dir/hotspots.json"

if [[ -n "$requested_pr_number" ]]; then
  gh pr view "$requested_pr_number" \
    --json number,url,headRefName,baseRefName,headRefOid,state \
    >"$pr_json"
else
  gh pr view \
    --json number,url,headRefName,baseRefName,headRefOid,state \
    >"$pr_json"
fi

gh repo view --json nameWithOwner,url,defaultBranchRef >"$repo_json"

pr_number="$(jq -r '.number' "$pr_json")"

if [[ "$pr_number" == "null" || -z "$pr_number" ]]; then
  echo "Could not determine the current PR number via gh." >&2
  exit 1
fi

gh pr view "$pr_number" --json statusCheckRollup >"$checks_json"

curl -sS "$base_url/api/project_pull_requests/list?project=$project_key" >"$pull_requests_json"

if ! jq -e --arg pr "$pr_number" '.pullRequests[] | select(.key == $pr)' "$pull_requests_json" >/dev/null; then
  echo "No SonarCloud PR analysis found for project '$project_key' and PR '$pr_number'." >&2
  exit 1
fi

curl -sS \
  "$base_url/api/qualitygates/project_status?projectKey=$project_key&pullRequest=$pr_number" \
  >"$quality_gate_json"

issues_pages="$(curl -sS \
  "$base_url/api/issues/search?componentKeys=$project_key&pullRequest=$pr_number&ps=500&additionalFields=_all")"
printf '%s' "$issues_pages" >"$issues_json"

hotspots_pages="$(curl -sS \
  "$base_url/api/hotspots/search?projectKey=$project_key&pullRequest=$pr_number&ps=500")"
printf '%s' "$hotspots_pages" >"$hotspots_json"

analysis_url="$base_url/project/overview?id=$project_key&pullRequest=$pr_number"
analysis_status="$(curl -sS -o /dev/null -w '%{http_code}' "$analysis_url")"

jq -n \
  --slurpfile pr "$pr_json" \
  --slurpfile repo "$repo_json" \
  --slurpfile checks "$checks_json" \
  --slurpfile pullRequests "$pull_requests_json" \
  --slurpfile qualityGate "$quality_gate_json" \
  --slurpfile issues "$issues_json" \
  --slurpfile hotspots "$hotspots_json" \
  --arg analysisUrl "$analysis_url" \
  --arg analysisStatus "$analysis_status" \
  --arg prNumber "$pr_number" \
  '{
    repository: {
      nameWithOwner: $repo[0].nameWithOwner,
      url: $repo[0].url,
      defaultBranch: $repo[0].defaultBranchRef.name
    },
    pr: $pr[0],
    github: {
      sonarCheck: (
        $checks[0].statusCheckRollup
        | map(select(.name == "SonarCloud Code Analysis"))[0]
      )
    },
    analysis: {
      verified: (
        (($checks[0].statusCheckRollup | map(select(.name == "SonarCloud Code Analysis")) | length) > 0)
        and (($pullRequests[0].pullRequests | map(select(.key == $prNumber)) | length) > 0)
        and ($analysisStatus == "200")
      ),
      analysisUrl: $analysisUrl,
      verification: {
        githubCheckFound: (($checks[0].statusCheckRollup | map(select(.name == "SonarCloud Code Analysis")) | length) > 0),
        sonarPullRequestFound: (($pullRequests[0].pullRequests | map(select(.key == $prNumber)) | length) > 0),
        analysisUrlHttpStatus: ($analysisStatus | tonumber)
      },
      sonarPullRequest: (
        $pullRequests[0].pullRequests
        | map(select(.key == $prNumber))[0]
      )
    },
    qualityGate: $qualityGate[0].projectStatus,
    issues: {
      total: $issues[0].total,
      paging: $issues[0].paging,
      issues: $issues[0].issues
    },
    hotspots: {
      total: $hotspots[0].paging.total,
      paging: $hotspots[0].paging,
      hotspots: $hotspots[0].hotspots
    }
  }'

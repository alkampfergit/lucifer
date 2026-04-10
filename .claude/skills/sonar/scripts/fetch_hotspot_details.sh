#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "Usage: $0 <project-key> <hotspot-key> [pull-request] [context-lines]" >&2
  exit 1
fi

project_key="$1"
hotspot_key="$2"
pull_request="${3:-}"
context_lines="${4:-2}"
base_url="${SONARCLOUD_BASE_URL:-https://sonarcloud.io}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

hotspot_json="$tmp_dir/hotspot.json"
rule_json="$tmp_dir/rule.json"
snippet_json="$tmp_dir/snippet.json"
snippet_text="$tmp_dir/snippet.txt"
suggested_fix_text="$tmp_dir/suggested_fix.txt"

curl -sS "$base_url/api/hotspots/show?hotspot=$hotspot_key" >"$hotspot_json"

if [[ "$(jq -r '.key // empty' "$hotspot_json")" != "$hotspot_key" ]]; then
  echo "Hotspot not found for project '$project_key': $hotspot_key" >&2
  exit 1
fi

organization="$(jq -r '.project.organization' "$hotspot_json")"
rule_key="$(jq -r '.rule.key' "$hotspot_json")"
component_key="$(jq -r '.component.key' "$hotspot_json")"
component_pr="$(jq -r '.component.pullRequest // empty' "$hotspot_json")"
message="$(jq -r '.message' "$hotspot_json")"
start_line="$(jq -r '.textRange.startLine // .line // 1' "$hotspot_json")"
end_line="$(jq -r '.textRange.endLine // .line // .textRange.startLine // 1' "$hotspot_json")"

effective_pr="$pull_request"
if [[ -z "$effective_pr" && -n "$component_pr" && "$component_pr" != "null" ]]; then
  effective_pr="$component_pr"
fi

from_line="$(( start_line > context_lines ? start_line - context_lines : 1 ))"
to_line="$(( end_line + context_lines ))"

curl -sS \
  "$base_url/api/rules/show?organization=$organization&key=$rule_key" \
  >"$rule_json"

snippet_query="$base_url/api/sources/lines?key=$component_key&from=$from_line&to=$to_line"
if [[ -n "$effective_pr" ]]; then
  snippet_query="${snippet_query}&pullRequest=${effective_pr}"
fi
curl -sS "$snippet_query" >"$snippet_json"

jq -r '.sources[] | "\(.line):\(.code)"' "$snippet_json" \
  | perl -pe 's/<[^>]+>//g; s/&gt;/>/g; s/&lt;/</g; s/&amp;/&/g; s/&quot;/"/g; s/&#39;/'"'"'/g;' \
  >"$snippet_text"

case "$rule_key" in
  "githubactions:S7637")
    cat >"$suggested_fix_text" <<'EOF'
Pin the referenced GitHub Action to a full commit SHA instead of a floating tag such as `@v3` or `@main`. Keep the human-readable version in a comment if needed, but the `uses:` reference itself should point to the exact reviewed commit.
EOF
    ;;
  *)
    cat >"$suggested_fix_text" <<EOF
Start from the hotspot message and the flagged snippet: ${rule_key} says "${message:-Review the hotspot payload.}" Review whether the code is safe in this context and either harden it or document the accepted risk before marking the hotspot reviewed.
EOF
    ;;
esac

jq -n \
  --slurpfile hotspot "$hotspot_json" \
  --slurpfile rule "$rule_json" \
  --rawfile snippet "$snippet_text" \
  --rawfile suggestedFix "$suggested_fix_text" \
  --arg fromLine "$from_line" \
  --arg toLine "$to_line" \
  --arg projectKey "$project_key" \
  --arg pullRequest "$effective_pr" \
  '{
    hotspot: {
      key: $hotspot[0].key,
      projectKey: $projectKey,
      pullRequest: $pullRequest,
      component: $hotspot[0].component.key,
      path: $hotspot[0].component.path,
      line: $hotspot[0].line,
      textRange: $hotspot[0].textRange,
      status: $hotspot[0].status,
      ruleKey: $hotspot[0].rule.key,
      message: $hotspot[0].message,
      securityCategory: $hotspot[0].rule.securityCategory,
      vulnerabilityProbability: $hotspot[0].rule.vulnerabilityProbability,
      riskDescription: $hotspot[0].rule.riskDescription,
      vulnerabilityDescription: $hotspot[0].rule.vulnerabilityDescription,
      fixRecommendations: $hotspot[0].rule.fixRecommendations
    },
    rule: {
      key: $rule[0].rule.key,
      name: $rule[0].rule.name,
      severity: $rule[0].rule.severity,
      type: $rule[0].rule.type,
      langName: $rule[0].rule.langName,
      cleanCodeAttribute: $rule[0].rule.cleanCodeAttribute,
      cleanCodeAttributeCategory: $rule[0].rule.cleanCodeAttributeCategory,
      impacts: $rule[0].rule.impacts,
      tags: $rule[0].rule.tags,
      sysTags: $rule[0].rule.sysTags
    },
    snippet: {
      fromLine: ($fromLine | tonumber),
      toLine: ($toLine | tonumber),
      text: $snippet
    },
    suggestedFix: ($suggestedFix | sub("\n$"; ""))
  }'

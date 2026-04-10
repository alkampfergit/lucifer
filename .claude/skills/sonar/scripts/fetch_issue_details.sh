#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "Usage: $0 <project-key> <issue-key> [context-lines] [pull-request]" >&2
  exit 1
fi

project_key="$1"
issue_key="$2"
context_lines="${3:-2}"
pull_request="${4:-${SONARCLOUD_PULL_REQUEST:-}}"
base_url="${SONARCLOUD_BASE_URL:-https://sonarcloud.io}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

issue_json="$tmp_dir/issue.json"
rule_json="$tmp_dir/rule.json"
snippet_json="$tmp_dir/snippet.json"
snippet_text="$tmp_dir/snippet.txt"
suggested_fix_text="$tmp_dir/suggested_fix.txt"

issue_query="$base_url/api/issues/search?componentKeys=$project_key&issues=$issue_key&additionalFields=_all&ps=1"
if [[ -n "$pull_request" ]]; then
  issue_query="${issue_query}&pullRequest=${pull_request}"
fi

curl -sS "$issue_query" >"$issue_json"

if [[ "$(jq '.issues | length' "$issue_json")" -eq 0 ]]; then
  echo "Issue not found for project '$project_key': $issue_key" >&2
  exit 1
fi

organization="$(jq -r '.issues[0].organization' "$issue_json")"
rule_key="$(jq -r '.issues[0].rule' "$issue_json")"
component_key="$(jq -r '.issues[0].component' "$issue_json")"
issue_message="$(jq -r '.issues[0].message' "$issue_json")"
start_line="$(jq -r '.issues[0].textRange.startLine // .issues[0].line // 1' "$issue_json")"
end_line="$(jq -r '.issues[0].textRange.endLine // .issues[0].line // .issues[0].textRange.startLine // 1' "$issue_json")"

from_line="$(( start_line > context_lines ? start_line - context_lines : 1 ))"
to_line="$(( end_line + context_lines ))"

curl -sS \
  "$base_url/api/rules/show?organization=$organization&key=$rule_key" \
  >"$rule_json"

snippet_query="$base_url/api/sources/lines?key=$component_key&from=$from_line&to=$to_line"
if [[ -n "$pull_request" ]]; then
  snippet_query="${snippet_query}&pullRequest=${pull_request}"
fi

curl -sS "$snippet_query" >"$snippet_json"

jq -r '.sources[] | "\(.line):\(.code)"' "$snippet_json" \
  | perl -pe 's/<[^>]+>//g; s/&gt;/>/g; s/&lt;/</g; s/&amp;/&/g; s/&quot;/"/g; s/&#39;/'"'"'/g;' \
  >"$snippet_text"

case "$rule_key" in
  "typescript:S3776")
    cat >"$suggested_fix_text" <<'EOF'
Reduce the cognitive complexity of the flagged function by extracting nested validation or branching blocks into small helpers. Start with the branches listed in `flows`, move parsing, auth checks, approval handling, and response mapping into named functions, then keep the route handler focused on orchestration.
EOF
    ;;
  "typescript:S107")
    cat >"$suggested_fix_text" <<'EOF'
Reduce the parameter count by grouping related values into one typed object or by introducing a small dependency/context object. If some parameters are always used together, pass a single options or services structure instead of a long positional list.
EOF
    ;;
  "typescript:S4043")
    cat >"$suggested_fix_text" <<'EOF'
Do not mutate the array inline inside the expression. Assign the reversed value in a separate statement or use `toReversed()` if the runtime target supports it, then use that derived value in the original expression.
EOF
    ;;
  "typescript:S7785")
    cat >"$suggested_fix_text" <<'EOF'
Replace the promise chain with top-level `await` when the surrounding module already supports ESM top-level await. If that is not possible in the current file, move the logic into an async function and await the intermediate result explicitly.
EOF
    ;;
  "typescript:S7773")
    cat >"$suggested_fix_text" <<'EOF'
Replace the global numeric helper with the `Number` equivalent that Sonar recommends. Use `Number.parseInt(...)` instead of `parseInt(...)`, and `Number.isNaN(...)` instead of `isNaN(...)`, so numeric intent stays explicit and safer.
EOF
    ;;
  "typescript:S7741")
    cat >"$suggested_fix_text" <<'EOF'
Compare directly with `undefined` instead of using `typeof` when the variable is already safely in scope. This keeps the condition simpler and avoids an unnecessary type-style check.
EOF
    ;;
  "typescript:S7749")
    cat >"$suggested_fix_text" <<'EOF'
Rewrite the numeric literal using standard digit grouping. Remove unusual underscore grouping and use a conventional representation so the value is immediately readable.
EOF
    ;;
  "typescript:S4325")
    cat >"$suggested_fix_text" <<'EOF'
Remove the unnecessary type assertion and pass the original expression directly. Keep the assertion only if it changes the effective type at the call site, which Sonar indicates is not happening here.
EOF
    ;;
  "typescript:S6759")
    cat >"$suggested_fix_text" <<'EOF'
Mark the component props as read-only. In TypeScript, wrap the props type with `Readonly<...>` or declare the individual props as `readonly` to make the component contract immutable.
EOF
    ;;
  "css:S7924")
    cat >"$suggested_fix_text" <<'EOF'
Adjust either the text color or the background color until the contrast ratio meets accessibility requirements. Prefer changing tokens or CSS variables at the source so the fix applies consistently across the UI.
EOF
    ;;
  *)
    cat >"$suggested_fix_text" <<EOF
Start from the Sonar message and the flagged snippet: ${rule_key} says "${issue_message:-Review the issue message in the payload.}" Fix the smallest code region that satisfies the rule, then rerun analysis to confirm the issue disappears without changing behavior.
EOF
    ;;
esac

jq -n \
  --slurpfile issue "$issue_json" \
  --slurpfile rule "$rule_json" \
  --rawfile snippet "$snippet_text" \
  --rawfile suggestedFix "$suggested_fix_text" \
  --arg from_line "$from_line" \
  --arg to_line "$to_line" \
  '{
    issue: {
      key: $issue[0].issues[0].key,
      pullRequest: ($issue[0].issues[0].pullRequest // empty),
      rule: $issue[0].issues[0].rule,
      severity: $issue[0].issues[0].severity,
      type: $issue[0].issues[0].type,
      component: $issue[0].issues[0].component,
      line: ($issue[0].issues[0].line // 0),
      textRange: $issue[0].issues[0].textRange,
      message: $issue[0].issues[0].message,
      effort: $issue[0].issues[0].effort,
      impacts: $issue[0].issues[0].impacts,
      cleanCodeAttribute: $issue[0].issues[0].cleanCodeAttribute,
      cleanCodeAttributeCategory: $issue[0].issues[0].cleanCodeAttributeCategory,
      tags: $issue[0].issues[0].tags,
      flows: $issue[0].issues[0].flows
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
      sysTags: $rule[0].rule.sysTags,
      remediation: {
        functionType: $rule[0].rule.remFnType,
        baseEffort: $rule[0].rule.remFnBaseEffort,
        debtOverloaded: $rule[0].rule.debtOverloaded
      }
    },
    snippet: {
      fromLine: ($from_line | tonumber),
      toLine: ($to_line | tonumber),
      text: $snippet
    },
    suggestedFix: ($suggestedFix | sub("\n$"; ""))
  }'

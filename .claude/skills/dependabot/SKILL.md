---
name: dependabot
description: >
  Triage and fix Dependabot security alerts for this repository using `gh` and
  `npm`. Use when the user asks to review the Dependabot security tab, clear
  open alerts, merge Dependabot PRs, or explain why an alert is safe to
  dismiss. Pairs with the `gh-cli-guide` skill for the underlying API calls
  and with `github-pr-fixer` when a Dependabot PR needs to be driven to green.
metadata:
  author: claude
  version: 1.0.0
  category: workflow
---

# Skill: Dependabot

Inspect and resolve the security alerts at
`https://github.com/<owner>/<repo>/security/dependabot` by classifying each
open alert and picking the smallest fix that closes it.

## Operating contract — zero console interaction

This skill runs **without asking the console anything**. From the moment it
starts, every decision surface is the PR:

- The plan is posted as the PR body.
- Every clarification the skill would otherwise ask the user is posted as a
  PR comment instead.
- The skill self-enters a 5-minute polling loop and keeps going until the PR
  is merged or closed.
- If you hit an ambiguous situation, your options are: (a) make the safe
  default and flag it in a PR comment, or (b) post the question to the PR
  and wait for the next poll. Never return to the console to ask.

The only console output is a one-line handoff: the PR URL plus the polling
cadence. After that, the skill is silent until the PR closes.

## Inputs and assumptions

- `gh` is authenticated with `security_events` (or `repo`) scope so
  `/dependabot/alerts` is reachable. Verify with `gh auth status`.
- The repo's default branch is where fixes land (check with
  `gh repo view --json defaultBranchRef`).
- For Node projects the manifest is `package.json` / `package-lock.json` and
  `npm audit --json` complements the GitHub view.
- The relevant `gh` command patterns live in
  [.claude/skills/gh-cli-guide/SKILL.md](../gh-cli-guide/SKILL.md) — this
  skill assumes you already know how to call `gh api`.

## Step 1: Inventory open alerts

```bash
gh api repos/<owner>/<repo>/dependabot/alerts --paginate \
  --jq '.[] | select(.state=="open") | {
    number, severity: .security_advisory.severity,
    package: .dependency.package.name,
    manifest: .dependency.manifest_path,
    scope: .dependency.scope,
    summary: .security_advisory.summary,
    fixed_in: (.security_advisory.vulnerabilities[]
                | select(.package.name==.dependency.package.name)
                | .first_patched_version.identifier) // null,
    url: .html_url
  }'
```

`scope` is `runtime` or `development`. A `development`-only alert has
different blast radius — record it, but do not over-invest.

Also list any Dependabot-authored PRs already open:

```bash
gh pr list --state open --json number,title,author,statusCheckRollup \
  --jq '.[] | select(.author.login=="app/dependabot") |
    {number,title,checks: [.statusCheckRollup[].conclusion]}'
```

## Step 2: Classify each alert

| Signal | Treatment |
|--------|-----------|
| Existing Dependabot PR, green checks | Merge it (Step 4a) |
| Direct dependency listed in `package.json` | Bump the declared range (Step 4b) |
| Transitive, patched version exists | Add an `overrides` entry (Step 4c) |
| Transitive, no safe fix and dev-only | Document + dismiss with reason (Step 4d) |
| Not applicable / test fixture / duplicate | Dismiss with the right reason (Step 4d) |

Get the full advisory for an alert before deciding:

```bash
gh api repos/<owner>/<repo>/dependabot/alerts/<N> \
  --jq '{summary: .security_advisory.summary,
         cvss: .security_advisory.cvss.score,
         vulnerable_range: .security_vulnerability.vulnerable_version_range,
         first_patched: .security_vulnerability.first_patched_version.identifier,
         description: .security_advisory.description}'
```

Cross-check with `npm audit --json` so you catch alerts that share a single
underlying bump. One Dependabot alert per CVE, but one dependency bump often
closes several alerts at once.

## Step 3: Branch and open the PR immediately

Do **not** wait for local validation before opening the PR. Use the PR as the
discussion board with the alert owner — every subsequent decision (which
bumps to take, which alerts to dismiss, whether to cross a major) is agreed
in PR comments, not in the console.

```bash
git checkout -b fix/dependabot-<short-label>
# No code changes yet — push an empty commit so the PR has somewhere to land.
git commit --allow-empty -m "chore(security): open Dependabot triage PR"
git push -u origin fix/dependabot-<short-label>

gh pr create --draft --title "chore(security): Dependabot triage <date>" \
  --body-file <(cat <<'EOF'
## Plan

Classified alerts (see table) and the fix I intend for each. Nothing is
applied yet — this PR is the discussion board. Reply inline or as a PR
comment to approve, redirect, or block any row.

| # | Severity | Package | Manifest | Scope | Intended fix |
|---|----------|---------|----------|-------|--------------|
| 20 | medium | axios | package-lock.json | dev | override to ^1.x / dismiss if major breaks tests |
| ... | | | | | |

## Checkpoints

- [ ] Plan approved in comments
- [ ] Fixes applied and pushed
- [ ] `npm audit`, lint, test, build all green
- [ ] Security tab reconciled
EOF
)
```

Record the PR number and URL — the remaining steps poll it.

## Step 4: Self-enter the 5-minute polling loop

The skill must start the loop itself. Do not print instructions asking the
user to run `/loop`. Invoke the `loop` skill directly, passing a polling
command that re-enters this skill's poll phase:

```
Skill("loop", args="5m dependabot poll PR <N>")
```

The `loop` skill will fire the polling command every 5 minutes, including
the first cycle immediately after the PR is opened. The skill is now
hands-free — the console can be closed.

### What each poll cycle does

```bash
# New issue-level comments on the PR
gh api repos/<owner>/<repo>/issues/<N>/comments \
  --jq '.[] | {id, user: .user.login, created_at, body: (.body[:300])}'

# Review-level comments (line-attached feedback)
gh api repos/<owner>/<repo>/pulls/<N>/comments \
  --jq '.[] | {id, user: .user.login, path, line, body}'

# Review-level state (approved, requested changes, etc.)
gh api repos/<owner>/<repo>/pulls/<N>/reviews \
  --jq '.[] | {id, user: .user.login, state, submitted_at, body}'

# Current PR state — stop the loop if closed or merged
gh pr view <N> --json state,mergedAt,closedAt
```

Persist a watermark (highest comment id seen) in a scratch file inside the
PR branch, e.g. `.dependabot-watermark`, so repeated polls do not redo
work. Commit the watermark updates to the branch — this keeps state across
loop iterations even if the skill process restarts.

### Decision rules inside the loop

| Signal in the poll | Action |
|--------------------|--------|
| New comment approving a row | Apply that row's fix (Step 5), push, comment back with the commit SHA |
| New comment redirecting a row | Update the PR body plan table to match, then apply the new direction |
| New comment blocking a row | Mark that row as skipped in the plan and move on |
| Line-level review comment on a file change | Amend the affected file, push, reply to the comment with the commit SHA |
| PR closed with no merge | Exit the loop, delete the branch, do nothing else |
| PR merged | Reconcile the security tab (Step 6), then exit the loop |
| No new signal for 60 min (12 cycles) | Post one nudge comment pointing at unresolved rows. Do not nag again before another 60 minutes |

Never ask the console a question. If the skill is blocked by missing
information, it must post the question as a PR comment and keep polling.

### Stopping the loop

The loop exits when `gh pr view` reports `state == "MERGED"` or
`state == "CLOSED"`. On exit, run Step 6 if merged, otherwise leave the
branch for the user to inspect.

## Step 5: Apply fixes

### 5a. Merge a clean Dependabot PR

```bash
gh pr checks <N> --watch --fail-fast
gh pr merge <N> --squash --delete-branch
```

Reload the alert list afterwards — GitHub closes the matching alerts
automatically once the PR merges.

### 5b. Bump a direct dependency

Edit `package.json` to the `first_patched_version` (or higher, within the
current major). Then:

```bash
npm install
npm audit --json | jq '.metadata.vulnerabilities'
npm run lint && npm run test && npm run build
```

If the patch is behind a major bump, do not apply it silently. Post a PR
comment with the proposed bump, affected callers, and the known breaking
changes, and wait for explicit approval in a later poll cycle.

### 5c. Add an npm override for a transitive

Only use this when a direct bump is not available. Keep overrides tightly
scoped — prefer the narrowest version range that closes the alert.

```jsonc
// package.json
"overrides": {
  "body-parser": "^1.20.3",
  "cookie": "^0.7.0"
}
```

Run `npm install`, then `npm audit` + the full `npm run lint && npm run test
&& npm run build` pipeline. If a test breaks, widen the override one minor
version at a time; do not silently drop it.

### 5d. Dismiss an alert with a reason

Only when the alert is genuinely inapplicable or the fix is impossible.
Record the reason in the PR description too.

```bash
gh api -X PATCH repos/<owner>/<repo>/dependabot/alerts/<N> \
  -f state=dismissed \
  -f dismissed_reason='tolerable_risk' \
  -f dismissed_comment='Dev-only transitive via telegram-test-api 4.2.1. Latest upstream still pins axios 0.27. Risk contained to the test harness.'
```

Valid `dismissed_reason` values: `fix_started`, `inaccurate`, `no_bandwidth`,
`not_used`, `tolerable_risk`.

## Step 6: Hand off to github-pr-fixer

Once the local pipeline is green and the fixes are pushed:

1. `npm audit` — confirm the counts match what you expected to fix.
2. `gh api repos/<owner>/<repo>/dependabot/alerts --jq '[.[] | select(.state=="open")] | length'` — compare before/after.
3. Update the PR body with the final resolution table (`alert # → fix
   (bump / override / merged #X / dismissed)`) and flip it to ready with
   `gh pr ready <N>`.
4. **Stop the 5-minute poll.** Call `CronDelete` with the job id from
   Step 4 so the dependabot skill is no longer polling.
5. Post a hand-off comment on the PR: "Local pipeline green, handing off
   to `github-pr-fixer`."
6. Invoke the `github-pr-fixer` skill with the PR number. It takes
   ownership from here: waiting for CI checks, responding to reviewer
   comments, and driving the PR to merge.
7. After merge, `github-pr-fixer` will report back. Re-run the alert
   inventory query to confirm the GitHub security tab is actually green.

## Guardrails

- Do not downgrade a dependency because `npm audit` suggests an older "fix"
  version. That happens when the advisory's auto-fix graph is stale — prefer
  the `first_patched_version` from the advisory or the current major.
- Do not add `npm audit fix --force` to CI. A force-fix can cross majors on
  production deps without review.
- Do not dismiss runtime alerts without explicit approval posted **in a PR
  comment**. Never use the console channel to confirm a dismissal.
- Do not bundle a security fix with an unrelated feature change.
- Do not silently remove an `overrides` entry — leave a comment (or commit
  message) that says which alert it resolved, so a later bump can retire it.

## Related skills

- [gh-cli-guide](../gh-cli-guide/SKILL.md) — canonical `gh` command patterns,
  including the Dependabot / security endpoints.
- [github-pr-fixer](../github-pr-fixer/SKILL.md) — drive a Dependabot PR to
  green if its checks fail.
- [small-change](../small-change/SKILL.md) — preferred wrapper workflow when
  the fix is a scoped dependency bump.

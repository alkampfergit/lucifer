---
name: gstack-gh
description: Take a single GitHub issue (by number or URL) and drive it through an end-to-end flow (branch → plan → build → test → PR) using the `gh` CLI. All user interaction happens through issue comments, never the console. Use when the user says "implement issue #N", "work this GH issue", "take issue X end-to-end", or passes a GitHub issue link. For label-based polling across many issues, use `gstack-full` instead.
---

# gstack-gh — one issue, end-to-end

Drive a single GitHub issue through claim → branch → plan → build → test → PR.
This skill is the **sole owner** of the GitHub ticket lifecycle for the issue
it is working on. Every decision, question, status update, and hand-off goes
through the issue (via `gh issue comment`) and the PR it spawns (via
`gh pr comment`). **Nothing is communicated through the Claude console that
would leave the issue out of the loop.**

**Reference skills:**
- `gh-cli-guide/SKILL.md` — canonical `gh` command patterns for every step below.
- `github-pr-fixer/SKILL.md` — the downstream skill that monitors the PR once
  it is open (checks, reviewer comments, release-closure).
- Repo-specific implementation skills: `new-feature`, `bug-fix`, `small-change`,
  `refactor`, `add-domain` — pick the one that matches the issue's nature.

## Inputs (from args)

Accept any of:

- Plain number: `123` (uses current repo)
- Owner/repo plus number: `owner/repo#123`
- Full URL: `https://github.com/owner/repo/issues/123`

Optional args as `key=value`:

- `claim-label` (default `in-progress`)
- `done-label` (default `done`) — only applied after the user confirms closure
- `fail-label` (default `needs-human`)
- `base` branch (default: repo default branch via `gh repo view --json defaultBranchRef`)
- `dry-run=true` — do plan + diff only, no push or PR
- `poll-seconds` (default `60`) — how often to re-fetch issue/PR comments when
  waiting on a human answer

Parse these up-front; confirm resolved values back to the user by posting a
pick-up comment on the issue (see step 2), not by asking in the console.

## Preconditions (fail fast with a clear message)

1. `gh auth status` — abort if not authenticated; tell the user to run
   `! gh auth login`.
2. Working tree is clean (`git status --porcelain` empty). If dirty, stop.
3. Current branch is the repo's default / integration branch. If not, stop.
4. Issue is open, unassigned (or assigned to `@me`), and does NOT already
   carry `claim-label`. If it does, assume another run is in flight and abort.

## Communication protocol — everything goes through the issue

This is a hard rule for this skill and for anything it delegates to:

- **Never** ask the user a question in the chat console. Always post the
  question as a new comment on the issue (or, after the PR exists, on the
  PR) and then wait for an answer on the same thread.
- Prefix every bot comment with a machine-readable marker so you can
  identify your own messages when polling:

  ```
  <!-- gstack:<kind>:<uuid> -->
  ```

  where `<kind>` is one of `status`, `question`, `answer-ack`, `plan`,
  `handoff`, `failure`. Generate a short UUID per question so the answer
  can be correlated.
- When you post a question, end the comment body with the exact line:

  ```
  Reply in a comment on this issue to continue. (gstack will poll every <poll-seconds>s)
  ```

### Polling for an answer

Use this loop. Every iteration sleeps `poll-seconds` (default 60).

```bash
ASKED_AT=$(date -u +%s)
while :; do
  reply=$(gh issue view <N> --repo <owner/repo> --json comments \
    --jq ".comments[]
      | select(.createdAt | fromdateiso8601 > $ASKED_AT)
      | select(.author.login != \"<bot-login>\")
      | .body" | head -n 1)
  if [ -n "$reply" ]; then break; fi
  sleep <poll-seconds>
done
```

When a reply lands:

1. Post an `answer-ack` comment on the issue quoting the relevant part of the
   answer and the decision taken.
2. Resume the flow.
3. If the polling exceeds a sensible cap (default 60 minutes), park the
   issue with `fail-label`, leave a comment explaining the timeout, and
   exit.

> Note for the harness: "poll every 60s" means the skill uses the sleep loop
> above. It does **not** mean creating a cron trigger per question — that
> would fragment the session.

## Flow

### 1. Fetch & understand

Use `gh issue view` (gh-cli-guide → **Issues → View**) to pull
`number,title,body,labels,assignees,state,comments`.

Summarise findings (acceptance criteria, affected areas, linked issues/PRs)
as a **status comment** on the issue. Do not print the summary only to the
console.

### 2. Claim

```bash
gh issue edit <N> --add-assignee @me --add-label <claim-label>
```

Create the working branch **named after the issue number**:

```bash
git checkout -b feature/<N>
git push -u origin feature/<N>   # create the remote ref now, so the PR link works later
```

Then post a pick-up comment on the issue (marker: `gstack:status`) with:

- Branch name: `feature/<N>`
- Base branch
- Resolved args
- Next step (Plan / Build / etc.)

### 3. Plan

For anything touching architecture, public API, new providers, or >5 files:
produce a written plan as a comment on the issue (marker: `gstack:plan`) and
**wait on the issue for approval** using the polling protocol above. Do not
proceed without a reply.

For smaller changes: post a 3-line plan comment and proceed. If `dry-run=true`,
stop after planning and report the plan URL.

Before building, read `AGENTS.md` / `CLAUDE.md` (or equivalents) in the
target repo. Flag any binding constraints (tests required, forbidden files,
required doc updates) in the plan comment.

### 4. Build

Implement on `feature/<N>`. Pick the matching repo skill if one applies:

- `new-feature` for a new capability/endpoint
- `bug-fix` for a defect with reproduction
- `small-change` for a scoped tweak
- `refactor` for behavior-preserving restructure
- `add-domain` for a new bounded context

If the implementation hits a decision you cannot make alone (ambiguous
acceptance criteria, a forced trade-off), **stop and ask via an issue
comment** — do not guess, and do not ask in the console.

### 5. Test

Discover the repo's validation commands (`package.json` scripts, `Makefile`,
`*.sln`, CLAUDE.md / AGENTS.md) and run them locally. Common patterns:

- Node/TS: `npm run lint && npm test && npm run build`
- Python: `pytest` / `ruff check` / etc.
- .NET: `dotnet test` for each target framework configured in the solution

If tests fail, fix them before shipping. Do not mark the issue done with red
tests. Integration or external-API tests run only if the user explicitly
asked in the issue.

### 6. Ship (open the PR)

When the build is green locally, push and open the PR.

```bash
git push                          # feature/<N> already tracked from step 2
gh pr create \
  --head feature/<N> \
  --base <base> \
  --title "<type>(#<N>): <title>" \
  --body-file <(cat <<'EOF'
## Summary
- <what/why, 1-3 bullets>

Closes #<N>

## Test plan
- [ ] <validation commands that were run>
EOF
)
```

- Title: `fix(#<N>): ...` for bug-fix, `feat(#<N>): ...` for new-feature,
  `chore(#<N>): ...` / `refactor(#<N>): ...` etc. as appropriate.
- Body MUST contain `Closes #<N>` — this is the binding that links the PR to
  the issue and auto-closes it on merge.
- Also call `gh issue comment <N> --body "PR: <pr-url>"` (marker:
  `gstack:handoff`) so the issue thread contains an explicit pointer.
- `github-pr-fixer` takes over from here to monitor checks and reviews.

### 7. Hand off to `github-pr-fixer`

Once the PR is open:

1. Post a `gstack:handoff` comment on the issue with the PR URL.
2. Invoke `github-pr-fixer` on the newly-created PR. From this point, any
   further automated work (CI fix rounds, reviewer comments, release
   closure) is owned by that skill — but it inherits the same rule: any
   human question goes through `gh pr comment` on the PR (or the linked
   issue), never through the console, and it polls the same way.

### 8. Closing the PR — explicit user confirmation only

**The PR is never closed, merged, or land-and-deployed automatically.**

- `done-label` is NOT applied at ship time.
- `github-pr-fixer`'s release-closure path runs only when the user issues an
  explicit instruction (in chat, or as a comment on the PR / issue containing
  a phrase like "close this PR", "land it", "release as X.Y.Z").
- When that confirmation arrives, follow
  `github-pr-fixer/references/release-closure.md`, then apply `done-label`
  to the issue and post a final `gstack:status` comment on the issue
  summarising what shipped.

## Failure handling

If any step fails and cannot be recovered automatically:

1. Remove `claim-label`, add `fail-label`.
2. Post a `gstack:failure` comment on the issue with: what failed, what was
   tried, any log excerpts, and what is needed from a human.
3. Leave `feature/<N>` intact (local and remote) so the user can inspect.
4. Exit. Do not pretend success.

## What this skill does NOT do

- Does not ask the user anything through the console — issue/PR comments only.
- Does not merge or close PRs. Closure requires explicit user confirmation.
- Does not re-plan architecture decisions without a human reply on the issue.
- Does not touch `.env` or read secrets.
- Does not run integration tests against real external services unless the
  user explicitly asked on the issue.
- Does not skip the `Closes #<N>` binding — every PR must be linked to its
  issue.

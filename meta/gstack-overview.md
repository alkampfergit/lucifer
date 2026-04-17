# gstack — how the three skills fit together

`gstack` is the label we use for the GitHub-issue-driven automation loop in
this repo. It is not a single skill: it is three skills layered on top of
each other, plus `github-pr-fixer` as a downstream helper when a PR needs
babysitting.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           gstack-full                                │
│   (poller: watch a label, rank issues, pick N, delegate)             │
│                              │                                       │
│                              ▼  one issue at a time                  │
│                         gstack-gh                                    │
│   (per-issue driver: claim → plan → build → test → PR → hand off)    │
│                              │                                       │
│                              ▼  raw gh command patterns              │
│                         gh-cli-guide                                 │
│   (reference manual: issues, PRs, checks, reviews, code scanning)    │
└──────────────────────────────────────────────────────────────────────┘

         If PR checks fail or a reviewer posts comments → github-pr-fixer
```

## Role of each skill

### `gh-cli-guide` — reference only
Canonical syntax for every `gh` command this automation relies on: auth,
issues, PRs, checks, workflow runs, reviews (including the polling template
for bot reviewers like Copilot), code-scanning / check-runs for standalone
security failures, labels, and the REST/GraphQL API. **Never performs
actions.** Every other skill links to named sections here instead of
duplicating command blocks.

### `gstack-gh` — one issue, end-to-end
Takes a single issue identifier (`123`, `owner/repo#123`, or a full URL) and
drives it through:

1. Fetch & understand the issue
2. Claim (`@me` + `claim-label` + pick-up comment)
3. Plan (light inline or formal plan for big changes)
4. Build — delegates to the matching implementation skill
   (`new-feature`, `bug-fix`, `small-change`, `refactor`, `add-domain`)
5. Test — discovers the repo's toolchain (`package.json`, `Makefile`, `*.sln`, ...)
6. Ship — push branch, open PR with `Closes #N`
7. Hand off — comment PR URL on the issue

On failure: swap `claim-label` → `fail-label`, post a detailed comment,
leave the branch intact, surface the failure in chat.

**Never merges.** Merge/land is always a human decision.

### `gstack-full` — label-driven polling orchestrator
Given a `label` and a `repo`, runs a cycle that:

1. Lists open issues with the label, excluding those already carrying
   `claim-label` or `fail-label`
2. Ranks (oldest-first or by priority label)
3. Picks `max-per-cycle` (default 1)
4. Delegates each to `gstack-gh` in `mode=once`
5. Reports one line per issue, returns to scheduler

Three scheduling modes:

| Mode   | How                                                        | When to use                           |
| ------ | ---------------------------------------------------------- | ------------------------------------- |
| `once` | single sweep, then stop                                    | manual trigger / testing              |
| `loop` | `/loop` skill (timed interval or self-paced ScheduleWakeup) | within a session                      |
| `cron` | `CronCreate` / `/schedule` remote agent                    | durable, survives the session         |

Safety rails: never auto-merge, never `max-per-cycle > 3` without consent,
stop touching an issue after two `fail-label` cycles, confirm repo before
running in `cron` mode.

### `github-pr-fixer` — downstream helper
Not part of the gstack chain, but often invoked right after `gstack-gh`
opens a PR. It drives a PR to green through up to three fix rounds, handles
reviewer comments (human or Copilot), can open a PR from the current
branch, and can close a ready release PR. Also uses `gh-cli-guide` as its
sole source of `gh` syntax.

## Typical end-to-end invocation

A user running gstack against a backlog usually goes through one of these
three flows:

**A. One issue, manual**
```
/gstack-gh 123
```
Drives issue #123 in the current repo from claim to PR.

**B. Watch a label, in-session**
```
/gstack-full label=ready-for-claude repo=OWNER/NAME
```
Polls on a self-paced schedule; picks one issue per cycle and delegates.
Dies with the session.

**C. Watch a label, durable**
```
/schedule name="gstack-full-ready" cron="*/15 * * * *" \
  prompt="/gstack-full label=ready-for-claude repo=OWNER/NAME mode=once max-per-cycle=1"
```
Creates a remote agent that fires every 15 minutes. Manage with
`CronList` / `CronDelete`.

## Default label conventions

These are the defaults `gstack-gh` / `gstack-full` assume. Override per
invocation via args.

| Purpose          | Default label        |
| ---------------- | -------------------- |
| Queue flag       | (caller-supplied)    |
| Claimed          | `in-progress`        |
| Completed        | `done`               |
| Failed / parked  | `needs-human`        |

Plus assignee `@me` when an issue is claimed, and a pick-up comment linking
to the working branch.

## Load-bearing invariants

These are promises every part of the chain must keep. If a step can't keep
them, it must stop and park the issue with `fail-label` instead of fudging.

1. **Branch naming:** the working branch is `feature/<N>` where `<N>` is the
   GitHub issue number. No slug, no variation.
2. **Issue ↔ PR binding:** every PR body contains `Closes #<N>`, and a
   `gstack:handoff` comment on the issue links to the PR URL. The
   connection is discoverable from either side.
3. **PR babysitting:** once the PR is open, `github-pr-fixer` owns the
   check-fix / reviewer-comment loop. `gstack-gh` does not duplicate it.
4. **Closure requires explicit user consent:** no part of the chain
   (`gstack-gh`, `gstack-full`, `github-pr-fixer`) merges, closes, or
   release-tags a PR without a direct instruction from the user. That
   instruction is valid whether it arrives in chat or as a comment on the
   PR/issue.
5. **All Q&A flows through the issue or PR.** No skill in the chain may
   ask the user a question through the Claude console. Questions are
   posted as issue/PR comments (with a `gstack:question:<uuid>` marker),
   and the skill polls the same thread every `poll-seconds` (default `60`)
   for a reply. Answers are acknowledged with a follow-up comment before
   work resumes. This rule applies to `github-pr-fixer` and any
   implementation skill gstack delegates to.

## What gstack does NOT do

- Does not merge or close PRs — that is always an explicit human call.
- Does not ask questions in chat — issue / PR comments only.
- Does not run integration tests that hit real external services unless the
  user asks.
- Does not touch `.env` or read secrets.
- Does not assume a specific toolchain — discovers tests from the target
  repo.
- Does not re-plan architecture decisions without user involvement (reply
  on the issue).

## Extending or porting gstack

The skills are deliberately repo-agnostic. To use this setup on another
repo:

1. Copy `gh-cli-guide/`, `gstack-gh/`, `gstack-full/` into that repo's
   `.claude/skills/`.
2. Ensure the target repo has the queue label (`gstack-full` offers a one-
   shot helper to create default labels).
3. Point at the target repo's own implementation skills
   (`new-feature`, `bug-fix`, etc.) if they exist; otherwise `gstack-gh`
   will fall back to plain code edits + discovered test commands.
4. Enforce repo rules by keeping them in the target repo's `AGENTS.md` /
   `CLAUDE.md` — `gstack-gh` reads those before building.

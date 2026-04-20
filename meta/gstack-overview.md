# gstack — how the three skills fit together

`gstack` is the label we use for the GitHub-issue-driven automation loop in
this repo. It is three skills layered on top of each other. `github-pr-fixer`
is **not** part of the chain — it is a separate, manual-slash-only tool the
owner may choose to run on a PR. Nothing in gstack invokes it automatically.

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

         (PR babysitting is NOT automatic — owner may run `/github-pr-fixer` manually)
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

1. Fetch & understand the issue (channel: **issue**)
2. Claim — `@me` + `claim-label` + pick-up comment on the issue
3. Plan — post plan as issue comment and wait for owner approval (channel:
   **issue**; no code exists yet)
4. **Open the DRAFT PR before writing any code.** This is the fixed
   channel-switch point: from this moment forward every question, status
   update, decision request, and failure report goes on the PR thread,
   not the issue and not the console
5. Build — delegates to the matching implementation skill
   (`new-feature`, `bug-fix`, `small-change`, `refactor`, `add-domain`).
   Delegated skills inherit the "PR thread only" rule
6. Test — discover the repo's toolchain (`package.json`, `Makefile`,
   `*.sln`, …) and run validation locally
7. Mark the PR ready — `gh pr ready`, update test-plan section, post
   final `gstack:handoff` on the issue and `gstack:status` on the PR

**Communication protocol.** All user interaction goes through GitHub —
issue thread before the draft PR exists, PR thread from draft-open
onward. Never the Claude console. This binds `gstack-gh` and every skill
it delegates to.

On failure: swap `claim-label` → `fail-label`, post a `gstack:failure`
comment on whichever channel is currently active (issue pre-draft-PR, PR
after), cross-link if the failure is on the PR. Leave branch and draft
PR intact. Surface the failure in chat.

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

### `github-pr-fixer` — MANUAL SLASH-ONLY tool (not part of the chain)
Invoked ONLY by the user typing `/github-pr-fixer`. gstack never chains to
it, never auto-invokes it, and never posts handoff comments that act as
triggers. When the owner chooses to run it, it drives a PR to green through
up to five fix rounds, handles reviewer comments (human or Copilot), can
open a PR from the current branch, and can close a ready release PR. Its
frontmatter carries `disable-model-invocation: true` to enforce this
belt-and-braces alongside the prose rule.

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
3. **PR babysitting is NOT automatic.** Once `gstack-gh` opens the PR and
   posts its `gstack:handoff` comment, gstack stops touching it. The owner
   chooses whether to run `/github-pr-fixer` manually for CI fixing,
   reviewer-comment handling, or closure. No skill in the chain may invoke
   `github-pr-fixer` on its own.
4. **Closure requires explicit user consent:** `gstack-gh` and `gstack-full`
   never merge, close, or release-tag a PR. If the owner wants that work
   driven by an automation, they invoke `/github-pr-fixer` themselves.
5. **All Q&A flows through the issue or PR.** No skill in the chain may
   ask the user a question through the Claude console. Questions are
   posted as issue/PR comments (with a `gstack:question:<uuid>` marker),
   and the skill polls the same thread every `poll-seconds` (default `60`)
   for a reply. Answers are acknowledged with a follow-up comment before
   work resumes. This rule applies to every implementation skill gstack
   delegates to.

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

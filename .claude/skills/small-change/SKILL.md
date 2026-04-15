---
name: small-change
description: >
  End-to-end workflow for implementing a small scoped change while preserving
  every harness engineering invariant (dependency rules, tests, lint,
  structural checks, boundary validation, docs, ADRs, quality grades,
  versioning). Use for scoped single-domain tweaks that touch only a handful
  of files: tightening a validation, correcting a config default, adjusting a
  log line, updating a small piece of documented behavior, or making a narrow
  non-bug behavior adjustment. Not for defect investigation or corrective bug
  fixes (use `bug-fix`), not for multi-domain features (use `new-feature`),
  not for behavior-preserving restructure (use `refactor`).
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---

# Skill: Small Change

Use this skill when the task is a **small, scoped non-bug change** that
should land end-to-end in a single PR and must leave the repository in a state
where every harness invariant is still green.

## Core Rule

A small change is not a license to skip harness gates. It is a license to
make the gates cheap. Run every gate, but keep the diff tiny.

## When to Use This Skill

Use `small-change` when **all** of the following hold:
- The change is confined to one domain and ideally one layer.
- The diff will touch a handful of files (rule of thumb: ≤ 5 source files).
- No new dependency, no new domain, no new architectural boundary.
- The behavior change is narrow, intentional, and describable in one sentence.
- The task is not a corrective bug fix for broken or regressed behavior.

Route elsewhere when:
- The task fixes broken, incorrect, or regressed behavior → use `bug-fix`.
- The task introduces a new capability, endpoint, or service method → use `new-feature`.
- The task restructures code without changing behavior → use `refactor`.
- The task adds a new domain → use `add-domain`.

## Harness Invariants To Preserve

Every small change must leave the following green:

| Invariant | Gate | How to check |
|---|---|---|
| Dependency direction (Types → Config → Repo → Service → Runtime → UI/API) | `npm run check:structure` (also runs inside `npm run build`) | Structural check script |
| Type correctness | `npm run build` | TypeScript compile |
| Lint + style | `npm run lint` | ESLint |
| Behavior correctness | `npm run test` | Vitest suite |
| Boundary validation | Code review | All external input parsed at boundary |
| Docs ↔ code coherence | Manual check | See Step 5 |
| Architecture decisions captured | Manual check | Add ADR only when a real decision is made |
| Quality grade honesty | `docs/quality/QUALITY-GRADES.md` | Update if the change materially changes grade |
| SonarCloud cleanliness | CI (post-merge) | Do not introduce new blocker/critical issues |
| Versioning on master | `AGENTS.md` Default Rule #8 | Never commit to master without a semver tag |

## Workflow

### Step 1: Understand — Map The Blast Radius

Before touching code:

1. Read the task. Restate it in one sentence: *"Change X so that Y."*
2. Identify the affected domain and layer from `docs/architecture/ARCHITECTURE.md`.
3. Check `docs/quality/QUALITY-GRADES.md` for the affected area. A low grade means
   extra care on tests and review.
4. Skim `docs/design/PATTERNS.md` only if the change touches a pattern
   (error handling, validation, logging, result types).
5. Confirm the change is truly small per "When to Use This Skill." If not,
   switch skills.

Output: a one-line change statement plus the list of files you expect to edit.

### Step 2: Plan — Smallest Correct Diff

1. List files you will create or modify. Keep the list minimal.
2. Decide test strategy:
   - Small behavior change → one happy-path test plus one failure-path test
     for the changed branch.
   - Pure documentation or copy adjustment with no executable behavior change
     → no new tests, but still run the full validation gates before submission.
3. Decide doc strategy:
   - Behavior visible at an API or config surface → update the relevant doc
     in the same PR.
   - Behavior visible in a documented user workflow or acceptance path →
     update the matching section under `docs/specs/journeys/` and the root
     index `docs/specs/USER-JOURNEYS.md`.
   - Pure internal tweak invisible outside the module → no doc change needed.
4. Decide ADR strategy:
   - A new decision that future code must follow → write a minimal ADR in
     `docs/context/DECISIONS.md`.
   - Otherwise → no ADR.

If any of these decisions feel unclear, ask before coding.

### Step 3: Implement — Keep The Diff Tight

1. Make the change in the layer that owns the behavior. Do not patch a
   symptom one layer away.
2. Respect dependency direction. If the change wants to import "to the right,"
   stop and rethink — that is a structural signal, not a small change.
3. Validate input at boundaries. Never pass raw JSON past a parse step.
4. Write tests alongside the change, not after.
5. Do not refactor unrelated code. File cleanup belongs in a separate PR via
   the `refactor` skill.
6. No commented-out code. No `TODO` without an issue ID.

### Step 4: Validate — Run Every Gate

Run locally, in this order, and stop on the first failure:

```
npm run lint
npm run test
npm run build    # includes npm run check:structure
```

Do not advance to Step 5 until all three are green. If a gate fails:
- Diagnose the failure precisely. Do not suppress the rule or `eslint-disable` it.
- Read any remediation hint printed by `check-dependencies.mjs` — it tells
  you which layer move is legal.
- If suppression is the only viable path, record the decision in
  `docs/context/DECISIONS.md` and cite it in the PR.

### Step 5: Review — Self-Review Against The Checklist

Walk `docs/workflows/REVIEW-CHECKLIST.md`. Treat it as a hard checklist,
not a suggestion. Pay particular attention to:

- File length ≤ 300 lines, function length ≤ 30 lines.
- Happy path AND one failure path tested.
- No silent failures, no swallowed errors.
- Error messages carry diagnostic context.
- Secrets are not logged.
- No new dependency without justification in the PR description.

Then verify docs are still accurate:
- Did the change alter a documented command, endpoint, config field, or
  error surface? Update the owning doc.
- Did the change alter a documented user-visible workflow? Update the owning
  journey section under `docs/specs/journeys/` and the root journeys index.
- Did the change materially affect a domain's risk profile? Update
  `docs/quality/QUALITY-GRADES.md`.
- Did a quoted example in docs reference the old behavior? Fix it.

### Step 6: Submit — Clean Commit And PR

1. Commit title prefix matches the change kind:
   - Small public behavior adjustment → `feat: <imperative summary>`
   - Internal non-user-facing adjustment → `chore: <imperative summary>`
   - Doc-only → `docs: <imperative summary>`
   - Test-only → `test: <imperative summary>`
2. PR description includes:
   - One-line change statement from Step 1.
   - Affected domain(s) and layer(s).
   - Motivation for the change.
   - Gates run locally and passed.
   - Any follow-up tasks identified but intentionally not done.
3. **Never commit to `master` without bumping to a valid semver tag** (see
   `AGENTS.md` Default Rule #8). Use the normal PR flow.
4. If SonarCloud flags new issues after CI, fix them before merge. Use the
   `sonar` skill to triage severity.

## Examples

**Example 1: Tighten a config default**

Task: "Make the default command timeout 30 seconds instead of 60."

Action:
1. One-line statement: *"Change the default command timeout in command-gateway config from 60s to 30s."*
2. Files: the Config layer module that defines the default; the test that
   asserts defaults.
3. Implement: change the constant, update the default assertion.
4. Validate: `npm run lint && npm run test && npm run build` — all green.
5. Docs: if the default is documented in `README.md` or a config doc, update it.
6. PR title: `chore(command-gateway): lower default command timeout to 30s`.

**Example 2: Tighten a non-bug rule interpretation**

Task: "Treat an omitted optional `reason` field as `manual-review` in approval audit entries."

Action:
1. Restate: *"Default missing approval audit reasons to `manual-review`."*
2. Plan: one happy-path test for the defaulting branch and one explicit-value test.
3. Implement: apply the default in the owning layer instead of at every caller.
4. Validate: full suite green; structure check green.
5. Docs: update the audit-entry semantics if they are documented.
6. PR title: `chore(approval-audit): default missing reasons to manual-review`.

**Example 3: Adjust an API response shape intentionally**

Task: "Include `requestId` in successful status responses from the admin API."

Action:
1. Restate: *"Add `requestId` to the admin API status response payload."*
2. Plan: one integration test asserting the response shape.
3. Implement: shape the response in the UI/API layer. Do not change service logic.
4. Validate: all gates green.
5. Docs: update the public API doc if the response shape is documented.
6. PR title: `feat(platform-api): include requestId in status responses`.

## Troubleshooting

**Question: The structure check fails with "cannot import."**

The change is trying to cross a layer boundary. Do not add a structural
exception. Either move the needed symbol to a legal layer, or route the
dependency through an existing public seam. Read the remediation message the
script prints — it names the legal path.

**Question: A test that I did not touch is now failing.**

Treat that as a signal that the change reaches further than intended.
Re-examine the design assumption behind the change. Do not "fix" the unrelated test by rewriting its
assertion.

**Question: The diff is growing past five files.**

Stop. You are no longer doing a small change. Switch to `new-feature` or
`refactor`, or split the work into a building block that ships first.

**Question: A reviewer (or SonarCloud) flags a pre-existing issue in a file I
edited.**

Record it as a follow-up task in the PR description. Do not bundle unrelated
cleanup into a small change — it defeats the review-speed advantage.

**Question: The change needs a new npm dependency.**

It is not a small change anymore. New dependencies deserve a separate,
justified PR with an ADR.

## Guardrails

- Never suppress a linter, structural, or type error to force the change through.
- Never skip `npm run lint`, `npm run test`, or `npm run build` before submission.
- Never edit files outside the declared scope. If you find an unrelated issue,
  file it as a follow-up.
- Never commit on `master` without a semver tag.
- Never mix a bug fix, refactor, or new feature into a small change PR.

## See Also

- `AGENTS.md` — repository invariants and skill routing
- `docs/workflows/TASK-LIFECYCLE.md` — the underlying six-phase lifecycle
- `docs/workflows/REVIEW-CHECKLIST.md` — the review rubric this skill enforces
- `docs/architecture/DEPENDENCY-RULES.md` — layer rules the structure check enforces
- `docs/design/PATTERNS.md` — preferred patterns for validation, errors, logging
- `.claude/skills/bug-fix/SKILL.md` — for reproduction-first defect fixes
- `.claude/skills/new-feature/SKILL.md` — for larger additive work
- `.claude/skills/refactor/SKILL.md` — for behavior-preserving restructure
- `.claude/skills/sonar/SKILL.md` — when SonarCloud flags post-merge issues

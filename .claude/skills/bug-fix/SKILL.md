---
name: bug-fix
description: >
  Reproduce and fix reported bugs with test-first verification and root-cause
  analysis. Use when debugging a defect, investigating unexpected behavior,
  triaging a regression, or implementing a minimal corrective fix.
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---

# Skill: Bug Fix

Use this skill when fixing a reported bug.

## Core Rule

Reproduce before you fix. Do not guess at the cause or patch the symptom first.

## Repository Context

Review these docs if you need context about the affected area:
- `docs/architecture/ARCHITECTURE.md`
- `docs/quality/QUALITY-GRADES.md`
- `docs/workflows/REVIEW-CHECKLIST.md`

## Workflow

### Step 1: Understand the Bug Report

Extract from the report:
1. **Expected behavior**: What should happen?
2. **Actual behavior**: What happens instead?
3. **Reproduction steps**: How do you trigger the bug?
4. **Context**: Which domain, endpoint, input, or workflow is affected?

If any of these are missing, ask for clarification before proceeding.

### Step 2: Reproduce

Write a failing test first.

The test must:
- Exercise the exact scenario described in the report.
- Fail with the current code, proving the bug exists.
- Use a descriptive name such as `[unit]_[bugScenario]_[expectedCorrectBehavior]`.

If you cannot reproduce the bug with a test, investigate using logs, metrics,
traces, or other observability tools if available. Do not implement a fix until
the failure mode is understood.

### Step 3: Locate the Root Cause

1. Trace execution from the reproduction test.
2. Identify the exact line, condition, or boundary where behavior diverges.
3. Classify the problem: logic error, missing validation, data-shape mismatch,
   or integration issue.

Fix the root cause, not the symptom. If the real problem is missing boundary
validation and the symptom is a null reference, fix the validation instead of
adding a defensive null check in the wrong place.

### Step 4: Implement the Fix

1. Make the smallest change that fixes the root cause.
2. Do not refactor unrelated code in the same change. Use the `refactor` skill separately.
3. Verify the failing test now passes.
4. Check for similar patterns elsewhere and record follow-up tasks if needed.

### Step 5: Add Regression Coverage

Beyond the reproduction test, add:
- Tests for related edge cases the bug exposed.
- A linter rule or structural test when the bug came from a missing invariant
  that should be enforced mechanically.

### Step 6: Validate and Submit

1. All existing and new tests pass.
2. Linter and CI are green.
3. Review the change against `docs/workflows/REVIEW-CHECKLIST.md`.
4. PR title: `fix: [brief description of what was broken]`
5. PR description includes:
   - Root cause analysis in one or two sentences.
   - What the fix does.
   - Any follow-up tasks identified.

## Examples

**Example 1: Missing validation at a boundary**

Bug report: invalid input crashes a service method.

Action:
1. Add a failing test with the invalid input.
2. Trace the failure to the missing validation layer.
3. Add validation at the boundary.
4. Add one or two edge-case tests.

**Example 2: Regression in existing behavior**

Bug report: a previously supported workflow now returns the wrong result.

Action:
1. Add a reproduction test that models the old working behavior.
2. Identify the code path that changed.
3. Restore the intended behavior with the smallest change.
4. Add regression coverage for neighboring cases.

## Troubleshooting

**Question: I cannot reproduce the bug.**

Stop and gather more context. Confirm environment, inputs, and timing, then use
available observability data before changing code.

**Question: Several fixes look plausible.**

Use the failing test and execution trace to eliminate hypotheses. Do not pick a
fix based on intuition alone.

**Question: The reproduction test passes after my change, but other tests fail.**

Treat that as evidence that the fix was incomplete or targeted the wrong layer.
Re-check the root-cause analysis.

## Guardrails

- Do not skip the reproduction step.
- Do not mix unrelated refactors into the fix.
- Do not close the task without regression coverage.

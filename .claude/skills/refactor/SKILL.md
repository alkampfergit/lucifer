---
name: refactor
description: >
  Improve code structure without changing behavior using safe, test-preserving
  refactoring steps. Use when extracting helpers, splitting files, reducing
  duplication, aligning with repository patterns, or cleaning up code.
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---

# Skill: Refactor

Use this skill for code improvement without behavior change.

## Core Rule

All existing tests must pass before and after the refactor. No behavior change
means no test rewrites except added characterization tests, which document the
current behavior before changes, or supporting coverage.

## Workflow

### Step 1: Define the Refactoring Goal

State clearly what you are improving and why:
- Reducing duplication
- Extracting a shared utility
- Splitting a file that is too large to stay legible
- Aligning code with a pattern from `PATTERNS.md`
- Removing a deprecated pattern

Define the scope boundary up front. Refactoring expands easily, so state what
you will not touch and hold that line. Write a brief scope statement in your
task plan or PR description before you start.

### Step 2: Verify the Safety Net

1. Run all existing tests. They must all pass.
2. If coverage is weak in the affected area, add characterization tests first.
3. Record the passing test count in your task notes or PR description before
  changing code so Step 4 can verify preservation.

### Step 3: Refactor in Small Steps

Each step must:
1. Be a single coherent transformation such as rename, extract, move, or inline.
2. Leave tests passing after the step.
3. Be small enough that you could commit it independently.

Common orders of operation:

**Extracting a shared utility**
1. Identify all instances of the duplicated pattern.
2. Create the utility in the repository's shared module or equivalent location.
3. Add tests for the utility.
4. Replace each instance one at a time, running tests after each replacement.

**Splitting a large file**
1. Identify responsibility boundaries inside the file.
2. Create new files for each responsibility.
3. Move functions or classes one at a time.
4. Update imports.
5. Run tests after each move.

**Aligning with a new pattern**
1. Implement the new pattern alongside the old one.
2. Migrate callers one at a time.
3. Remove the old implementation only when no callers remain.

### Step 4: Verify Preservation

1. Run all tests again. The same tests that passed before must still pass.
2. Compare the test count. It should stay equal or increase, never drop.
3. Run linter and structural checks.
4. If any existing test changed, justify it explicitly in the PR description.

### Step 5: Update Quality Grade

If the refactor materially improved a domain's quality:
1. Update the grade in `docs/quality/QUALITY-GRADES.md`.
2. Note what improved.

### Step 6: Submit

1. PR title: `refactor: [brief description of improvement]`
2. PR description includes:
   - What was refactored and why.
   - Confirmation that no behavior changed.
   - Updated quality grade, if applicable.

## Examples

**Example 1: Extract duplicate mapping logic**

User says: "This mapping code is repeated in three places. Refactor it."

Actions:
1. Capture current behavior with tests if coverage is weak.
2. Extract the repeated mapping code into a shared helper.
3. Replace callers one at a time.
4. Keep tests green after each replacement.

Result: the mapping logic is centralized without changing behavior.

**Example 2: Split an oversized service file**

User says: "Split this service file into smaller pieces without changing how it works."

Actions:
1. Identify natural responsibility boundaries.
2. Move one cluster of functions into a new file.
3. Update imports.
4. Re-run tests before continuing with the next cluster.

Result: responsibilities are separated into smaller files and the safety net stays green.

## Troubleshooting

**Question: Tests fail after a small refactor step.**

Stop and fix that step before continuing. Do not stack more edits on top of a
failing intermediate state.

**Question: The refactor wants to grow into a redesign.**

Split the work. Finish the current preservation-focused refactor first, then
open a separate change for behavioral or architectural redesign.

**Question: There is no obvious shared module for extracted code.**

Use the repository's established dependency direction and naming conventions.
Do not invent a new shared layer unless the architecture supports it.

## Guardrails

- Do not mix behavior changes into a refactor.
- Do not continue once the safety net is red.
- Do not reduce coverage in the touched area.

## See Also

- [PATTERNS.md](../../../docs/design/PATTERNS.md)
- [QUALITY-GRADES.md](../../../docs/quality/QUALITY-GRADES.md)
- [REVIEW-CHECKLIST.md](../../../docs/workflows/REVIEW-CHECKLIST.md)

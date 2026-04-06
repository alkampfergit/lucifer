---
name: meta
description: >
  Capture reusable agent behavior and best practices as a skill update or a new
  skill after task completion. Use when a task reveals a repeatable workflow,
  exposes missing instructions, or surfaces a pattern worth preserving for
  future tasks. Examples: update an existing skill, create a skill for a new
  workflow, document guidance the agent should reuse, or refine repository
  skills after delivery. Review existing skills first, create new only when the
  scope is clearly distinct, and do not use this skill for one-off fixes with no
  reuse value. After the first draft, launch a subagent to refine the skill
  against meta/skill-guide.md.
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---

# Skill: Meta

Use this skill at the end of a completed task, after implementation and validation,
before sending the final response.

## Goal

Preserve reusable learning from the finished conversation by updating an existing
skill or creating a new one.

Do not create a skill for one-off facts, temporary debugging notes, or changes
that belong in repository docs or memory instead.

## Inputs To Review

Review these sources before editing any skill:
- Original user request
- Key decisions made during the task
- Problems encountered and how they were resolved
- Files created or modified
- Validation steps that were required
- Reusable patterns that would help on future tasks

## Workflow

### Step 1: Decide Whether A Skill Change Is Warranted

Ask these questions:
1. Did the task reveal a repeatable workflow, checklist, or decision rule?
2. Would that guidance help on future tasks in this repository?
3. Is the best home a skill, not a repository doc or memory note?

If the answer is no, stop and do not make a skill change.

### Step 2: Inspect Existing Skills Before Creating Anything

Search the skill location:
- `.claude/skills/**/SKILL.md` is the single source of truth.

Prefer updating an existing skill when the new guidance fits its scope.

Create a new skill only when all of the following are true:
1. The guidance is reusable.
2. No existing skill is a clean fit.
3. The new scope can be described clearly with distinct trigger phrases.

### Step 3: Use The Skill Guide Deliberately

Read `meta/skill-guide.md` before drafting or revising the skill.

Use it to verify:
- The description states what the skill does and when to use it.
- The workflow is specific, actionable, and concise.
- The structure follows a valid skill layout.
- References use relative forward-slash paths.
- The skill includes examples or decision criteria when ambiguity is likely.

Focus especially on the sections about descriptions, SKILL.md structure,
progressive disclosure, troubleshooting, and context forking.

### Step 4: Draft Or Update The Skill

When editing an existing skill:
1. Preserve the existing scope.
2. Fold the new learning into the smallest sensible section.
3. Tighten vague wording rather than appending redundant prose.

When creating a new skill:
1. Create the file at `.claude/skills/<skill-name>/SKILL.md`.
2. Add the skill to the table in `AGENTS.md`.

Keep the content focused. Prefer checklists, decision rules, and concrete steps
over broad commentary.

### Step 5: Launch A Subagent To Refine The Skill

After the first draft or update, start a subagent and instruct it to review the
skill against `meta/skill-guide.md`.

Use a prompt that includes:
- The path of the skill you changed
- Whether it is a new skill or an update
- The requirement to use `meta/skill-guide.md` as the review rubric
- A request to improve the description, structure, examples, and troubleshooting
  if needed

If you want the subagent to edit the skill directly, launch it without specifying
an agent so it can use the current agent capabilities.

If you want a read-only critique first, use the `Explore` subagent and ask for:
- Activation and trigger-phrase quality
- Gaps against the guide
- Duplication or overlap with other skills
- A concrete refinement plan

### Step 6: Apply The Refinement And Verify

After the subagent finishes:
1. Apply any remaining improvements.
2. Ensure the canonical and mirrored copies stay aligned.
3. Re-check the final skill against `meta/skill-guide.md`.
4. Confirm the skill name, description, and folder layout are valid.

## Examples

**Example 1: Update An Existing Skill**

Task outcome: the work showed that `bug-fix` should explicitly tell the agent to
capture reproduction steps before changing code.

Action:
1. Update `.claude/skills/bug-fix/SKILL.md`.
2. Launch a refinement subagent using `meta/skill-guide.md` as the rubric.

**Example 2: Create A New Skill**

Task outcome: the conversation produced a repeatable workflow for maintaining
agent skills, and no existing skill covers that scope.

Action:
1. Create `.claude/skills/meta/SKILL.md`.
2. Register it in `AGENTS.md`.
3. Launch a refinement subagent to tighten the new skill before closing the task.

## Output

Before closing the task, produce:
- Which skill was updated or created
- Why that skill was the right home
- What reusable guidance was captured
- Whether a subagent refinement pass was completed

## Troubleshooting

**Question: Should this be an update or a new skill?**

Use Step 2 as the decision rule. If the guidance fits the scope of an existing
skill, update it. If the workflow is distinct enough to justify separate trigger
phrases and separate instructions, create a new skill.

**Question: Can the subagent pass be skipped?**

No. The refinement pass is mandatory because it catches weak trigger phrases,
missing sections, and overlap with existing skills.

## See Also

- `meta/skill-guide.md`
- `AGENTS.md`
- `docs/workflows/TASK-LIFECYCLE.md`

## Guardrails

- Prefer updating over creating when scope overlaps.
- Do not add a skill for a single incident with no reuse value.
- Always update `.claude/skills/` as the single source of truth.
- Do not skip the subagent refinement pass after drafting the skill change.
---
name: doc-gardening
description: >
   Scan the repository for stale, broken, or missing documentation and repair
   the highest-priority issues. Use when auditing docs, checking AGENTS links,
   reconciling docs with code, or running periodic documentation maintenance.
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---

# Doc Gardening

Use this skill to scan the repository for stale, incorrect, or missing
documentation.

## Overview

Use this skill to reconcile repository documentation with the actual code,
layout, and workflow rules, then fix the highest-priority mismatches first.

## Quick Start

For a routine maintenance pass:
1. Verify `AGENTS.md` links and the skill table.
2. Check architecture and quality docs against the current code layout.
3. Fix all Critical findings.
4. Update review timestamps only in documents you actually verified.

## Scope

This skill is tailored to repositories that follow the layout documented in
`AGENTS.md`, including top-level `docs/`, `.claude/skills/`, and `src/domains/`
directories. If the repository differs, adapt the checklist rather than forcing
these paths.

## What Gets Checked

### 1. AGENTS.md Freshness

- [ ] All links in `AGENTS.md` point to files that exist.
- [ ] The skill table matches the actual contents of `.claude/skills/`.
- [ ] The "Where to Look" table matches the actual `docs/` structure.
- [ ] The "Last verified" date is within the last 2 weeks.

### 2. Architecture Docs Accuracy

- [ ] The domain table in `ARCHITECTURE.md` matches actual `src/domains/` directories.
- [ ] The infrastructure table reflects the current tech stack.
- [ ] `DEPENDENCY-RULES.md` matches what the linter actually enforces.
- [ ] `DOMAIN-BOUNDARIES.md` lists the cross-domain contracts that exist in code.

### 3. Quality Grades Currency

- [ ] Every domain in the codebase has a row in `QUALITY-GRADES.md`.
- [ ] No domain has a "Last Reviewed" date older than 1 month.
- [ ] Test coverage percentages match actual CI reports.

### 4. Glossary Completeness

- [ ] Every domain-specific type name in the codebase appears in `GLOSSARY.md`.
- [ ] No glossary terms refer to types or concepts that no longer exist.

### 5. ADR Completeness

- [ ] Every significant structural pattern in the code has a corresponding ADR.
- [ ] No ADRs reference technologies or patterns that have been removed.
- [ ] Superseded ADRs are marked as such with a pointer to the replacement.

### 6. Code Comment Hygiene

- [ ] No TODO comments without issue IDs.
- [ ] No references to removed files or renamed modules in comments.

## Detailed Workflow

### Step 1: Scan

Run through each checklist section above. For each item:
- **Pass**: mark it verified.
- **Fail**: record the exact issue.

### Step 2: Categorize Findings

Group issues by severity:
- **Critical**: broken links, missing docs for active domains, incorrect rules.
- **Important**: stale dates, outdated references, missing glossary entries.
- **Minor**: formatting inconsistencies and cosmetic issues.

### Step 3: Fix

1. Fix all Critical issues in the current pass.
2. Fix Important issues if time permits.
3. Log Minor issues as follow-up tasks.

### Step 4: Update Timestamps

After fixing, update the relevant "Last verified" or "Last Reviewed" dates in
all touched documents.

### Step 5: Submit

1. PR title: `docs: doc gardening pass [DATE]`
2. PR description includes:
    - Summary of findings by severity.
    - What was fixed.
    - Any follow-up tasks created for deferred fixes.

## Examples

**Example 1: Broken AGENTS links**

User says: "Run a docs maintenance pass and fix stale agent docs."

Actions:
1. Check every `AGENTS.md` link.
2. Compare the skill table with the real `.claude/skills/` folders.
3. Repair broken links and update stale verification dates.

Result: the repository entry point points only to valid, current docs.

**Example 2: Quality docs drifted from the codebase**

User says: "Make sure quality grades and glossary entries still match the code."

Actions:
1. Compare active domains and exported concepts with `QUALITY-GRADES.md` and `GLOSSARY.md`.
2. Fix missing or stale entries.
3. Record lower-priority cleanup as follow-up work.

Result: documentation matches the current code surface and review cadence.

## Advanced Features

If you automate parts of this workflow, keep skill-local helpers under
`scripts/`. If the automation becomes repository-wide rather than skill-local,
promote it to `tools/doc-gardening/`.

Potential automations:
- **Link checking**: verify markdown links resolve to real files.
- **Domain sync**: compare `src/domains/*/` with `ARCHITECTURE.md` rows.
- **Glossary sync**: extract exported type names and compare them with `GLOSSARY.md`.
- **TODO audit**: find TODO comments that do not include issue IDs.

## Troubleshooting

**Question: The repository does not have `src/domains/`.**

Adjust the architecture and quality checks to the actual source layout. The
intent is to reconcile docs with code, not to enforce a nonexistent structure.

**Question: There are too many findings to fix in one pass.**

Fix the Critical issues, capture the Important ones, and record Minor cleanup as
follow-up work.

## Guardrails

- Do not silently change architectural claims without checking the code.
- Do not update timestamps unless the content was actually reviewed.
- Do not leave broken links or incorrect rule documentation marked as verified.

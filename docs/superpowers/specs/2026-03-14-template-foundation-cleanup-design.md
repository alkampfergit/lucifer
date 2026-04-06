# Design: Template Foundation Cleanup

**Date**: 2026-03-14
**Status**: Approved
**Scope**: Repository-wide structural changes to the ai-landscape template

## Context

This repository is a reusable template for bootstrapping agent-first development workflows. The primary goal is creating a repo where AI agents work autonomously without human code review. Analysis revealed several issues blocking that goal:

- No bootstrapping workflow for initial project setup
- No templates folder for consistent agent output
- Language-specific examples in a language-agnostic template
- Inconsistent skill frontmatter across skills
- Duplicate skills in `skills/` and `.claude/skills/` with no sync mechanism
- Stale README structure diagram
- Placeholder dates in ADRs
- `meta/links.md` has unclear placement

## Design

### 1. New Folder Structure

```
├── AGENTS.md                              # Updated — new "Where to Look" entries
├── BOOTSTRAP.md                           # NEW — prompt for initial project setup
├── README.md                              # Updated — fix structure diagram
├── docs/                                  # Pseudocode examples in PATTERNS.md
├── extra/                                 # NEW — human reference files, agents ignore
│   └── links.md                           # Moved from meta/links.md
├── meta/
│   └── skill-guide.md                     # Unchanged
├── templates/                             # NEW — agent output templates
│   ├── pr.template.md
│   ├── adr.template.md
│   └── commit.template.md
└── .claude/
    └── skills/                            # Single source of truth for all skills
        ├── new-feature/SKILL.md
        ├── bug-fix/SKILL.md
        ├── refactor/SKILL.md
        ├── add-domain/SKILL.md
        ├── doc-gardening/SKILL.md
        └── meta/SKILL.md
```

### 2. BOOTSTRAP.md

A prompt file the user gives to an AI model after forking/copying the template. The AI:

- Asks the user about their project (name, tech stack, domains, infrastructure)
- Fills in all placeholder docs (ARCHITECTURE.md, DOMAIN-BOUNDARIES.md, GLOSSARY.md, etc.)
- Generates language-specific linter/CI configs based on the chosen stack
- Generates structural tests for dependency rule enforcement
- Fills in ADR dates and initial decisions
- Updates AGENTS.md identity section with project specifics

Tone: directive prompt, not documentation. Tells the AI exactly what to do, step by step.

### 3. Templates Folder

**`pr.template.md`** — Agent-consumable PR description template. The `.github/PULL_REQUEST_TEMPLATE.md` stays for GitHub's native PR UI. This version includes explicit instructions to the agent about how to fill each section.

**`adr.template.md`** — Extracted from the ADR template currently embedded in DECISIONS.md. Agents reference this when writing new ADRs.

**`commit.template.md`** — Based on the commit message format in CODE-STANDARDS.md. Clear pattern: type, description, and when to use each type.

Each template has a header explaining its purpose and when an agent should use it. AGENTS.md references `templates/` in the "Where to Look" table.

### 4. Docs Cleanup

- **PATTERNS.md**: Replace TypeScript/C# snippets with language-neutral pseudocode. Patterns stay; only syntax becomes generic. Comments like `// validate input using your stack's schema library`.
- **DECISIONS.md**: ADR-001 and ADR-002 get date 2026-03-12 (initial commit date).
- **No other doc content changes**: Placeholders in architecture docs (`[domain-1]`, `[e.g., PostgreSQL]`) stay — the bootstrap process fills those.

### 5. Skills Consolidation and Frontmatter Standardization

**Consolidation:** The duplicate `skills/` folder is deleted. `.claude/skills/` becomes the single source of truth for all skills. This eliminates the maintenance burden of keeping two copies in sync.

AGENTS.md documents all skills with their purpose and location so that:
- Agents using Claude Code discover them automatically via `.claude/skills/`
- Users adopting other AI tools can find the skill list in AGENTS.md and move/copy them to the tool's expected location
- There is never ambiguity about which copy is authoritative

**Frontmatter:** All six skills get consistent YAML frontmatter matching `.claude/skills/meta/SKILL.md` format:

```yaml
---
name: <skill-name>
description: >
  <what it does and when to use it>
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---
```

Currently only `.claude/skills/meta/SKILL.md` has this. The other five (`new-feature`, `bug-fix`, `refactor`, `add-domain`, `doc-gardening`) get frontmatter added.

### 6. extra/ Folder

- `meta/links.md` moves to `extra/links.md`
- `extra/` is explicitly marked in AGENTS.md as "not for agent use — human reference only"
- Purpose: a place for users to store reference material (articles, links, notes) that agents should not load or act on during normal operation

### 7. README.md and AGENTS.md Updates

**README.md**: Structure diagram updated to show `extra/`, `templates/`, `skills/meta/SKILL.md`, and accurate file listing.

**AGENTS.md**: Three additions to the "Where to Look" table:

| What you need | Where to find it |
|---|---|
| Output templates (PRs, ADRs, commits) | `templates/` |
| Initial project setup prompt | `BOOTSTRAP.md` |
| Human reference files (not for agents) | `extra/` |

## Files Changed

| File | Action |
|---|---|
| `BOOTSTRAP.md` | Create |
| `templates/pr.template.md` | Create |
| `templates/adr.template.md` | Create |
| `templates/commit.template.md` | Create |
| `extra/links.md` | Create (moved from `meta/links.md`) |
| `meta/links.md` | Delete (moved to `extra/links.md`) |
| `skills/` | Delete entire folder (consolidated into `.claude/skills/`) |
| `docs/design/PATTERNS.md` | Edit — pseudocode examples |
| `docs/context/DECISIONS.md` | Edit — fix ADR dates |
| `AGENTS.md` | Edit — add table entries, update skills section, document Claude-first approach |
| `README.md` | Edit — update structure diagram |
| `.claude/skills/new-feature/SKILL.md` | Edit — add frontmatter |
| `.claude/skills/bug-fix/SKILL.md` | Edit — add frontmatter |
| `.claude/skills/refactor/SKILL.md` | Edit — add frontmatter |
| `.claude/skills/add-domain/SKILL.md` | Edit — add frontmatter |
| `.claude/skills/doc-gardening/SKILL.md` | Edit — add frontmatter |

## Out of Scope

- CI/CD configuration — language-specific, handled by bootstrap process
- Structural test implementations — language-specific, handled by bootstrap process
- `meta/skill-guide.md` changes — content is fine as-is

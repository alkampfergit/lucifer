# Template Foundation Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the ai-landscape template to eliminate skill duplication, add bootstrapping and output templates, and make all docs language-agnostic.

**Architecture:** This is a documentation and structure-only change. No application code is involved. All changes are to markdown files and folder structure. The repository is a reusable template for agent-first development.

**Tech Stack:** Markdown, Git, shell commands.

**Spec:** `docs/superpowers/specs/2026-03-14-template-foundation-cleanup-design.md`

---

## Chunk 1: Structural Changes (folders, moves, deletes)

### Task 1: Delete the duplicate `skills/` folder

**Files:**
- Delete: `skills/new-feature/SKILL.md`
- Delete: `skills/bug-fix/SKILL.md`
- Delete: `skills/refactor/SKILL.md`
- Delete: `skills/add-domain/SKILL.md`
- Delete: `skills/doc-gardening/SKILL.md`
- Delete: `skills/meta/SKILL.md`

- [ ] **Step 1: Verify `.claude/skills/` has all six skills**

Run: `ls .claude/skills/`
Expected: `add-domain  bug-fix  doc-gardening  meta  new-feature  refactor`

- [ ] **Step 2: Delete the `skills/` folder**

Run: `rm -rf skills/`

- [ ] **Step 3: Verify deletion**

Run: `ls skills/ 2>&1`
Expected: error — directory does not exist

- [ ] **Step 4: Commit**

```bash
git add -A skills/
git commit -m "chore: delete duplicate skills/ folder — .claude/skills/ is now single source of truth"
```

---

### Task 2: Move `meta/links.md` to `extra/links.md`

**Files:**
- Create: `extra/links.md` (moved content)
- Delete: `meta/links.md`

- [ ] **Step 1: Create `extra/` directory and move the file**

```bash
mkdir -p extra
mv meta/links.md extra/links.md
```

- [ ] **Step 2: Verify**

Run: `ls extra/links.md && ls meta/links.md 2>&1`
Expected: `extra/links.md` exists, `meta/links.md` does not

- [ ] **Step 3: Commit**

```bash
git add extra/links.md
git rm meta/links.md
git commit -m "chore: move links.md to extra/ — human reference files, not for agent use"
```

---

## Chunk 2: Skill Frontmatter Standardization

### Task 3: Add frontmatter to `.claude/skills/new-feature/SKILL.md`

**Files:**
- Modify: `.claude/skills/new-feature/SKILL.md`

This is the only skill with no frontmatter at all. Add the full block.

- [ ] **Step 1: Add YAML frontmatter**

Prepend the following to the file (before the existing `# Skill: New Feature` heading):

```yaml
---
name: new-feature
description: >
  End-to-end workflow for adding a new feature from a task or prompt description.
  Use when implementing a new capability, adding an endpoint, introducing a new
  service method, or building a new UI component.
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---
```

- [ ] **Step 2: Verify the file starts with `---`**

Run: `head -1 .claude/skills/new-feature/SKILL.md`
Expected: `---`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/new-feature/SKILL.md
git commit -m "chore: add frontmatter to new-feature skill"
```

---

### Task 4: Add `metadata` block to the four skills with partial frontmatter

**Files:**
- Modify: `.claude/skills/bug-fix/SKILL.md`
- Modify: `.claude/skills/refactor/SKILL.md`
- Modify: `.claude/skills/add-domain/SKILL.md`
- Modify: `.claude/skills/doc-gardening/SKILL.md`

These four already have `name` and `description` in their frontmatter but are missing the `metadata` block. Add the following after the `description` field and before the closing `---` in each:

```yaml
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
```

- [ ] **Step 1: Edit `.claude/skills/bug-fix/SKILL.md`**

Add the `metadata` block after the `description` field, before `---`.

- [ ] **Step 2: Edit `.claude/skills/refactor/SKILL.md`**

Same change.

- [ ] **Step 3: Edit `.claude/skills/add-domain/SKILL.md`**

Same change.

- [ ] **Step 4: Edit `.claude/skills/doc-gardening/SKILL.md`**

Same change.

- [ ] **Step 5: Verify all six skills have `metadata:` in frontmatter**

Run: `grep -l "metadata:" .claude/skills/*/SKILL.md | wc -l`
Expected: `6`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/bug-fix/SKILL.md .claude/skills/refactor/SKILL.md .claude/skills/add-domain/SKILL.md .claude/skills/doc-gardening/SKILL.md
git commit -m "chore: standardize frontmatter across all skills — add metadata block"
```

---

## Chunk 3: Templates

### Task 5: Create `templates/pr.template.md`

**Files:**
- Create: `templates/pr.template.md`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p templates
```

Write `templates/pr.template.md` with this content:

```markdown
# PR Description Template

> **For agents:** Use this template when composing a pull request description.
> Fill in every section. Mark sections N/A only with justification.

## Summary

<!-- 1-3 bullet points describing what this PR does and why -->

## Type

<!-- Check exactly one -->

- [ ] `feat` — New feature
- [ ] `fix` — Bug fix
- [ ] `refactor` — Code improvement (no behavior change)
- [ ] `docs` — Documentation update
- [ ] `test` — Test additions/fixes
- [ ] `chore` — Build, CI, tooling

## Domains Affected

<!-- List which domain(s) and layer(s) this PR touches -->

- Domain:
- Layers:

## Checklist

- [ ] Dependency direction rules respected
- [ ] Data validated at all boundaries
- [ ] Tests added/updated (happy path + at least one failure path)
- [ ] All tests pass locally
- [ ] Linter and formatter clean
- [ ] Documentation updated (if behavior changed)
- [ ] ADR created (if architectural decision was made)
- [ ] Quality grades updated (if significant quality change)

## Follow-Up Tasks

<!-- List any work identified during implementation that should be done separately -->

- None
```

- [ ] **Step 2: Commit**

```bash
git add templates/pr.template.md
git commit -m "feat: add PR description template for agent use"
```

---

### Task 6: Create `templates/adr.template.md`

**Files:**
- Create: `templates/adr.template.md`

- [ ] **Step 1: Write the file**

```markdown
# ADR Template

> **For agents:** Use this template when recording an Architecture Decision Record.
> Copy the structure below into `docs/context/DECISIONS.md` as a new entry.
> Fill in every section. Do not leave placeholders.

## ADR-[NNN]: [Title]

**Date**: [YYYY-MM-DD]
**Status**: [Proposed | Accepted | Deprecated | Superseded by ADR-XXX]
**Deciders**: [who made this decision]

### Context

[What situation prompted this decision? What problem needed solving?]

### Decision

[What was decided? Be specific.]

### Consequences

[What are the positive and negative consequences?]
[What trade-offs were accepted?]

### Alternatives Considered

[What other options were evaluated and why were they rejected?]
```

- [ ] **Step 2: Commit**

```bash
git add templates/adr.template.md
git commit -m "feat: add ADR template for agent use"
```

---

### Task 7: Create `templates/commit.template.md`

**Files:**
- Create: `templates/commit.template.md`

- [ ] **Step 1: Write the file**

```markdown
# Commit Message Template

> **For agents:** Use this format for all commit messages.
> Choose the type that best describes the change. Write a concise description
> in imperative mood ("add", "fix", "update", not "added", "fixed", "updated").

## Format

```
[type]: [brief description]
```

## Types

| Type       | When to use                                      | Example                                      |
|------------|--------------------------------------------------|----------------------------------------------|
| `feat`     | New feature or capability                        | `feat: add order validation at API boundary` |
| `fix`      | Bug fix                                          | `fix: handle null input in pricing service`  |
| `refactor` | Code improvement without behavior change         | `refactor: extract shared mapping utility`   |
| `docs`     | Documentation only                               | `docs: update quality grades for orders`     |
| `test`     | Adding or fixing tests                           | `test: add edge case coverage for payments`  |
| `chore`    | Build, CI, tooling changes                       | `chore: update linter config for new rule`   |

## Rules

1. Keep the description under 72 characters.
2. Use imperative mood: "add feature" not "added feature".
3. Do not end with a period.
4. If the change affects a specific domain, mention it: `feat(orders): add validation`.
5. Multi-line body is optional — use it for context when the "why" is not obvious from the diff.
```

- [ ] **Step 2: Commit**

```bash
git add templates/commit.template.md
git commit -m "feat: add commit message template for agent use"
```

---

## Chunk 4: Docs Cleanup

### Task 8: Replace language-specific examples in `PATTERNS.md` with pseudocode

**Files:**
- Modify: `docs/design/PATTERNS.md`

- [ ] **Step 1: Replace the "Data Validation at Boundaries" example**

Replace the current TypeScript code block with:

```
// GOOD: Parse and validate at the boundary
input = RequestSchema.parse(rawBody)     // use your stack's schema library
orderService.process(input)              // input is now typed and trusted

// BAD: Pass raw data through
orderService.process(request.body)       // what shape is this? unknown
```

- [ ] **Step 2: Replace the "Result Types Over Exceptions" example**

Replace the current C# code block with:

```
// GOOD: Caller must handle both cases
result = orderService.create(command)    // returns Result<Order, ValidationError>

// BAD: Exception for expected business rule violation
throw OrderValidationException("...")    // caller has no compile-time warning
```

- [ ] **Step 3: Verify no language-specific imports or syntax remain**

Scan the file for `.ts`, `.js`, `.cs`, `import`, `from '`, `using `.
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/design/PATTERNS.md
git commit -m "docs: replace language-specific examples with pseudocode in PATTERNS.md"
```

---

### Task 9: Fix ADR dates in `DECISIONS.md`

**Files:**
- Modify: `docs/context/DECISIONS.md`

- [ ] **Step 1: Replace `[DATE]` with `2026-03-12` in ADR-001 and ADR-002**

Change both occurrences of `**Date**: [DATE]` to `**Date**: 2026-03-12`.

- [ ] **Step 2: Verify no `[DATE]` placeholders remain in the active ADRs**

Run: `grep "\[DATE\]" docs/context/DECISIONS.md`
Expected: no matches (the template section still has `[YYYY-MM-DD]` which is fine — it's the template format).

- [ ] **Step 3: Commit**

```bash
git add docs/context/DECISIONS.md
git commit -m "docs: fix ADR dates — use initial commit date 2026-03-12"
```

---

## Chunk 5: BOOTSTRAP.md

### Task 10: Create `BOOTSTRAP.md`

**Files:**
- Create: `BOOTSTRAP.md`

- [ ] **Step 1: Write the file**

This is a prompt the user gives to an AI model after forking/copying the template. Tone is directive — it tells the AI exactly what to do. Content:

```markdown
# Bootstrap Prompt

> **How to use:** Copy this entire file and paste it as a prompt to your AI coding assistant
> after forking or copying this template repository. The AI will ask you questions about
> your project and configure all placeholder documents automatically.

---

You are bootstrapping a new software project using an agent-first repository template.
Your job is to configure this repository for the user's specific project by filling in
all placeholder documents.

## Step 1: Gather Project Information

Ask the user the following questions, one at a time. Wait for each answer before proceeding.

1. **Project name**: What is this project called?
2. **Tech stack**: What language(s) and framework(s) will this project use?
3. **Architecture style**: Confirm layered domain architecture or ask if they prefer a different approach.
4. **Domains**: What are the initial business domains? For each domain, ask:
   - Name (single noun or short noun phrase)
   - Responsibility (one sentence)
   - Key concepts that belong exclusively to this domain
5. **Infrastructure**: What database, message bus, cache, and CI/CD platform will be used?
6. **Observability**: What logging/monitoring/tracing stack will be used (if any)?

## Step 2: Configure Architecture Docs

Using the answers from Step 1, fill in the following files. Replace all `[PLACEHOLDER]` values with project-specific content. Remove placeholder brackets entirely — the result should read as finished documentation.

### `AGENTS.md`
- Update the Identity section: project name, purpose, and style.
- Verify the "Where to Look" table links are correct.
- Update the "Last verified" date to today.

### `docs/architecture/ARCHITECTURE.md`
- Fill in the System Overview with the project name and architecture style.
- Populate the Domain Map table with all initial domains.
- Fill in the Infrastructure table with the chosen technologies.
- Reference the ADRs created in Step 4.

### `docs/architecture/DEPENDENCY-RULES.md`
- Adapt the layer names if the chosen architecture differs from the default.
- Ensure the dependency direction table matches the project's layer structure.

### `docs/architecture/DOMAIN-BOUNDARIES.md`
- Add a Domain Registry entry for each initial domain.
- Fill in responsibility, bounded context, published/consumed events, public API surface, and data ownership.
- Add initial integration contracts if domains interact.

## Step 3: Configure Quality and Context Docs

### `docs/quality/QUALITY-GRADES.md`
- Add a row for each initial domain with grade "B" (clean scaffold, no code yet).
- Set "Last Reviewed" to today's date.

### `docs/quality/CODE-STANDARDS.md`
- Add a language-specific section for the chosen tech stack.
- Include the linter and formatter commands.
- Adapt naming conventions if the language has different idioms.

### `docs/context/GLOSSARY.md`
- Add domain-specific terms for each initial domain.
- Fill in the definition and in-code representation columns.

### `docs/context/DECISIONS.md`
- Update ADR-001 and ADR-002 deciders with the project team or owner.
- Add any new ADRs for technology choices made during bootstrapping (e.g., "ADR-003: Use PostgreSQL for primary storage").

## Step 4: Generate Enforcement Scaffolding

Based on the chosen tech stack, generate:

1. **Linter configuration** — appropriate for the language (e.g., `.eslintrc`, `.editorconfig`, `ruff.toml`).
2. **Formatter configuration** — matching the code standards.
3. **CI/CD pipeline** — a basic pipeline config (e.g., `.github/workflows/ci.yml`) that runs:
   - Linting
   - Formatting check
   - Tests
   - Structural tests (dependency rule verification)
4. **Structural test stubs** — skeleton test files that verify dependency direction rules. These can start as TODOs with clear descriptions of what each test should check.

## Step 5: Scaffold Initial Domain Directories

For each domain defined in Step 1, create the directory structure:

```
src/domains/[domain-name]/
├── types/           # Value objects, DTOs, events, enums
├── config/          # Configuration schemas and defaults
├── repository/      # Data access interfaces and implementations
├── service/         # Business logic
├── runtime/         # DI wiring, bootstrap
└── README.md        # Domain-specific documentation
```

Adapt file extensions and directory layout to the chosen tech stack.

## Step 6: Final Verification

After all changes:

1. Verify every link in `AGENTS.md` points to a real file.
2. Verify no `[PLACEHOLDER]` or `[e.g.,` text remains in any doc.
3. Verify the README.md structure diagram matches the actual file tree.
4. Commit all changes with message: `feat: bootstrap project — [project-name]`

## Rules

- Do not skip any document. Every placeholder in every file must be resolved.
- Ask clarifying questions rather than guessing. Wrong assumptions waste more time than an extra question.
- Keep all documentation concise. Do not pad with generic filler text.
- Preserve the structure and formatting conventions already present in each file.
```

- [ ] **Step 2: Commit**

```bash
git add BOOTSTRAP.md
git commit -m "feat: add BOOTSTRAP.md — prompt for initial project configuration"
```

---

## Chunk 6: Update AGENTS.md and README.md

### Task 11: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add new entries to the "Where to Look" table**

Add these three rows to the table after the existing entries:

```markdown
| Output templates (PRs, ADRs, commits)  | [templates/](templates/) |
| Initial project setup prompt           | [BOOTSTRAP.md](BOOTSTRAP.md) |
| Human reference files (not for agents) | [extra/](extra/) |
```

- [ ] **Step 2: Update the Skills section**

Replace the current skills section with content that:
- States skills are Claude Code-first, living in `.claude/skills/`
- Lists all six skills with their purpose
- Notes that users on other tools can find the skill list here and move/copy to their tool's expected location
- Updates the skill table paths from `skills/` references to `.claude/skills/`

Updated table:

```markdown
## Skills

Skills are reusable workflows for repeatable tasks.
They live in `.claude/skills/` as the single source of truth (Claude Code-first).
Users adopting other AI tools can copy skills from `.claude/skills/` to their tool's expected location.
Read the skill before starting the work it covers.

| Skill | Purpose | Location |
|-------|---------|----------|
| `new-feature` | End-to-end workflow for adding a new feature | `.claude/skills/new-feature/SKILL.md` |
| `bug-fix` | Structured workflow for reproducing and fixing bugs | `.claude/skills/bug-fix/SKILL.md` |
| `refactor` | Safe refactoring with preservation guarantees | `.claude/skills/refactor/SKILL.md` |
| `add-domain` | Bootstrap a new business domain module | `.claude/skills/add-domain/SKILL.md` |
| `doc-gardening` | Scan and fix stale documentation | `.claude/skills/doc-gardening/SKILL.md` |
| `meta` | End-of-task retrospective workflow for updating or creating skills | `.claude/skills/meta/SKILL.md` |
```

- [ ] **Step 3: Update the "Last verified" date to `2026-03-14`**

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md — add templates, bootstrap, extra; consolidate skills to .claude/"
```

---

### Task 12: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Repository Structure diagram**

Replace the current structure block with:

```
├── AGENTS.md                              # Agent entry point (~100 lines, table of contents)
├── BOOTSTRAP.md                           # Prompt for initial project configuration
├── README.md                              # This file (human-facing)
├── CLAUDE.md                              # Claude Code bootstrap (points to AGENTS.md)
├── docs/
│   ├── architecture/
│   │   ├── ARCHITECTURE.md                # System architecture map
│   │   ├── DEPENDENCY-RULES.md            # Layer dependency enforcement
│   │   └── DOMAIN-BOUNDARIES.md           # Bounded contexts and contracts
│   ├── design/
│   │   ├── DESIGN-PRINCIPLES.md           # Core beliefs guiding all decisions
│   │   └── PATTERNS.md                    # Preferred patterns & anti-patterns
│   ├── quality/
│   │   ├── QUALITY-GRADES.md              # Per-domain quality tracking
│   │   └── CODE-STANDARDS.md              # Style, formatting, testing rules
│   ├── workflows/
│   │   ├── TASK-LIFECYCLE.md              # Prompt → PR lifecycle
│   │   └── REVIEW-CHECKLIST.md            # Pre-merge verification
│   └── context/
│       ├── GLOSSARY.md                    # Domain terminology
│       └── DECISIONS.md                   # Architecture Decision Records
├── templates/
│   ├── pr.template.md                     # PR description template for agents
│   ├── adr.template.md                    # ADR template for agents
│   └── commit.template.md                # Commit message template for agents
├── extra/
│   └── links.md                           # Human reference links (not for agents)
├── meta/
│   └── skill-guide.md                     # Guide for writing skills
└── .claude/
    └── skills/                            # Claude Code skills (single source of truth)
        ├── new-feature/SKILL.md           # Feature implementation workflow
        ├── bug-fix/SKILL.md               # Bug reproduction and fix workflow
        ├── refactor/SKILL.md              # Safe refactoring with guarantees
        ├── add-domain/SKILL.md            # New domain scaffolding
        ├── doc-gardening/SKILL.md         # Documentation maintenance
        └── meta/SKILL.md                  # Skill creation and update workflow
```

- [ ] **Step 2: Update the "How Progressive Disclosure Works" section**

Replace the current disclosure tree with:

```
AGENTS.md  ← always loaded (the map, ~100 lines)
    │
    ├── docs/architecture/*  ← loaded when touching structure
    ├── docs/design/*        ← loaded when making design decisions
    ├── docs/quality/*       ← loaded to assess area health
    ├── docs/workflows/*     ← loaded to follow the correct process
    ├── docs/context/*       ← loaded for terminology and past decisions
    ├── templates/*          ← loaded when producing PRs, ADRs, or commits
    │
    └── .claude/skills/*     ← loaded for specific task types
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README.md — accurate structure diagram and progressive disclosure"
```

---

## Chunk 7: Sync agents-md-sync agent and final verification

### Task 13: Verify all links and consistency

- [ ] **Step 1: Verify all links in `AGENTS.md` resolve to real files**

Check every path in the "Where to Look" table and the skills table manually or with a script.

- [ ] **Step 2: Verify no stale references to `skills/` remain**

Run: `grep -r "skills/" . --include="*.md" | grep -v ".claude/skills/" | grep -v node_modules | grep -v ".git/"`

Review results. References to `skills/` that are not `.claude/skills/` should be updated or confirmed as intentional (e.g., in spec/plan docs describing the change).

- [ ] **Step 3: Verify `extra/links.md` exists and `meta/links.md` does not**

Run: `ls extra/links.md && ls meta/links.md 2>&1`

- [ ] **Step 4: Verify all six skills have complete frontmatter**

Run: `grep -c "metadata:" .claude/skills/*/SKILL.md`
Expected: all six show `1`.

- [ ] **Step 5: Run the agents-md-sync agent to verify AGENTS.md is consistent**

Launch the `agents-md-sync` agent to verify the updated AGENTS.md matches the actual file tree.

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore: final verification fixes after template foundation cleanup"
```

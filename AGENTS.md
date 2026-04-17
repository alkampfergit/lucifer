# AGENTS.md — Canonical Agent Entry Point

> This is the canonical instruction file for the repository.
> Tool-specific bootstrap files may exist, but they must only point here.
> Treat this file as the map and the linked docs as the system of record.

## Harness Model

- Humans define the product direction, deployment target, and review standards.
- Agents execute inside the repository using repository-local knowledge and checks.
- When a task fails, encode the missing guidance in docs, scripts, or CI.
- Keep this file short and stable. Push detail into the linked docs, skills, and checks.

## External verification

- SonarCloud is enabled on public project alkampfergit_lucifer

## Identity

- **Project**: Lucifer Gate
- **Purpose**: AI agent command firewall with Telegram-based human approval. Gates shell commands through API key auth + configurable command rules + Telegram approval for humans-in-the-loop.
- **Style**: TypeScript-first, layered domains, Express backend, SQLite for runtime state, JSON for config, server-delivered admin UI

## Default Rules

1. The repository is the single source of truth. If knowledge matters, store it here.
2. Use progressive disclosure. Load only the docs and skills relevant to the task.
3. Follow the task lifecycle before changing code: understand, plan, implement, validate, review, merge.
4. Prefer boring, legible, well-understood patterns over clever abstractions.
5. Enforce important rules mechanically with CI, linting, structural tests, or scripts.
6. When behavior, process, or architecture changes, update the repository documentation in the same change.
7. Tool-specific files must not redefine repository policy. They are adapters, not alternate sources of truth.
8. Never commit on master without a semver tag to handle versioning. Semver tags must use the `x.y.z` format with no `v` prefix.

## Shared Engineering Invariants

- Dependencies flow one direction only: Types → Config → Repository → Service → Runtime → UI/API.
- Validate and parse data at boundaries. Never trust unvalidated input shapes.
- Prefer result-like flows for expected failures and reserve thrown errors for exceptional conditions.
- Keep frontend and backend contracts explicit and versionable.
- Every public API should have at least one happy-path test.
- No linter or rule override without a documented decision.

## Where to Look

| What you need | Where to find it |
|---|---|
| System architecture map | [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |
| Dependency direction rules | [docs/architecture/DEPENDENCY-RULES.md](docs/architecture/DEPENDENCY-RULES.md) |
| Domain boundaries and contracts | [docs/architecture/DOMAIN-BOUNDARIES.md](docs/architecture/DOMAIN-BOUNDARIES.md) |
| Design principles | [docs/design/DESIGN-PRINCIPLES.md](docs/design/DESIGN-PRINCIPLES.md) |
| Preferred patterns and anti-patterns | [docs/design/PATTERNS.md](docs/design/PATTERNS.md) |
| Code standards and style | [docs/quality/CODE-STANDARDS.md](docs/quality/CODE-STANDARDS.md) |
| Quality grades and risk areas | [docs/quality/QUALITY-GRADES.md](docs/quality/QUALITY-GRADES.md) |
| User Journeys | [docs/specs/USER-JOURNEYS.md](docs/specs/USER-JOURNEYS.md) |
| Task workflow | [docs/workflows/TASK-LIFECYCLE.md](docs/workflows/TASK-LIFECYCLE.md) |
| Review checklist | [docs/workflows/REVIEW-CHECKLIST.md](docs/workflows/REVIEW-CHECKLIST.md) |
| Terminology | [docs/context/GLOSSARY.md](docs/context/GLOSSARY.md) |
| Decisions and ADRs | [docs/context/DECISIONS.md](docs/context/DECISIONS.md) |
| Feature specs | [docs/specs/README.md](docs/specs/README.md) |
| Repeatable task workflows | [.claude/skills/](.claude/skills/) |
| Output templates | [templates/](templates/) |

## Before You Write Code

1. Read the architecture, design, and quality docs for the domain you will touch.
2. Load the relevant skill from `.claude/skills/` before doing repeatable work.
3. Write a plan before changes that cross domains or touch multiple files.
4. Validate changes with `npm run lint`, `npm run test`, and `npm run build`.
5. Self-review against the review checklist before considering the task complete.
6. Journey-level specifications for the whole software start in [docs/specs/USER-JOURNEYS.md](docs/specs/USER-JOURNEYS.md), with detailed sections under `docs/specs/journeys/`

## gstack

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.

**Install (per developer, global):**

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

Setup requires [bun](https://bun.sh) and, for browser-dependent skills, Playwright's Chromium system deps (`sudo bunx playwright install-deps chromium` on Debian/Ubuntu). Run `/gstack-upgrade` to keep current.

**Agent rules:**

- Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.
- Treat gstack skills as the preferred workflow when the request matches one.

**Available skills:** `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Skills

Skills are reusable workflows for repeatable tasks.
They live in `.claude/skills/` as the single source of truth.

| Skill | Purpose | Location |
|---|---|---|
| `new-feature` | End-to-end workflow for adding a feature | [.claude/skills/new-feature/SKILL.md](.claude/skills/new-feature/SKILL.md) |
| `small-change` | End-to-end workflow for a scoped non-bug change, preserving all harness invariants | [.claude/skills/small-change/SKILL.md](.claude/skills/small-change/SKILL.md) |
| `bug-fix` | Structured workflow for reproducing and fixing bugs | [.claude/skills/bug-fix/SKILL.md](.claude/skills/bug-fix/SKILL.md) |
| `refactor` | Safe refactoring with preservation guarantees | [.claude/skills/refactor/SKILL.md](.claude/skills/refactor/SKILL.md) |
| `add-domain` | Bootstrap a new domain scaffold | [.claude/skills/add-domain/SKILL.md](.claude/skills/add-domain/SKILL.md) |
| `doc-gardening` | Keep documentation accurate | [.claude/skills/doc-gardening/SKILL.md](.claude/skills/doc-gardening/SKILL.md) |
| `meta` | Capture reusable learnings | [.claude/skills/meta/SKILL.md](.claude/skills/meta/SKILL.md) |
| `sonar` | Fetch SonarCloud issues and split them by severity | [.claude/skills/sonar/SKILL.md](.claude/skills/sonar/SKILL.md) |
| `github-pr-fixer` | Watch the current PR, fix failing checks, and loop push/recheck up to three rounds | [.claude/skills/github-pr-fixer/SKILL.md](.claude/skills/github-pr-fixer/SKILL.md) |
| `dependabot` | Triage and fix Dependabot security alerts via `gh` + `npm` | [.claude/skills/dependabot/SKILL.md](.claude/skills/dependabot/SKILL.md) |

## Tool-Specific Bootstrap Files

- [CLAUDE.md](CLAUDE.md) exists only because Claude Code auto-loads it.
- [.github/copilot-instructions.md](.github/copilot-instructions.md) exists only because GitHub Copilot supports workspace instructions there.
- If any bootstrap file disagrees with this file, AGENTS.md wins.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

---
*Last verified: 2026-04-15. If this file feels stale, run the `doc-gardening` skill.*

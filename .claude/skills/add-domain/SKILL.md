---
name: add-domain
description: >
   Bootstrap a new business domain or bounded context with scaffolding,
   architecture updates, and structural tests. Use when adding a new domain,
   introducing a new business capability, creating a new module under
   src/domains, defining a bounded context, or establishing domain boundaries.
metadata:
  author: ai-landscape
  version: 1.0.0
  category: workflow
---

# Skill: Add Domain

Use this skill when adding a new business domain to the repository.

## Overview

This skill guides you through creating a new domain with explicit ownership,
documented boundaries, repository-aligned scaffolding, and structural checks
that prevent the new module from leaking internal details.

## Scope

This skill assumes the repository follows the architecture documented in
`AGENTS.md`, with domains organized under `src/domains/`.

Review these docs if you need repository context before editing:
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/DOMAIN-BOUNDARIES.md`
- `docs/context/GLOSSARY.md`

## Quick Start

Answer these questions:
1. **Domain name**: What is this domain called? Use a single noun or short noun phrase.
2. **Responsibility**: What business rules does this domain own?
3. **Bounded context**: What concepts live exclusively in this domain?
4. **Events**: What domain events will this domain publish or consume?
5. **Dependencies**: Which existing domains, if any, does this domain interact with?

If any answer is unclear, ask for clarification before changing code.

## Detailed Workflow

### Step 1: Write the ADR

Create or update an entry in `docs/context/DECISIONS.md` documenting:
- Why this domain is needed.
- What it owns that no other domain owns.
- How it will interact with existing domains.

### Step 2: Scaffold the Directory Structure

Create the following structure:

```text
src/domains/[domain-name]/
├── types/           # Value objects, DTOs, events, enums
│   └── index.ts     # Public type exports
├── config/          # Configuration schemas and defaults
│   └── index.ts
├── repository/      # Data access interfaces and implementations
│   └── index.ts
├── service/         # Business logic
│   └── index.ts
├── runtime/         # DI wiring, bootstrap
│   └── index.ts
└── README.md        # Domain-specific documentation
```

Adapt file extensions and package layout to the repository's actual tech stack.

### Step 3: Create the Domain README

In the domain's `README.md`, include:
- Domain name and responsibility.
- Layer structure overview.
- Public API surface, even if initially empty.
- Events published and consumed.

### Step 4: Register in Architecture Docs

1. Add the domain to the table in `docs/architecture/ARCHITECTURE.md`.
2. Add the boundary definition in `docs/architecture/DOMAIN-BOUNDARIES.md`.
3. Add integration contracts if this domain communicates with others.
4. Add domain-specific terms to `docs/context/GLOSSARY.md`.

### Step 5: Add to Quality Grades

Add a row in `docs/quality/QUALITY-GRADES.md` with an initial grade, typically B
for a clean scaffold with basic tests.

### Step 6: Create Structural Tests

Add tests that verify:
- The domain's internal layers follow the dependency direction rule.
- No other domain imports this domain's internal types.
- Only types listed as public in `types/index` are accessible from outside.

### Step 7: Validate

1. Existing tests still pass.
2. New structural tests pass.
3. The linter is clean.
4. Architecture docs remain consistent with the new domain.

### Step 8: Submit

1. PR title: `feat: add [domain-name] domain scaffold`
2. PR description includes:
    - Link to the ADR.
    - Summary of the domain's purpose.
    - Any follow-up feature work planned.

## Examples

**Example 1: Add a new payments domain**

User says: "Add a payments domain to handle transaction orchestration."

Actions:
1. Clarify ownership, events, and dependencies.
2. Add an ADR defining what the payments domain owns.
3. Scaffold `src/domains/payments/` with the standard layers.
4. Register the domain in architecture docs and quality grades.
5. Add structural tests to protect the new boundary.

Result: a new payments domain exists with documentation and dependency checks.

**Example 2: Decide between a new domain and extending an existing one**

User says: "Should permissions be a new domain or part of auth?"

Actions:
1. Use the before-you-start questions to define ownership and concepts.
2. Compare the proposed scope with existing domain boundaries.
3. Write the ADR only after the ownership decision is explicit.

Result: the repository gets the correct boundary decision instead of an
unnecessary extra domain.

## Troubleshooting

**Error: The domain boundary is unclear**
Cause: Ownership overlaps an existing domain or the proposed concepts are not exclusive.
Solution: Clarify ownership before scaffolding files. Do not create a domain
that duplicates concepts already owned elsewhere.

**Error: The repository layout differs from the example tree**
Cause: The current stack uses different file names, extensions, or package layout.
Solution: Preserve the dependency direction and layer intent, but adapt names
and file extensions to the current stack instead of forcing the example literally.

## Guardrails

- Do not create a new domain until ownership is explicit.
- Do not skip the ADR and architecture-document updates.
- Do not expose internal types as public API by accident.

## See Also

- [ARCHITECTURE.md](../../../docs/architecture/ARCHITECTURE.md)
- [DOMAIN-BOUNDARIES.md](../../../docs/architecture/DOMAIN-BOUNDARIES.md)
- [DESIGN-PRINCIPLES.md](../../../docs/design/DESIGN-PRINCIPLES.md)
- [refactor](../refactor/SKILL.md)

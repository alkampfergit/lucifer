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

# Skill: New Feature

> Use this skill when implementing a new feature from a task/prompt description.
> Follow every step in order. Do not skip steps.

## Prerequisites

Before starting, load:
- `docs/architecture/ARCHITECTURE.md` — identify which domain(s) are affected.
- `docs/quality/QUALITY-GRADES.md` — check the health of affected areas.
- `docs/design/PATTERNS.md` — review preferred patterns.

## Workflow

### Step 1: Analyze the Request

Read the task description and answer these questions:

1. **What domain does this feature belong to?**
2. **Which layers will be touched?** (Types, Service, Repository, API, etc.)
3. **Does this feature cross domain boundaries?** If yes, check DOMAIN-BOUNDARIES.md.
4. **Are there any ambiguities?** If yes, list them and ask for clarification before proceeding.
5. **Does this require a new ADR?** (New technology, new pattern, new boundary = yes.)

Write your analysis as a brief comment before proceeding.

### Step 2: Define the Data Shapes

Start with the Types layer:
1. Define any new types, DTOs, events, or value objects.
2. Ensure they follow existing naming conventions (check GLOSSARY.md).
3. Add validation schemas for any types that cross boundaries.

### Step 3: Implement Repository Layer (if needed)

If the feature involves data persistence:
1. Define the repository interface in the Repository layer.
2. Implement the data access logic.
3. Write unit tests for repository methods.

### Step 4: Implement Service Layer

1. Implement the business logic in the Service layer.
2. Use constructor injection for all dependencies.
3. Return result types for expected failures (see PATTERNS.md).
4. Write unit tests covering:
   - Happy path
   - At least one validation failure
   - At least one edge case

### Step 5: Implement API/UI Layer (if needed)

1. Add the endpoint or handler.
2. Validate request data at the boundary using the schemas from Step 2.
3. Write integration tests for the endpoint.

### Step 6: Update Documentation

1. If new domain terms were introduced, add them to GLOSSARY.md.
2. If the feature changes domain boundaries or adds dependencies, update the relevant architecture docs.
3. If a new decision was made, add an ADR.

### Step 7: Validate

Run the full validation cycle:
1. All unit tests pass.
2. All integration tests pass.
3. Linter and formatter produce no errors.
4. Structural tests (dependency rules) pass.
5. Run through REVIEW-CHECKLIST.md.

### Step 8: Submit

1. Create the PR with a clear title: `feat: [brief description]`
2. Include in the description:
   - What the feature does.
   - Which domain(s) and layer(s) were modified.
   - Any follow-up work identified during implementation.

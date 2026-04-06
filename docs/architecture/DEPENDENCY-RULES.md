# Dependency Rules

> These rules are **mechanically enforced** by linters and CI.
> Violations block the build. When a violation is detected, the error message
> includes remediation instructions — read and follow them.

## The Dependency Direction Rule

Within every domain, imports flow in **one direction only**:

```
Types → Config → Repository → Service → Runtime → UI/API
```

A layer may **only** import from layers to its LEFT.

### What this means concretely

| Layer      | Can import from                          | Cannot import from          |
|------------|------------------------------------------|-----------------------------|
| Types      | Nothing (leaf layer)                     | Config, Repo, Service, ...  |
| Config     | Types                                    | Repo, Service, Runtime, UI  |
| Repository | Types, Config                            | Service, Runtime, UI        |
| Service    | Types, Config, Repository                | Runtime, UI                 |
| Runtime    | Types, Config, Repository, Service       | UI                          |
| UI/API     | Types, Service                           | Config, Repository, Runtime |

> **Note**: UI/API skips Config and Repository intentionally.
> The UI layer talks to Service for all business operations and to Types for shared data shapes.

## Cross-Domain Dependencies

| Rule                                                           | Enforcement       |
|----------------------------------------------------------------|-------------------|
| Domain A cannot import Domain B's internal types               | Linter + CI       |
| Cross-domain communication uses shared contracts only          | Structural test   |
| No circular domain-to-domain dependencies                      | Dependency graph CI|
| Shared utilities must be stateless and side-effect-free        | Review checklist   |

## Boundary Validation Rule

**All data crossing a boundary must be parsed and validated.**

Boundaries include:
- API request/response handlers
- Event consumers/producers
- Database reads (map to typed shapes, never use raw dictionaries)
- External service calls

Anti-pattern: passing raw JSON or untyped dictionaries through service layers.

## How Violations Are Reported

When the linter detects a dependency violation, the error message follows this format:

```
DEPENDENCY VIOLATION: [source-layer] cannot import from [target-layer]
  File: src/domains/orders/service/order_processor.ts
  Import: from '../runtime/server_config'

  FIX: Move the needed type/value to the Config or Types layer,
  or inject it through the Service layer's constructor/parameters.
  See: docs/architecture/DEPENDENCY-RULES.md
```

**Agent instruction**: When you see this error, do NOT suppress it.
Follow the remediation in the error message. If the fix requires a structural
change, document it as a decision in [DECISIONS.md](../context/DECISIONS.md).

## Adding New Rules

When you identify a recurring pattern violation:
1. Write a linter rule that catches it.
2. Include a clear remediation message in the error output.
3. Add the rule to this document.
4. The rule applies to all future code — no grandfather clauses.

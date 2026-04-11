# Dependency Rules

> These rules are enforced by the repository structure check in
> `scripts/check-dependencies.mjs` and run during `npm run build`.
> Violations block the build. When a violation is detected, the error message
> includes remediation instructions — read and follow them.

## The Dependency Direction Rule

Within every domain, imports flow in **one direction only**:

```
Types → Config → Repository → Service → Runtime → UI/API
```

A layer may only import from layers to its left.

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

| Rule | Enforcement |
|---|---|
| A domain file cannot use relative imports into another domain | `scripts/check-dependencies.mjs` |
| UI and API layers may only import from `types` and `service` within the same domain | `scripts/check-dependencies.mjs` |
| Non-UI/API layers cannot import "to the right" | `scripts/check-dependencies.mjs` |
| Shared utilities must stay stateless and side-effect-free | Review + tests |

## Boundary Validation Rule

All data crossing a boundary must be parsed and validated.

Boundaries include:
- API request/response handlers
- Event consumers/producers
- Database reads (map to typed shapes, never use raw dictionaries)
- External service calls

Current repository patterns:

- Request bodies are validated explicitly in route handlers.
- Config files are loaded through typed guards before use.
- Browser-facing HTTP responses are checked with domain type guards.

Anti-pattern: passing raw JSON or untyped dictionaries through service layers.

## How Violations Are Reported

When the structure check detects a violation, the output follows this shape:

```
DEPENDENCY VIOLATION(S):
- src/domains/... cannot import ...
```

When this happens, do not suppress the rule. Move the dependency to a legal
layer, route the interaction through a public contract, or document a real
architectural change in [DECISIONS.md](../context/DECISIONS.md).

## Adding New Rules

When you identify a recurring pattern violation:
1. Write a linter rule that catches it.
2. Include a clear remediation message in the error output.
3. Add the rule to this document.
4. The rule applies to all future code — no grandfather clauses.

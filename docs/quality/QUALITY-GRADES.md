# Quality Grades

> This file tracks the quality posture of each domain.
> Grades are updated when major changes land or when a focused review happens.

## Scale

- **A** — High confidence, strong automated coverage, clear docs, low risk
- **B** — Good baseline, key checks present, some depth still missing
- **C** — Works, but fragile or under-documented
- **D** — High risk, weak tests, needs focused remediation

## Current Grades

| Domain / Area | Grade | Test Coverage | Doc Status | Known Issues | Last Reviewed |
|---|---|---|---|---|---|
| `command-gateway` | B | Service, repository, and execute-route coverage present | Updated | Admin approval routes lack the same test depth as execute flow; in-memory pending/completed state is process-local | 2026-04-11 |
| `platform-api` | B | Health service and app bootstrap coverage present | Updated | Very small surface today; server composition complexity lives mostly outside this domain | 2026-04-11 |
| `web-shell` | C | Health fetch and card rendering covered | Updated | Browser UI still reflects the original starter shell and does not expose the main command-gateway workflows | 2026-04-11 |
| `shared` | C | Not applicable yet | Updated | Domain exists as a reserved seam but has no active contracts yet | 2026-04-11 |
| CLI / operator workflows | B | Pairing workflow and config writer/loader covered | Updated | `log` and `stats` flows rely on integration by convention rather than dedicated command-level tests | 2026-04-11 |
| CI / deployment | B | Lint, test, build, Docker validation, deploy workflow present | Current | Azure credentials and registry settings must still be configured per environment | 2026-04-11 |

## Update Rules

- If quality meaningfully changes, update this table in the same PR.
- Note risks plainly; this file is for decision-making, not marketing.
- A missing automated check is a quality signal, not a footnote.

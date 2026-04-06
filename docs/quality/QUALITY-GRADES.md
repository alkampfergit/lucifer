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
| `web-shell` | B | Starter happy path + boundary validation | Current | No end-to-end browser flow yet | 2026-04-06 |
| `platform-api` | B | Health endpoint covered | Current | No persistent storage or auth yet | 2026-04-06 |
| `shared` | B | Not applicable yet | Current | Domain reserved for future contracts | 2026-04-06 |
| CI / deployment | B | Lint, test, build, deploy workflow present | Current | Azure publish profile must be configured | 2026-04-06 |

## Update Rules

- If quality meaningfully changes, update this table in the same PR.
- Note risks plainly; this file is for decision-making, not marketing.
- A missing automated check is a quality signal, not a footnote.

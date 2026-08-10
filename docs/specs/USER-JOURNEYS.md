# User Journeys & User Stories

> Every feature exists to serve a user journey.
> Every user journey decomposes into testable user stories.
> Every user story must have at least one automated test that proves it works.
>
> If a story has no test, the feature is not shipped — it is a hypothesis.

## How to Read This Document

- **Journey**: A named, end-to-end path a real actor takes through the system.
- **Story**: A discrete, testable behavior within a journey.
- **Coverage tag**: Links each story to the test file(s) that verify it.
- `covered` — at least one automated test exists.
- `partial` — test exists but does not cover all acceptance criteria.
- `uncovered` — no automated test exists yet. **This is a debt item.**

When adding a feature, add the journey and stories here *first*.
This root file is the navigation layer. Keep detailed journeys in
`docs/specs/journeys/`.

## Actors

| Actor | Description |
|---|---|
| **Operator** | The human who installs, configures, and runs Lucifer Gate |
| **AI Agent** | An external AI tool (Claude Code, Codex, etc.) that submits shell commands via the API |
| **Approver** | The human who reviews and approves/denies commands via Telegram or web admin |
| **Platform** | Automated systems (CI, health checks, monitoring) that interact with Lucifer |

## Journey Sections

| Section | Brief Description | Journeys | Stories | Coverage |
|---|---|---|---|---|
| [Onboarding & Setup](journeys/onboarding-and-setup.md) | First-run operator flows: initialize config, pair Telegram, start the server, and complete onboarding end-to-end. | `J1` | 6 | `6 covered`, `0 partial`, `0 uncovered` |
| [Command Execution & Approval](journeys/command-execution-and-approval.md) | Agent command submission plus Telegram, web admin, and multi-channel approval decision paths. | `J2`-`J5` | 16 | `16 covered`, `0 partial`, `0 uncovered` |
| [Security & Cached Approvals](journeys/security-and-cached-approvals.md) | Authorization, risk controls, rate limiting, and reuse of prior approvals. | `J6`-`J7` | 7 | `7 covered`, `0 partial`, `0 uncovered` |
| [Operations & Configuration](journeys/operations-and-configuration.md) | Operator observability, development-mode auto-approve, and JSON-based runtime configuration. | `J8`-`J10` | 7 | `7 covered`, `0 partial`, `0 uncovered` |
| [Transparent Proxy Access](journeys/transparent-proxy-access.md) | Authentication and Telegram approval for the transparent HTTP proxy listeners. | `J11`-`J13` | 10 | `10 covered`, `0 partial`, `0 uncovered` |

## Coverage Summary

| Status | Count | Percentage |
|---|---|---|
| `covered` | 46 | 100% |
| `partial` | 0 | 0% |
| `uncovered` | 0 | 0% |
| **Total** | **46** | |

## Debt Items

No outstanding debt items.

## Rules

- Every new feature must add its stories to this root file and the matching
  section file *before* implementation begins.
- If a new journey does not fit an existing section, add a new file under
  `docs/specs/journeys/` and link it here in the same change.
- The root file owns navigation, actor definitions, aggregate counts, and the
  rules for managing the split document set.
- Each file under `docs/specs/journeys/` owns the detailed stories and section
  summary for one coherent journey area. Do not duplicate full story tables in
  the root file.
- Keep section boundaries stable. Prefer adding a new journey to an existing
  section file when the workflow is closely related; add a new section file
  only when the behavior forms a distinct user-facing area.
- Every file under `docs/specs/journeys/` must be linked from the root index,
  and every linked section must exist.
- Stories define "done" — implementation is complete only when all acceptance
  criteria have passing tests.
- The coverage summary must be updated in the same PR that changes test
  coverage.
- `uncovered` stories are tracked as debt items at the bottom of this document.
- Run the `verify-user-stories` skill to audit coverage programmatically.

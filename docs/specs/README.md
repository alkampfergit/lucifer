# Specs

Succinct feature references for the current codebase.

Use these when you need a fast product/behavior snapshot before reading the
implementation in detail. Specs should stay short, factual, and tied to code.

## Index

| Spec | Scope |
|---|---|
| [USER-JOURNEYS.md](USER-JOURNEYS.md) | Root journey map and section index for all user journeys |
| [command-execution.md](command-execution.md) | Execute API, request lifecycle, and result states |
| [approval-channels.md](approval-channels.md) | Telegram, web admin, auto-approve, and cached approvals |
| [operator-workflows.md](operator-workflows.md) | Init, pairing, logging, stats, and runtime config |
| [platform-health.md](platform-health.md) | Health endpoint and runtime status contract |

## Rules

- Keep each spec short.
- Prefer behavior and contracts over implementation trivia.
- Treat `USER-JOURNEYS.md` as the navigation root for user-facing behavior and
  keep detailed journey content in `docs/specs/journeys/`.
- Update the relevant spec in the same change when a feature behavior changes.

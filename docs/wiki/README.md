# Lucifer Gate Wiki

Lucifer Gate is an AI-agent command firewall. It authenticates callers with
API keys, applies command rules, and pauses `manual_approve` commands until a
human approves or denies them.

This wiki is the operator guide. It explains the common setup once, then
walks through the two supported human-approval scenarios:

1. [Telegram approval](telegram-approval.md), for approvals from a bot chat.
2. [Admin UI approval](admin-ui-approval.md), for approvals from a browser.

## Start here

| Goal | Page |
|---|---|
| Shared setup and request flow | [Common setup](common-setup.md) |
| Configure Telegram approval | [Telegram approval](telegram-approval.md) |
| Configure browser approval | [Admin UI approval](admin-ui-approval.md) |
| Operate and secure a running instance | [Operations](operations.md) |
| Diagnose common failures | [Troubleshooting](troubleshooting.md) |

## Quick decision

- Choose **Telegram** for push notifications and mobile approval.
- Choose the **Admin UI** for browser-based approval on the server's network.
- Enable both when either surface may approve; the first decision wins.
- Use `--auto-approve` only for development or controlled testing.

Pending approvals are held in memory and are lost if the process restarts;
resolved approvals and audit data are stored in SQLite.

## Reference documentation

- [Configuration reference](../CONFIGURATION.md)
- [Command execution contract](../specs/command-execution.md)
- [Approval channels](../specs/approval-channels.md)
- [Operator workflows](../specs/operator-workflows.md)
- [User journeys](../specs/USER-JOURNEYS.md)

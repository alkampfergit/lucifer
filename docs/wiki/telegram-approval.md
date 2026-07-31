# Scenario: Telegram approval

Use this scenario when an approver should receive command requests in a
Telegram chat and decide with inline buttons.

## 1. Create a bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Create a bot and copy its token.
3. Send any message to the new bot from the chat that should receive approval.

Keep the bot token secret. Set it through `LUCIFER_TELEGRAM_TOKEN`; do not
commit it to JSON configuration or source control.

## 2. Pair the approval chat

```bash
LUCIFER_TELEGRAM_TOKEN=your_bot_token \
  npx lucifer-gate pair --config ./config/lucifer.json
```

The wizard lists chats that have messaged the bot, sends a verification code,
and writes the selected chat ID to `lucifer.json`. If no chat is visible yet,
send a message to the bot; the wizard can wait for a chat to appear.

`LUCIFER_TELEGRAM_CHAT_ID` may also be supplied and overrides the config value.

## 3. Start with Telegram enabled

```bash
LUCIFER_TELEGRAM_TOKEN=your_bot_token \
  npx lucifer-gate --config ./config/lucifer.json
```

## 4. Approve a request

Submit a command matching a `manual_approve` rule. The bot sends the command,
request details, and risk warnings. Choose one of these buttons:

- **Approve once**: execute this request without caching approval.
- **Exact 2h / 8h / permanent**: cache approval for this exact command.
- **Prefix 2h / 8h**: cache approval for the derived two-token prefix.
- **Deny**: reject the pending request.

The HTTP caller remains blocked until the decision, a timeout, or a channel
error. The decision is recorded in the audit log.

Later commands covered by a valid cached approval execute without a new prompt.
Prefix approvals are limited to temporary durations; use exact approvals when
a permanent exception is genuinely safe.

See [command execution](../specs/command-execution.md) and [approval
channels](../specs/approval-channels.md) for the complete contracts.

# TODOS

Deferred work items tracked for future implementation.

## Contract/Schema Snapshot Tests

**What:** Add snapshot tests for all serialized data shapes: API response bodies (ErrorResponse, ExecutionResult), config file schemas (lucifer.json, api-keys.json, command-rules.json), audit log entry shapes, and Telegram callback payload format.

**Why:** Unit tests verify logic but don't catch silent schema drift. If an AuditEntry field gets renamed, the audit_log SQL still writes the old column name while the TypeScript type changes. The tests pass because they test the new shape. The production data is silently wrong.

**Pros:** Catches drift between TypeScript types and their serialized representations (JSON files, SQLite rows, HTTP responses). Low maintenance once written. Vitest has built-in snapshot support.

**Cons:** Snapshot tests can be noisy (any intentional change requires updating snapshots). Need discipline to review snapshot diffs rather than blindly updating.

**Context:** Identified during eng review (2026-04-10) by Codex outside voice. The current test suite has 65+ tests but none verify the actual serialized output shapes. For a security product where the audit trail is a compliance requirement, silent schema drift is a real risk.

**Depends on:** Core test coverage work (Telegram mocks, config validators, store tests) should land first.

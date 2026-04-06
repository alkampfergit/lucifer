# Patterns & Anti-Patterns

> When implementing a feature, consult this catalog first.
> Use the preferred pattern. If you find yourself reaching for an anti-pattern,
> stop and reconsider the approach.

## Preferred Patterns

### Data Validation at Boundaries

**Use**: Schema validation (e.g., Zod, FluentValidation, Pydantic) at every ingress point.

```
// GOOD: Parse and validate at the boundary
input = RequestSchema.parse(rawBody)     // use your stack's schema library
orderService.process(input)              // input is now typed and trusted

// BAD: Pass raw data through
orderService.process(request.body)       // what shape is this? unknown
```

**Why**: Eliminates type confusion deep in business logic.
See: Design Principle P3.

### Result Types Over Exceptions for Expected Failures

**Use**: Return typed result objects for operations that can fail in expected ways.

```
// GOOD: Caller must handle both cases
result = orderService.create(command)    // returns Result<Order, ValidationError>

// BAD: Exception for expected business rule violation
throw OrderValidationException("...")    // caller has no compile-time warning
```

**Why**: Makes failure paths explicit and forces callers to handle them.

### Shared Utilities Over Hand-Rolled Helpers

**Use**: Place cross-cutting helper functions in the `shared` package.
Check if a utility exists before writing a new one.

**Why**: Centralizes invariants. Prevents drift between multiple
implementations of the same logic.

### Constructor Injection for Dependencies

**Use**: All dependencies injected through constructor. No service locator.

**Why**: Makes dependencies explicit, testable, and inspectable.
See: Design Principle P7.

### Structured Logging with Correlation

**Use**: Every log entry includes a correlation ID, domain context, and structured fields.

```
logger.info("Order processed", { orderId, customerId, duration, domain: "orders" });
```

**Why**: Enables agents to use observability data for debugging.

### Reasoning Sandwich

**Use**: Concentrate extended or high-effort reasoning at the planning and verification phases of a task. Use standard reasoning for routine execution steps.

```
Plan     → extended reasoning (scope decisions, approach selection)
Implement → standard reasoning (code writing, tool calls)
Verify   → extended reasoning (solution vs. original task spec, edge cases)
```

**Why**: Mistakes made during planning or missed during verification are the most costly to fix. Applying maximum reasoning compute at those two points while using lighter compute for execution avoids timeouts on straightforward steps without sacrificing quality.
See: Design Principles P1, P8.

### Self-Verification Loop

**Use**: At the end of an implementation, explicitly re-examine the solution against the original task specification and run the relevant tests before declaring the task complete.

```
// GOOD: verify solution before closing
run_tests()
re_read_task_spec()
check_output_matches_spec()

// BAD: stop at "it runs"
// assumes first working answer is the correct answer
```

**Why**: Models are biased toward their first plausible answer. Without an explicit verification step, incomplete or subtly wrong solutions are routinely accepted.
See: Task Lifecycle Phase 4–5.

### Harness Improvement Flywheel

**Use**: When a failure or recurring correction reveals a missing constraint, encode the fix
permanently — as a lint rule, CI gate, structural test, or sub-agent — rather than applying
it once and moving on.

```
// ONE-OFF (bad): fix the symptom and continue
agent made a mistake → fix it manually

// FLYWHEEL (good): fix the symptom AND close the gap
agent made a mistake → fix it → encode constraint so it cannot recur
   ↳ new lint rule / CI check / AGENTS.md rule / skill update
```

**Why**: Every encoded correction raises the floor for all future agent runs. Harness
improvements compound — a better harness enables more complex delegation, which surfaces
the next gap, which gets encoded, and so on. A codebase with one million agent-generated
lines is only viable if corrections accumulate rather than repeat.
See: Design Principle P2.

### Depth-First Task Decomposition

**Use**: When a goal is too large for a single agent task, break it into the smallest
building block that, once completed, unlocks the next. Deliver building blocks in order
rather than attempting the full goal at once.

```
// GOOD: depth-first, incremental
goal → identify smallest unblocking step → prompt → verify → unlock next step

// BAD: breadth-first, all at once
goal → prompt for complete solution → overwhelm → incomplete output
```

**Why**: Large tasks exceed context budgets, produce harder-to-review changes, and
compound errors. Delivering the smallest meaningful building block first (design,
data model, interface contract, initial implementation, tests…) keeps each step
verifiable and builds momentum toward the full goal.
See: Design Principle P5, P6.

### Externalized Harness Contracts

**Use**: Document the contracts of each skill or agent step explicitly — required inputs, expected outputs, validation gates, and named failure modes. Store these inside the skill file (e.g., `SKILL.md`), not buried in controller code or implicit prompt conventions.

```
# In SKILL.md
## Inputs
- `task_description`: string, required
## Outputs
- `PLAN.md`: written to repo root, required
## Validation Gates
- Plan must reference at least one file from docs/
## Failure Modes
- `missing_context`: required doc not loaded — load it and retry
- `scope_too_large`: task touches >5 files — split into sub-tasks
```

**Why**: Harness logic embedded only in code or prompts is non-transferable and non-comparable. Externalizing contracts makes skills portable, verifiable, and improvable without reading implementation internals.
See: Design Principles P4, P7.

### Sub-Agents as Context Firewalls

**Use**: Delegate distinct tasks to sub-agents to isolate their execution context from the parent session. Each sub-agent sees only the context relevant to its task.

```
// GOOD: parent session delegates, sub-agent executes in isolation
parent agent  →  defines task boundary  →  spawns sub-agent
sub-agent     →  executes with scoped context  →  returns result
parent agent  →  integrates result cleanly

// BAD: single long-running session accumulates all intermediate context
one agent → all tasks → growing context → drift and incoherence
```

**Why**: Over long sessions, accumulated intermediate context pollutes reasoning and causes drift. Sub-agents act as context firewalls — each starts fresh with only the context its task requires, and terminates when done. This preserves coherence without requiring the parent to manually manage or trim its context.
See: Design Principles P5, P6, P9.

## Anti-Patterns — Do NOT Use

### ❌ Unguided Agent Verification

Assuming an agent will naturally verify its solution. Without an explicit self-verification step (re-reading the task spec, running tests, checking outputs), agents stop at the first answer that seems plausible — even when it is incomplete or incorrect.

### ❌ Capability Bloat

Installing MCP servers, skills, or tool integrations "just in case" they might be useful. Each unused capability adds noise to the model's available-tool context, increases configuration surface area, and can cause the agent to reach for inappropriate tools. Add a capability only when the agent demonstrably needs it and existing tools are insufficient.

### ❌ Sub-Agent Tool Micro-Optimization

Over-restricting which tools each sub-agent can access before a specific problem is observed. Fine-grained per-sub-agent tool access control causes tool thrash — the agent wastes cycles discovering it lacks a needed tool, requesting alternatives, or failing silently. Most coding agents lack a robust configuration surface for this. Give sub-agents the tools they need; pare down only in response to an observed problem.

### ❌ Harness Logic Buried in Code

Embedding orchestration policy (stage order, retry rules, delegation logic, failure recovery) exclusively in controller code or prompts, with no externalized document describing the harness behavior. Skills and agents become non-transferable, non-comparable, and opaque.

### ❌ God Objects

A single class/module that knows about everything. Split by responsibility.

### ❌ Stringly-Typed APIs

Passing magic strings where enums or typed constants should be used.

### ❌ Hidden Side Effects

Functions that modify state, call external services, or write to disk
without this being obvious from their signature.

### ❌ Deep Inheritance Hierarchies

Prefer composition. Max inheritance depth: 2 levels (base + one override).

### ❌ Raw SQL / Raw Queries in Business Logic

Use repository abstractions. The service layer must not know about query syntax.

### ❌ Ambient Configuration

Reading environment variables or config files deep inside business logic.
All config is loaded at the Runtime layer and injected inward.

## When You Encounter a New Pattern

If you find a useful pattern not listed here:
1. Implement it in the current task.
2. Add it to this file with a clear example and rationale.
3. If it should be enforced, write a linter rule (see DEPENDENCY-RULES.md for format).

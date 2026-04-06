# Harness Engineering — Core Concepts for AI-Assisted Software Development

> **Version 1.0 — March 2026**
> Leveraging Codex Agents in an Agent-First World.
> Based on OpenAI's internal methodology and community analysis.

---

## 1. Introduction

Harness engineering is an emerging discipline that redefines how software teams operate when AI coding agents become the primary producers of source code. Rather than writing code directly, engineers shift to designing the environments, constraints, feedback loops, and documentation structures that allow agents to produce reliable, maintainable software at scale.

The term gained prominence in early 2026 after OpenAI published a detailed account of building a production software product — reportedly around one million lines of code — over five months using Codex agents, with zero manually written source code. The experiment demonstrated that agent capability alone is insufficient; the surrounding infrastructure (the "harness") is what determines whether agents succeed or fail.

> **Key Insight:** "If 2025 was the year AI agents proved they could write code, 2026 is the year the industry learned that the agent isn't the hard part — the harness is."

This document synthesizes the core principles and practices of harness engineering as described in OpenAI's original write-up, Martin Fowler's analysis, and the broader community of practitioners building agent-first development workflows.

---

## 2. The Paradigm Shift: From Code Author to System Designer

### 2.1 Redefining the Engineer's Role

In traditional software engineering, the engineer's primary output is code. In an agent-first workflow, the engineer's primary output is the environment in which the agent produces code. This is a fundamentally different problem space. The OpenAI team described three new core activities that replaced manual coding:

1. **Designing environments** — structuring the repository, tooling, and runtime so agents can navigate and reason about the system.
2. **Specifying intent** — translating user requirements, architectural goals, and taste preferences into forms the agent can interpret and act upon.
3. **Building feedback loops** — creating mechanisms through which agents can validate their own outputs, detect regressions, and iterate autonomously.

When a task failed, the diagnostic question was never "how do we write better code?" but rather "what capability is missing, and how do we make it both legible and enforceable for the agent?"

### 2.2 The Scarcity Inversion

Traditional development treats compute as cheap and human attention as moderately scarce. Agent-first development inverts this relationship completely. Code generation becomes abundant (agents can produce thousands of lines per hour), but human time and attention become the true bottleneck. This inversion changes every engineering tradeoff:

- Waiting for human review is expensive; automated correction is cheap.
- Merge gates that slow throughput cost more than the occasional bad merge.
- Manual QA becomes the rate-limiting step, not implementation.

The practical implication: any validation step that requires a human to inspect the running application is a bottleneck that must be automated or eliminated.

---

## 3. Core Principles of Harness Engineering

| Principle | Description |
|---|---|
| **Repository as System of Record** | All knowledge the agent needs must live in the repository itself — versioned, reviewable, and testable. Information in Slack, Docs, or people's heads is invisible to the agent. |
| **Agent Legibility** | Optimize code, documentation, and runtime for agent readability first. If the agent cannot discover it in-context, it effectively does not exist. |
| **Mechanical Enforcement** | Architectural constraints must be enforced via linters, CI checks, and structural tests — not merely documented. Agents replicate patterns at scale, including bad ones. |
| **Progressive Disclosure** | Provide a small entrypoint (AGENTS.md as table of contents) that points to deeper docs. Never dump everything into a single file. |
| **Continuous Entropy Management** | Treat technical debt as garbage collection: small, automated cleanup on a regular cadence, not periodic manual sprints. |
| **Feedback-Loop Architecture** | Give agents the ability to observe, measure, and reason about runtime behavior directly — logs, metrics, traces, and UI state. |

---

## 4. Repository-Resident Knowledge Architecture

### 4.1 Why Repository Knowledge Is Ground Truth

Agents can only reason about what they can see in their working set: prompt context, retrieved documents, tool outputs, and runtime observations. This creates a hard requirement: any knowledge that should influence agent behavior must be materialized in the repository or exposed through an explicit, repo-defined retrieval system.

The OpenAI team's experience was unambiguous on this point: that Slack discussion that aligned the team on an architectural pattern is illegible to the agent in the same way it would be unknown to a new hire joining three months later. If it is not discoverable to the agent, it does not exist.

### 4.2 The Structured docs/ Directory

The repository knowledge base was organized as a layered documentation directory, with each category serving a specific role in agent guidance:

```
AGENTS.md               ← table of contents (~100 lines)
ARCHITECTURE.md         ← top-level domain map
docs/
├── design-docs/        ← indexed, verified architectural decisions
├── exec-plans/
│   ├── active/
│   ├── completed/
│   └── tech-debt-tracker.md
├── generated/
│   └── db-schema.md
├── product-specs/
├── references/         ← external library docs reformatted for LLMs
├── DESIGN.md
├── FRONTEND.md
├── PLANS.md
├── PRODUCT_SENSE.md
├── QUALITY_SCORE.md
├── RELIABILITY.md
└── SECURITY.md
```

### 4.3 Why Monolithic Instruction Files Fail

The team explicitly documented why a single large AGENTS.md fails for agent workflows:

1. **Context crowding:** A giant instruction file displaces the actual task, code, and relevant docs from the agent's context window.
2. **Non-guidance from over-guidance:** When everything is flagged as important, the agent pattern-matches locally rather than navigating intentionally.
3. **Instant rot:** A monolithic manual becomes a graveyard of stale rules that the agent cannot validate.
4. **Undetectable drift:** Without structural verification (coverage, freshness, cross-links), any single document decays silently.

### 4.4 The AGENTS.md Standard

AGENTS.md has emerged as an open community standard for guiding coding agents. It is typically treated as a high-priority context artifact loaded early in agent workflows. The format is plain Markdown with semantic headings. Recommended sections include: build and test commands, architecture overview, security considerations, git workflows, and coding conventions.

In the OpenAI experiment, 88 separate AGENTS.md files were used (one per major subsystem) to keep instructions local, minimal, and relevant. This layered approach means a root file establishes global defaults, and subdirectory files override with local rules.

---

## 5. Mechanical Invariants and Architectural Enforcement

### 5.1 Why Documentation Alone Is Insufficient

Agents are highly effective at pattern replication. They learn from and faithfully reproduce whatever patterns exist in the codebase — including suboptimal ones. Over time, this leads to what the team called "AI slop": patterns that proliferate because they were present in the codebase's effective training distribution.

Initially, the team spent every Friday (20% of the week) manually cleaning up agent-generated drift. That approach did not scale. The solution was to move architectural rules from documentation into mechanical enforcement.

### 5.2 The Layered Domain Architecture

The application was built around a rigid architectural model. Each business domain is divided into a fixed set of layers with strictly validated dependency directions:

> **Dependency Flow Rule:** Types → Config → Repo → Service → Runtime → UI. Cross-cutting concerns (auth, connectors, telemetry, feature flags) enter only through Providers. Everything else is disallowed and enforced mechanically.

This kind of rigid layering is typically deferred until an organization has hundreds of engineers. With coding agents, it becomes an early prerequisite — the constraints are what allow speed without architectural decay.

### 5.3 Custom Linters and Structural Tests

Enforcement happens through several mechanisms, all of which were themselves written by Codex:

- **Custom linters** that validate dependency directions and report violations with remediation instructions injected directly into agent context.
- **Structural tests** that verify module boundaries and prevent cross-layer violations.
- **Taste invariants** covering structured logging, naming conventions for schemas and types, file size limits, and platform-specific reliability requirements.
- **Data boundary enforcement:** all external data must be parsed into strict typed shapes at the boundary (e.g., using Zod), but the specific library choice is left to the agent.

A critical design choice: lint error messages are written to include specific remediation instructions. This means every violation becomes a learning opportunity — when a linter fails, the agent receives not just "what is wrong" but "how to fix it."

### 5.4 Golden Principles and Automated Garbage Collection

The team encoded "golden principles" — opinionated, mechanical rules — directly into the repository. Examples include preferring shared utility packages over hand-rolled helpers (to keep invariants centralized), and validating data at boundaries rather than probing shapes speculatively.

On a regular cadence, background Codex tasks scan for deviations, update quality grades, and open targeted refactoring pull requests. Most of these can be reviewed in under a minute and auto-merged. This functions as continuous garbage collection for code quality.

---

## 6. Application Legibility and Runtime Observability

### 6.1 Making the Running Application Visible to Agents

As agent throughput scaled, the team discovered their second major bottleneck: agents could not see the running application. Bugs were caught only after human review, creating a rate-limiting dependency on human QA that defeated the throughput advantage.

The solution was to make the application itself directly legible to the agent through three key mechanisms:

#### Per-Worktree Booting

The application was made bootable per git worktree, allowing each agent to launch and drive an isolated instance for each change in flight. This eliminated environment contamination between concurrent agent runs.

#### Chrome DevTools Protocol Integration

The team wired the Chrome DevTools Protocol directly into the agent runtime, creating skills for DOM snapshots, screenshot capture, and browser navigation. This allowed agents to reproduce bugs by driving the UI directly, validate fixes by observing post-fix application state, and reason about UI behavior from runtime events rather than static code analysis alone.

#### Ephemeral Local Observability Stack

Each worktree received its own isolated observability pipeline — logs, metrics, and traces — that was torn down when the task completed. The stack used Vector as a fan-out router, feeding Victoria Logs (queryable via LogQL), Victoria Metrics (queryable via PromQL), and distributed tracing infrastructure.

This unlocked prompts that would otherwise be impossible, such as "ensure service startup completes in under 800ms" or "no span in these critical user journeys exceeds two seconds." These became tractable because the agent could directly measure outcomes.

---

## 7. The Autonomous Development Loop

### 7.1 Increasing Levels of Autonomy

With sufficient harness infrastructure in place, agents become capable of end-to-end feature development. The team described progressively increasing autonomy levels:

| Level | Agent Capability | Human Role |
|---|---|---|
| **Basic** | Write code, generate tests | Review all PRs, run QA |
| **Intermediate** | Reproduce bugs, implement fixes, run test suites | Review complex changes |
| **Advanced** | Drive UI, query logs/metrics, validate outcomes | Review architectural decisions |
| **Full Loop** | End-to-end: bug repro → fix → validate → PR → merge | Escalation only when judgment needed |

### 7.2 The Full Autonomous Cycle

At the highest level of autonomy, given a single prompt, the agent can perform the complete development cycle:

1. Validate the current codebase state
2. Reproduce a reported bug and record evidence (including video)
3. Implement a fix
4. Validate the fix by driving the application
5. Record a second video demonstrating resolution
6. Open a pull request
7. Respond to agent and human feedback
8. Detect and remediate build failures
9. Escalate to a human only when judgment is required
10. Merge the change

The team regularly observed single Codex runs working on a single task for upwards of six hours — often while the human engineers were sleeping. This represents a fundamentally different productivity model.

---

## 8. Throughput, Merge Philosophy, and Cost Tradeoffs

Increased agent throughput changes many traditional engineering norms. The OpenAI team explicitly noted that practices considered responsible in low-throughput environments become counterproductive under agent abundance:

- Merge gates are minimized; PRs are short-lived.
- For flaky tests, it can be more efficient to retry rather than investigate the root cause.
- Implementation is cheap, but waiting for fixes becomes expensive.
- The break-even point for "investigate vs. retry" has shifted.

> **Cost Structure Change:** In traditional dev: human time is moderately scarce, compute is cheap, waiting is acceptable. In agent-first dev: human attention is the critical constraint, compute/code is abundant, waiting is the most expensive operation.

The merge philosophy shifts from "prevent all bad merges" to "detect quickly and roll back cheaply." This is feasible because the same agents that produce code can also produce fixes on demand.

---

## 9. Harness Components Taxonomy

Martin Fowler categorized the harness into three component types that mix deterministic and LLM-based approaches:

| Category | Description | Examples |
|---|---|---|
| **Context Engineering** | Continuously enhanced knowledge base in the codebase, plus agent access to dynamic context | Structured docs/, AGENTS.md layering, observability data, browser navigation |
| **Architectural Constraints** | Deterministic rules monitored by both agents and mechanical checks | Custom linters, structural tests, CI dependency validation, typed boundary parsing |
| **Garbage Collection** | Periodic agents that find and fix inconsistencies, fighting entropy and decay | Background refactoring PRs, quality score updates, doc freshness checks, pattern violation scans |

Fowler also observed that this approach suggests a future where teams pick from a set of pre-built harnesses for common application topologies — analogous to today's service templates, but far more comprehensive.

---

## 10. Minimum Viable Harness Checklist

For teams beginning to adopt harness engineering practices, the community has converged on a minimum viable checklist:

1. A small AGENTS.md entrypoint that points to deeper docs — command-first, versioned, aggressively pruned.
2. A reproducible dev environment (one-command boot) and per-worktree isolation to prevent cross-task contamination.
3. Mechanical invariants in CI: architecture boundaries, formatting rules, data validation at edges, dependency rules.
4. Agent legibility hooks: structured logs plus queryable traces and metrics; repeatable UI and test driving.
5. Clear evaluation gates: "done" criteria, regression tests, and security checks that agents can run and interpret.
6. Safety rails: least-privilege credentials, controlled egress, audit logs, and a rollback playbook.
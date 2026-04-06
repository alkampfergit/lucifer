# ADR Template

> **For agents:** Use this template when recording an Architecture Decision Record.
> Copy the structure below into `docs/context/DECISIONS.md` as a new entry.
> Fill in every section. Do not leave placeholders.
>
> **File naming** (if stored as individual files): lowercase, dash-separated, present-tense
> imperative verb phrase — e.g. `choose-database.md`, `adopt-event-sourcing.md`.

## ADR-[NNN]: [Title]

**Date**: [YYYY-MM-DD]
**Status**: [Proposed | Accepted | Deprecated | Superseded by ADR-XXX]
**Deciders**: [who made this decision]

### Context

[What situation prompted this decision? What forces, constraints, or requirements are at play?
Include relevant organisational context, team composition, and business priorities.]

### Options Considered

[List every option that was evaluated. For each, note the key trade-offs that made it
attractive or disqualifying.]

- **Option A — [name]**: [trade-offs]
- **Option B — [name]**: [trade-offs]
- **Option C — [name]**: [trade-offs]

### Decision

[What was decided? Be specific. One decision per record.]

### Rationale

[Why was this option chosen over the others? Include the reasoning, evidence, and
the pros/cons that were decisive. This is the most important section — future readers
need to understand the "why", not just the "what".]

- (+) [positive consequence or strength]
- (+) [positive consequence or strength]
- (-) [negative consequence or trade-off accepted]

### Consequences

[What follows from this decision? List follow-on decisions that are now triggered,
constraints imposed on future work, and any scheduled after-action review date
(recommend ~1 month after acceptance).]

> **Immutability note:** Do not alter this record once accepted. If the decision changes,
> create a new ADR with status "Superseded by ADR-NNN" and reference it here.

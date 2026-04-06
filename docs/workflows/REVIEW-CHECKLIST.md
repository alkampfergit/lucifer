# Review Checklist

> Run through this checklist before marking any PR as ready.
> Every item must be verified. Mark N/A only with justification.

## Correctness

- [ ] The change solves the original task as described.
- [ ] Edge cases are handled (null inputs, empty collections, boundary values).
- [ ] Error paths return meaningful messages with diagnostic context.
- [ ] No silent failures (swallowed exceptions, ignored error returns).

## Architecture Compliance

- [ ] Dependency direction rules are respected (no backward imports).
- [ ] Data is validated at all boundaries (API, events, database reads).
- [ ] No cross-domain internal imports (only shared contracts).
- [ ] New dependencies are justified and documented.

## Code Quality

- [ ] File length ≤ 300 lines.
- [ ] Function length ≤ 30 lines.
- [ ] No commented-out code.
- [ ] No TODOs without issue IDs.
- [ ] Naming follows project conventions.
- [ ] No duplication — check if a shared utility already exists.

## Testing

- [ ] All new public functions have unit tests.
- [ ] Happy path AND at least one failure path are tested.
- [ ] API endpoints have integration tests.
- [ ] All tests pass locally and in CI.
- [ ] Test names follow the `[unit]_[scenario]_[expected]` convention.

## Documentation

- [ ] Public APIs have doc comments.
- [ ] If behavior changed, relevant docs are updated.
- [ ] If an architectural decision was made, an ADR exists.
- [ ] QUALITY-GRADES.md reflects any significant quality changes.

## Security (if applicable)

- [ ] No secrets or credentials in code.
- [ ] Input validation prevents injection attacks.
- [ ] Authentication/authorization checks are in place.
- [ ] Sensitive data is not logged.

## Performance (if applicable)

- [ ] No N+1 query patterns.
- [ ] Large collections are paginated.
- [ ] Heavy operations are async where possible.
- [ ] No unnecessary allocations in hot paths.

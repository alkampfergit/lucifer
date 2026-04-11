# Code Standards

> These standards apply to ALL code in the repository.
> Most are enforced by formatters and linters. The rest are enforced by CI structural tests.

## File Organization

- **One concept per file**.
- **Max file length**: 300 lines.
- **Max function length**: 30 lines.
- **Naming convention**: Files use `snake_case` by default. Types/classes use `PascalCase`. Functions/variables use `camelCase`.

## Import Ordering

Group imports in this order, separated by blank lines:
1. Standard library / runtime imports
2. External dependencies
3. Internal shared packages
4. Same-domain imports

## Error Handling

- Parse data at boundaries.
- Throw explicit errors for invalid external payloads.
- Never silently swallow errors.
- Keep error messages specific enough for agents and humans to diagnose quickly.

## Testing Standards

- Unit test public service and repository functions.
- Integration test every HTTP endpoint.
- Structural checks must fail on invalid cross-layer imports.
- Test names use `[unit-under-test]_[scenario]_[expected-result]`.

## Documentation in Code

- Add doc comments only when the public surface is not obvious from the type signature.
- Prefer small helpers over explanatory comments.
- No commented-out code.
- No TODOs without a tracked follow-up task.

## Commit Messages

Format: `[type]: [brief description]`

Types:
- `feat`
- `fix`
- `refactor`
- `docs`
- `test`
- `chore`

## Language-Specific Rules

### TypeScript + Express

- Run `npm run lint` before committing.
- Run `npm run test` for backend verification.
- Run `npm run build` to verify structural checks plus production output.
- Backend runtime code lives under `server/src/`.
- Server endpoints must validate request and response shapes at the HTTP boundary.

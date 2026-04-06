# Commit Message Template

> **For agents:** Use this format for all commit messages.
> Choose the type that best describes the change. Write a concise description
> in imperative mood ("add", "fix", "update", not "added", "fixed", "updated").

## Format

```
[type]: [brief description]
```

## Types

| Type       | When to use                                      | Example                                      |
|------------|--------------------------------------------------|----------------------------------------------|
| `feat`     | New feature or capability                        | `feat: add order validation at API boundary` |
| `fix`      | Bug fix                                          | `fix: handle null input in pricing service`  |
| `refactor` | Code improvement without behavior change         | `refactor: extract shared mapping utility`   |
| `docs`     | Documentation only                               | `docs: update quality grades for orders`     |
| `test`     | Adding or fixing tests                           | `test: add edge case coverage for payments`  |
| `chore`    | Build, CI, tooling changes                       | `chore: update linter config for new rule`   |

## Rules

1. Keep the description under 72 characters.
2. Use imperative mood: "add feature" not "added feature".
3. Do not end with a period.
4. If the change affects a specific domain, mention it: `feat(orders): add validation`.
5. Multi-line body is optional — use it for context when the "why" is not obvious from the diff.

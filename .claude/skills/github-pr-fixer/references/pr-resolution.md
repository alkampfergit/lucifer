# PR Resolution

Resolve the current PR with `gh` only. Do not guess the PR number.

```bash
gh pr status
gh pr view --json number,title,headRefName,baseRefName,url
```

Capture:

- PR number
- head branch
- base branch
- PR URL

Use these values for every later step.

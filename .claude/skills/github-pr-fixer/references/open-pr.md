# Open Pull Request

Use this path when the user wants a pull request opened from the current
branch.

## 1. Resolve the current branch

Start from git, not memory:

```bash
git status --short --branch
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
```

Capture:

- current branch name
- whether the branch is clean or dirty
- whether an upstream branch already exists
- whether the current local HEAD has already been pushed

If the branch has uncommitted changes, make that explicit before opening the
PR. Do not silently include unexpected work.

## 2. Check whether a PR already exists

```bash
gh pr view --json number,title,url,headRefName,baseRefName
```

If a PR already exists for the current branch, stop and report it instead of
opening a duplicate.

## 3. Verify the base branch

Use repository context and git state to verify the intended base branch.
Prefer the tracked integration branch already used by the repository flow.
Do not guess.

Useful commands:

```bash
git remote show origin
gh repo view --json defaultBranchRef
```

If the correct base branch is still ambiguous, ask the user before creating the
PR.

## 4. Check whether the current branch has been pushed

If the current branch has no upstream, it has not been pushed yet.

If the branch has an upstream, verify whether the current local HEAD is already
published or whether local commits still need to be pushed.

Useful commands:

```bash
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
git status --short --branch
git log --oneline '@{u}..HEAD'
```

Interpretation:

- no upstream: branch has not been pushed
- upstream exists and `@{u}..HEAD` is empty: current HEAD is already pushed
- upstream exists and `@{u}..HEAD` has commits: push is still required

## 5. Push the current branch if needed

If the current branch does not yet exist on the remote, push it first:

```bash
git push -u origin "$CURRENT_BRANCH"
```

If the branch already tracks a remote branch, use a normal push only when local
commits are not yet published.

```bash
git push
```

## 6. Open the PR from the current branch

Use the current branch explicitly for the head and the verified branch for the
base.

```bash
gh pr create \
  --head "$CURRENT_BRANCH" \
  --base "$BASE_BRANCH"
```

Add `--title` and `--body` when the user supplied them or repository workflow
requires them.

## 7. Report the created PR

After creation, report:

- PR number
- PR URL
- head branch
- base branch

If checks should be watched immediately after creation, continue with
`references/pr-resolution.md` and `references/check-diagnosis.md`.

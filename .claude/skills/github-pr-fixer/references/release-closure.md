# Release Closure

Use this path only when the user explicitly asks to close the pull request.

## 1. Determine the release tag proposal

Start from `master` and inspect the latest tag:

```bash
git fetch origin --tags
git checkout master
git pull --ff-only origin master
git tag --sort=-v:refname | head -20
gh pr view "$PR_NUMBER" --json headRefName,baseRefName,url,title
```

If the head branch matches `release/<semver>`, treat that version as the
proposed tag.

Before doing any release operation, ask the user to confirm the tag or propose
another one. Do not create or push a tag without explicit confirmation.

Report in the confirmation prompt:

- latest tag currently on `master`
- proposed next tag
- source branch name

## 2. Rebase the branch if needed

After the user confirms the tag, ensure the PR branch is current with `master`.

```bash
git checkout "$HEAD_BRANCH"
git fetch origin
git rebase origin/master
git push --force-with-lease
```

If the branch is already up to date, do not rebase just for the sake of it.

## 3. Ensure checks are green before release

```bash
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

Do not proceed if required checks are failing.

## 4. Fast-forward master, tag, push, close PR, and delete branches

Use fast-forward only. Do not create a merge commit.

```bash
git checkout master
git fetch origin
git pull --ff-only origin master
git merge --ff-only "$HEAD_BRANCH"
git tag "$CONFIRMED_TAG"
git push origin master
git push origin "$CONFIRMED_TAG"
gh pr close "$PR_NUMBER"
git branch -d "$HEAD_BRANCH"
git push origin --delete "$HEAD_BRANCH"
```

If the user wants the PR closed with a comment, include one:

```bash
gh pr close "$PR_NUMBER" --comment "Released as $CONFIRMED_TAG"
```

Branch cleanup requirements:

- Delete the old local release branch after the PR is closed.
- Delete the old remote release branch after the PR is closed.
- If local branch deletion fails because the branch is not fully merged
  locally, stop and explain rather than forcing deletion.

## 5. Release guardrails

- Never infer final tag approval from branch naming alone.
- Never create a tag before the user confirms the version.
- Never merge to `master` with anything other than fast-forward for this flow.
- Never close the PR before `master` and the tag are pushed successfully.
- Never skip old branch cleanup after a successful release close.
- If `git merge --ff-only` fails, stop and explain why instead of forcing a
  merge.

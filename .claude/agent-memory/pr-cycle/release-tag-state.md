---
name: release-tag-state
description: Tag 0.8.14 was pushed pointing at a feature-branch commit rather than master, so "latest tag" is a misleading base for the next version; CHANGELOG also skips 0.8.12/0.8.13.
metadata:
  type: project
---

Two release-hygiene irregularities to account for when picking the next semver tag
(observed 2026-07-31):

- `0.8.13` = `4cacdc8` = the `master` tip (correct).
- `0.8.14` is pushed to origin but points at `f211fa8`, the **first commit of the
  `fixes_during_windows_testing` feature branch** — i.e. it was cut before merge and is not
  on `master`. So `git tag --sort=-v:refname | head -1` returns a tag that does not describe
  any released master state.
- `CHANGELOG.md` has released sections up to `0.8.11` only; `0.8.12` and `0.8.13` were never
  written up, so the changelog is two releases behind the tags.

**Why:** AGENTS.md rule 8 forbids committing on master without a semver tag, which makes the
tag sequence load-bearing; a tag on an unmerged branch commit breaks the assumption that the
newest tag is the current release.

**How to apply:** Do not derive the next version from the newest tag alone — verify with
`git branch -a --contains <tag>` that the tag is actually on master. Since `0.8.14` is
consumed, the next release must be `0.8.15` or higher. Feature-bearing releases in this repo
have historically taken patch bumps (e.g. `0.8.10` shipped a cli/execute-routes split), so
prefer `0.8.15` over `0.9.0` unless the owner says otherwise. Offer a catch-up CHANGELOG
entry covering `0.8.12` onward rather than one section per skipped tag.

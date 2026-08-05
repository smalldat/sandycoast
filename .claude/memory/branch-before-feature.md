---
name: branch-before-feature
description: Check the branch before starting a feature; if it carries unrelated work, pull main and branch fresh from it
metadata:
  type: feedback
---

Before writing any new feature, check the current branch **first**: `git status -sb` and `git log --oneline origin/main..HEAD`.

- Branch is at main, or its existing commits belong to the same feature → keep working on it.
- Branch carries unrelated work (e.g. starting a pie chart on `dev/ondrejspilka/bar-chart-perf`) → `git fetch origin && git checkout main && git pull`, then create the feature branch from main: `git checkout -b dev/ondrejspilka/<feature>`.

**Why:** building on top of an unrelated branch drags its commits into the feature's PR, so the diff no longer matches the feature and the PR can't land until the other branch does.

**How to apply:** do this at the *start* of the task, not at commit time — once the work sits on the wrong base, fixing it means a rebase. See [[component-isolation]] for the naming convention (`dev/ondrejspilka/<feature>`).

---
title: "Build Reproducible Pull Request CI"
sectionSlug: a-practical-github-actions-ci-file
order: 1
---

The checkout service has a partial workflow that installs mutable dependencies and never runs the full merge gate. Complete the pull-request CI contract.

Your job:

1. **Grant only read access to repository contents** and trigger on pull requests to `main`.
2. **Cancel superseded runs for the same workflow and branch** through concurrency.
3. **Use Node.js 22 with npm caching**, then install from the lockfile with `npm ci`.
4. **Run lint, test, and build** as separate steps.

The grader checks the trigger, permissions, concurrency, locked installation, and all three validation commands.

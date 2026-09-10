---
retired: true
title: "Works Locally, Fails on a Clean Runner"
sectionSlug: why-do-clean-runners-and-locked-dependencies-matter
order: 2
revision: 4
---

## Current situation

A developer handed over a passing local checkout test and this failing CI recipe. The editor contains the project manifest, the approved lockfile, and `.ci/developer-install.json`, which records the laptop's project and global tools.

## The issue

The fresh worker cannot execute the test tool. The handoff also contains no complete lint-to-package validation result. Fixing the first error is only the beginning of making this checkout independently buildable.

## Your task

1. Run the starter and compare its first failure with the scripts, declared dependencies, approved lockfile, and laptop installation record.
2. Reconcile `package.json` with the approved environment. Preserve its scripts and existing dependencies; do not modify the lockfile or application.
3. Replace the local-command recipe with a reproducible validation workflow in `pipeline.yaml`. It must perform lint, unit tests, and packaging, without relying on laptop state.
4. Check the installed-version evidence and all three run cases. Choose your own job layout; a single worker may share one install across its steps.

## Success criteria

Fresh workers install eslint 9.0.0, vitest 3.0.0, and vite 6.0.0 from the lock. Healthy validation reaches packaging. Lint and unit-test failures occur in their intended checks and stop packaging. Merely making the original test command run is incomplete.

Browser simulation only: no application code, package downloads, security scanner, or real deployment runs.

:::expand[Simulation format]{kind="note"}
Use `version: 1`, `jobs`, ordered `steps`, and optional `needs`. Each job starts empty.

- `checkout: true` copies repository files.
- `run` supports `npm ci`, `npm install`, `npm run lint`, `npm test`, and `npm run build`. Install once per job, not per step.
- Build creates `dist/app.json`. `upload` and `download` take `name` and `path`; consumers need an upstream producer.
- `verify: path` evaluates a smoke fixture. `scan: path` evaluates authored security evidence. `deploy` takes `environment` and `path`.

Locks model direct declarations and resolved versions, not transitive resolution. Every build embeds a new identity, changing its digest.

Run Pipeline executes every case independently. Check Run checks all cases. Edits invalidate evidence; Reset clears drafts/history. Three submissions persist locally.
:::

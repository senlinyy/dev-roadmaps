---
title: "The Same Source, Different Dependencies"
sectionSlug: why-do-clean-runners-and-locked-dependencies-matter
order: 3
revision: 4
---

## Current situation

The checkout service's manifest allows a range of test-tool versions. Its working lockfile is empty, but the release archive supplies `.ci/approved-lock.json`. `.ci/installation-records.json` records the approved and newer installations; both registry snapshots are available as run cases.

## The issue

The same source resolves different test-tool versions across the two registries. The build-only recipe can stay green without revealing whether those versions pass the application's compatibility check.

## Your task

1. Run both registry cases. Compare installed-version logs and workspace snapshots, then relate them to the manifest range and archived lock.
2. Recover `package-lock.json` from the supplied approved file; do not invent a new dependency graph or narrow the read-only manifest range.
3. Redesign `pipeline.yaml` to reproduce the approved installation and validate lint and unit tests before packaging.
4. Rerun both registries and the independent unit-test-failure case. Check which versions actually ran, not simply whether a lockfile exists.

## Success criteria

Both registry cases install eslint 9.0.0, vitest 3.0.0, and vite 6.0.0 and complete validation. Unit-test failure prevents packaging. Manifest/lock disagreement fails rather than updating the lock. This teaching model selects unlocked versions from authored registry snapshots; it does not run real npm resolution.

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

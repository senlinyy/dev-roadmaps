---
retired: true
title: "Green Pipeline, Wrong Production Binary"
sectionSlug: why-should-one-artifact-move-through-every-environment
order: 1
revision: 4
---

## Current situation

The checkout service builds separately for staging and production. Both jobs read the same repository. The starter provides their deployment steps; Run results supplies build identities, deployment digests, and health-check evidence.

## The issue

A green release does not establish that production received the object staging tested. In the staging-failure case, production can still deploy despite the failed health check.

## Your task

1. Run the baseline. Trace both deployed digests to their builds, then inspect what happens when staging verification fails.
2. Redesign the workflow around one validated, published package. Include locked lint and unit-test validation before creating it.
3. Make staging retrieve that package, deploy it, and verify it. Make production consume the same package only after that staging evidence succeeds.
4. Remove environment-side rebuilds, preserve repository files, and rerun every case. Choose your own worker and artifact names.

## Success criteria

The healthy run builds exactly once; production receives the exact staging-tested digest through the dependency chain. Unit-test failure prevents building and release work. An independent staging smoke failure blocks production. Matching source identity is not a substitute for matching package identity.

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

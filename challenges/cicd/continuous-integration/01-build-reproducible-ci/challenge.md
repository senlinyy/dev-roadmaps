---
title: "A Green Pipeline That Does Not Protect Mainline"
sectionSlug: which-checks-should-a-ci-pipeline-run
order: 1
revision: 4
---

## Current situation

The checkout service's reviewers currently see only a packaging result. You own `pipeline.yaml`; the read-only `package.json` exposes the supported scripts, and `package-lock.json` records the approved dependencies. The team needs validation and packaging on separate workers.

## The issue

The automation reports green even for the authored lint and unit-test failures. Reviewers cannot tell whether the source was checked or merely packaged.

## Your task

1. Run the starter and inspect the logs for all three cases. Compare the executed operations with the scripts in `package.json`.
2. Design a validation worker and a separate packaging worker. Decide which work belongs in each and what permits packaging to start.
3. Make each worker reconstruct its own environment from the supplied repository and lockfile. Install once within a job; its later steps share that environment.
4. Rerun every case and use the graph, check logs, and skipped jobs to verify your design. Only `pipeline.yaml` is editable.

## Success criteria

The healthy case executes lint, unit tests, and packaging with locked dependencies. Packaging waits for successful validation on another worker. Each failing case reaches its intended check and prevents all build and release work. Job names and YAML layout are your choice.

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

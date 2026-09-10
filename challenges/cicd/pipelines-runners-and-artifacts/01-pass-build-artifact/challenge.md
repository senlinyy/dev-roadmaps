---
retired: true
title: "The Build Exists, but the Next Worker Cannot Use It"
sectionSlug: why-do-artifacts-carry-outputs-between-jobs
order: 1
revision: 4
---

## Current situation

The checkout service's build owner reports a successful package, but a separate verification worker cannot use it. The current `pipeline.yaml` is runnable, and Run results exposes each worker's workspace plus the run's artifact list.

## The issue

The verifier cannot find `package/app.json`. The producer also lacks evidence that it validated the source before packaging. Neither a green producer nor a matching-looking filename proves a usable handoff.

## Your task

1. Run the starter. Compare where the producer's output exists with the consumer's workspace and the artifact list.
2. Design the producer's validation and packaging sequence, then make its single `dist/app.json` output available outside that worker.
3. Reconstruct the consumer's input at `package/app.json` and verify it. Decide both when the consumer may run and how it receives the bytes.
4. Keep the consumer source-free: no checkout or rebuild there. Preserve repository files, choose your own job/artifact names, and rerun all cases.

## Success criteria

The healthy run performs locked lint/test validation, builds once, and uploads, downloads, and verifies the same digest downstream. Test failure prevents building. Build failure prevents upload, verification, and deployment. Changing ordering alone or making another local build does not satisfy the handoff.

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

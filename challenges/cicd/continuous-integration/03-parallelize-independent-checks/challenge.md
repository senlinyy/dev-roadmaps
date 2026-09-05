---
title: "Make Useful Feedback Arrive Earlier"
sectionSlug: which-checks-should-a-ci-pipeline-run
order: 4
revision: 4
---

## Current situation

The checkout service has a complete but slow single-worker recipe in `pipeline.yaml`. Packaging takes 90, tests 30, and lint 5 simulated seconds, plus preparation and step overhead. The repository and check definitions are read-only.

## The issue

Cheap failures arrive after expensive packaging has already happened. Reordering one list can improve failure latency, but cannot provide the independent, overlapping validation workers the team now needs.

## Your task

1. Run the baseline and compare the healthy timeline with the lint-failure and unit-test-failure timelines.
2. Redesign the workflow so lint and tests have independent workers and packaging has its own worker. Decide which dependencies are necessary and which would serialize independent work.
3. Reconstruct each worker from the checkout and one locked installation. Retain all required checks and prevent packaging from starting on an unvalidated change.
4. Rerun all cases. Inspect overlap, the time each failure appears, and whether packaging is skipped—not only total duration.

## Success criteria

Healthy lint and tests overlap; the pipeline finishes within 132 simulated seconds. Lint failure appears within 11 seconds and test failure within 36 seconds. Neither failing case executes build or release work. These are teaching-model timings, not performance benchmarks.

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

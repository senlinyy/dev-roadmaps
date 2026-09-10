---
retired: true
title: "Restore a Usable Previous Release"
sectionSlug: what-can-rollback-restore-and-what-can-it-not-reverse
order: 2
revision: 1
---

## Current situation

Green is active and failing. Blue remains in the retained registry and understands the current expanded schema, v1 messages and shared sessions. A separate case removes blue compatibility with the current schema. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter assumes any previous binary is a recovery target and skips verification. In one case that would replace one outage with another.

## Your task

Inspect shared state, deploy and freshly verify the compatible previous release, and hold without changing the failing candidate when the previous binary is incompatible. Set a recovery deadline that covers the twenty-second startup. Preserve all retained data and artifacts.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Rollback available:** Blue supports all current shared-state contracts. Required result: **recovered** on **blue**.
- **Rollback unavailable:** Blue supports only legacy schema, not the current expanded state. Required result: **held** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. recover selects a retained release, inspectCompatibility (boolean), and timeout seconds. mitigate supports disable-flag, pause-consumers or zero-traffic. inspect and verify have empty mappings. Compatibility uses the current schema, queued-message and session contracts; no action rewrites data or undoes external transactions.
:::

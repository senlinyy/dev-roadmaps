---
retired: true
title: "Stop an Incompatible Rollout and Recover"
sectionSlug: why-are-rollback-startup-speed-and-stateful-workloads-harder
order: 5
revision: 2
---

## Current situation

Blue is the retained, compatible Orders API release. Green is offered in three cases: healthy, unable to read the current shared schema, and unable to reach readiness. All use the same rollout policy. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The release plan ignores compatibility and has no recovery behavior. A retained artifact alone does not demonstrate that failed deployment paths restore healthy service.

## Your task

Make the healthy release complete and verify it. Detect incompatible or unready candidates before extending their traffic, restore the compatible blue fleet, and verify recovery. Preserve shared schemas, messages and release bytes.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Compatible candidate:** Green can coexist with the existing shared state. Required result: **deployed** on **green**.
- **Incompatible schema:** Green cannot read the current expanded schema; blue can. Required result: **recovered** on **blue**.
- **Failed readiness:** Green never becomes healthy; blue remains compatible. Required result: **recovered** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. rollout takes integer batch and surge counts, readiness (process or application), timeout and drain in seconds, removeTraffic and compatibility booleans, and onFailure (stop or rollback). Batch is replacements per iteration; surge is the maximum started before old replicas leave. inspect and verify have empty mappings.
:::

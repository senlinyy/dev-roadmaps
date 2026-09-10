---
retired: true
title: "Keep Orders Serving During Replacement"
sectionSlug: how-do-surge-unavailability-and-headroom-control-capacity
order: 1
revision: 2
---

## Current situation

Orders API has four healthy blue replicas. Production needs at least three serving replicas throughout the release; the scheduler has room for only one extra replica. The same rollout must also work when that extra slot is unavailable. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The current plan removes the entire old fleet before starting replacements. Raising surge indiscriminately would trade an outage for unschedulable work.

## Your task

Repair the batch and surge policy so both capacity cases finish on green without crossing the healthy floor. Use application readiness, allow startup and request draining, retain blue as a recovery target, then verify the final release.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **One spare slot:** Four replicas, three required healthy, one extra slot. Required result: **deployed** on **green**.
- **No spare slot:** The same serving floor applies but no surge replica can be scheduled. Required result: **deployed** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. rollout takes integer batch and surge counts, readiness (process or application), timeout and drain in seconds, removeTraffic and compatibility booleans, and onFailure (stop or rollback). Batch is replacements per iteration; surge is the maximum started before old replicas leave. inspect and verify have empty mappings.
:::

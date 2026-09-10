---
retired: true
title: "A Running Process Is Not a Ready API"
sectionSlug: how-do-readiness-and-graceful-shutdown-create-a-safe-handoff
order: 3
revision: 1
---

## Current situation

Green starts its HTTP process after two seconds, but its database pool normally takes twenty seconds. During a cold start it takes forty-five seconds. A separate bad-build case never reaches application health. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The rollout treats process startup as readiness and gives replacements only three seconds. Requests reach instances whose dependencies are still warming.

## Your task

Rework the rollout handoff and deadline for both warm and cold starts. Keep all four existing serving slots available until replacements are ready, and hold the bad build on blue without sending candidate traffic. Verify completed healthy releases.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Warm application:** Application readiness arrives after 20 seconds. Required result: **deployed** on **green**.
- **Cold application:** Application readiness arrives after 45 seconds. Required result: **deployed** on **green**.
- **Unhealthy candidate:** Green never passes its authored application check. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. rollout takes integer batch and surge counts, readiness (process or application), timeout and drain in seconds, removeTraffic and compatibility booleans, and onFailure (stop or rollback). Batch is replacements per iteration; surge is the maximum started before old replicas leave. inspect and verify have empty mappings.
:::

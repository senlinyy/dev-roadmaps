---
retired: true
title: "Drain Orders Before Terminating Workers"
sectionSlug: how-do-readiness-and-graceful-shutdown-create-a-safe-handoff
order: 4
revision: 1
---

## Current situation

Checkout requests are still executing when old replicas are removed. The ordinary request drain is ten seconds; a payment-provider case needs thirty-five seconds. Four replicas serve traffic, with one spare slot. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter stops accepting traffic too late and terminates old replicas immediately. The deployment can appear ready while customers lose in-flight checkouts.

## Your task

Design the replacement handoff to remove old endpoints from new traffic, finish their outstanding work, and only then terminate them. Keep at least three healthy serving replicas, cover the longer payment case, and verify green at the end.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Ordinary requests:** In-flight work needs 10 seconds to finish. Required result: **deployed** on **green**.
- **Slow payment provider:** In-flight work needs 35 seconds, without relaxing capacity. Required result: **deployed** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. rollout takes integer batch and surge counts, readiness (process or application), timeout and drain in seconds, removeTraffic and compatibility booleans, and onFailure (stop or rollback). Batch is replacements per iteration; surge is the maximum started before old replicas leave. inspect and verify have empty mappings.
:::

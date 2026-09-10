---
retired: true
title: "Validate Green Before Moving Production"
sectionSlug: how-do-routing-and-validation-prepare-the-production-switch
order: 1
revision: 2
---

## Current situation

Blue serves every production request. Green can start separately, using runtime.yaml and the supplied secret reference. One case is healthy; the other contains an application failure. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter switches production before preparing green and checks only that a process exists. Its runtime settings still point at a preview environment.

## Your task

Repair runtime configuration and the release sequence. Prepare green without production traffic, validate health and every shared-state dependency, then switch and verify only the healthy case. Keep blue active when validation fails.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Healthy green:** Configuration and compatibility validation can succeed. Required result: **deployed** on **green**.
- **Broken application:** Green fails its application health fixture. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. prepare uses config (a YAML string mapping), secrets (reference list) and timeout seconds. validate accepts health, config, sessions, schema and queue checks. switch targets blue or green. consumers selects blue, green, paused or both. wait advances seconds; retire closes the rollback window. No real router or environment is changed.
:::

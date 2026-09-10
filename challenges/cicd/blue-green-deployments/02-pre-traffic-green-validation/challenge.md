---
retired: true
title: "Keep Sessions Valid Across the Switch"
sectionSlug: how-must-databases-queues-sessions-and-caches-remain-compatible
order: 2
revision: 2
---

## Current situation

Orders API uses shared-v1 sessions and a shared cache namespace. Green was copied from a preview environment with local sessions. A second candidate cannot decode existing shared-v1 sessions at all. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

A healthy HTTP endpoint hides broken authenticated checkout journeys. Switching users to local sessions or an incompatible codec would log them out midway through payment.

## Your task

Repair the session store, cache and database configuration and rebuild the pre-traffic validation sequence. Switch the compatible candidate only; hold the incompatible codec before any production traffic changes. Do not alter the supplied releases.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Compatible session codec:** Green can read shared-v1 when configured correctly. Required result: **deployed** on **green**.
- **Incompatible session codec:** Green understands only private-v2 sessions. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. prepare uses config (a YAML string mapping), secrets (reference list) and timeout seconds. validate accepts health, config, sessions, schema and queue checks. switch targets blue or green. consumers selects blue, green, paused or both. wait advances seconds; retire closes the rollback window. No real router or environment is changed.
:::

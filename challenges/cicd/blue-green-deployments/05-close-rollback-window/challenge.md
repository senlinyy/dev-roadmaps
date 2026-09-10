---
retired: true
title: "Retain Blue Until the Release Is Proven"
sectionSlug: why-do-parity-cost-and-cleanup-define-the-rollback-window
order: 5
revision: 1
---

## Current situation

The release can prepare and validate green while retaining blue. Ordinary observation requires 120 seconds; a longer case requires 240 seconds before blue can be retired. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter deletes the recovery environment immediately after switching and does not verify production first. That saves capacity by removing the recovery path before the release is proven.

## Your task

Repair configuration and sequence the full switch, fresh green verification, observation window and blue retirement. Keep blue usable throughout the window. Finish with verified green and close the rollback window deliberately in both timing cases.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Ordinary rollback window:** Retain blue for at least 120 seconds after the switch. Required result: **deployed** on **green**.
- **Long rollback window:** Retain blue for at least 240 seconds after the switch. Required result: **deployed** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. prepare uses config (a YAML string mapping), secrets (reference list) and timeout seconds. validate accepts health, config, sessions, schema and queue checks. switch targets blue or green. consumers selects blue, green, paused or both. wait advances seconds; retire closes the rollback window. No real router or environment is changed.
:::

---
retired: true
title: "Hand Over the Shared Queue Once"
sectionSlug: how-must-databases-queues-sessions-and-caches-remain-compatible
order: 4
revision: 1
---

## Current situation

Blue and green point at the same order queue. Blue owns consumption initially. Green understands the ordinary v1 messages, but a failure case contains a queued contract that green cannot parse. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

Starting both consumer fleets during validation allows overlapping processing under different release semantics. A router change does not change queue-consumer ownership.

## Your task

Build a pre-traffic validation and consumer handoff sequence. Pause or replace old ownership without running both consumers together; activate green consumers only after queue compatibility passes. Switch and verify green in the healthy case, while preserving blue and its ownership when validation fails.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Compatible queue:** Only one release should own queue consumption. Required result: **deployed** on **green**.
- **Unsupported queued messages:** The queue contains v3 messages; blue supports them but green does not. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. prepare uses config (a YAML string mapping), secrets (reference list) and timeout seconds. validate accepts health, config, sessions, schema and queue checks. switch targets blue or green. consumers selects blue, green, paused or both. wait advances seconds; retire closes the rollback window. No real router or environment is changed.
:::

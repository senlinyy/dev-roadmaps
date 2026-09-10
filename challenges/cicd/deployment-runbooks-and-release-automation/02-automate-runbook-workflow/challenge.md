---
retired: true
title: "Fail Preflight Before Mutating Production"
sectionSlug: what-must-pre-flight-prove-before-production-changes
order: 2
revision: 2
---

## Current situation

Production normally has a healthy baseline, an available release lock and one spare capacity slot. Failure cases provide an unhealthy baseline or a lock already owned by another release. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter checks only baseline health and proceeds with mutating steps. It could deploy onto an ongoing incident or overlap another production change.

## Your task

Repair the full release sequence and preflight contract. Deploy, verify and record the healthy case. Stop unhealthy-baseline and unavailable-lock cases before any migration, deployment or release-record side effect. Keep retry and failure paths safe.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Ready for release:** All six preflight predicates pass. Required result: **deployed** on **green**.
- **Baseline unhealthy:** Production is already unhealthy before release. Required result: **held** on **blue**.
- **Another release owns the lock:** The production release lock is unavailable. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. preflight checks baseline, lock, capacity, compatibility, rollback and authorization. execute supports migrate-expand, deploy, record and contract, with retry set to resume, repeat or stop. resume queries durable operation checkpoints after a previous commit or lost acknowledgement. postflight takes onFailure: rollback, escalate or ignore. Contract is irreversible and separately authorized. No SQL, cloud command or external side effect executes.
:::

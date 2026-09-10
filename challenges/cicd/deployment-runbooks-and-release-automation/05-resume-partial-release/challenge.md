---
retired: true
title: "Resume Without Duplicating Committed Work"
sectionSlug: how-do-idempotency-and-resumability-make-retries-safe
order: 4
revision: 1
---

## Current situation

A release may start fresh, resume with its expand migration and deployment already committed, or lose acknowledgement immediately after deployment commits. Durable operation checkpoints identify what actually happened. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter repeats mutations on every retry. A timeout does not mean the server did nothing, and starting from the top can duplicate committed effects.

## Your task

Design one resumable runbook for all three starting states. Query existing checkpoints, skip committed mutations, verify the current deployment and write exactly one success record. Ensure each migration and deployment effect occurs once, including acknowledgement loss.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Fresh execution:** No operations have committed yet. Required result: **deployed** on **green**.
- **Resume after deployment:** The expand migration and deployment are already committed. Required result: **deployed** on **green**.
- **Lost deployment acknowledgement:** Deployment commits before acknowledgement is lost. Required result: **deployed** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. preflight checks baseline, lock, capacity, compatibility, rollback and authorization. execute supports migrate-expand, deploy, record and contract, with retry set to resume, repeat or stop. resume queries durable operation checkpoints after a previous commit or lost acknowledgement. postflight takes onFailure: rollback, escalate or ignore. Contract is irreversible and separately authorized. No SQL, cloud command or external side effect executes.
:::

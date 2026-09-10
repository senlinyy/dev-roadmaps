---
retired: true
title: "Turn the Release Checklist into Executable Stages"
sectionSlug: how-does-a-runbook-turn-strategy-and-checklists-into-executable-logic
order: 1
revision: 2
---

## Current situation

The Orders release needs preflight validation, a compatible expand migration, deployment, postflight verification and a durable release record. The normal case passes; another case fails postflight health. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter deploys before the migration, records success before checking user-facing outcomes, and ignores failures. Its partial preflight leaves production assumptions unproven.

## Your task

Replace the fragile checklist with ordered executable stages. Run every preflight predicate, apply the compatible migration before deployment, verify before recording success, and restore verified blue if postflight fails. Each mutation must be safely resumable.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Healthy release:** All preflight and postflight predicates pass. Required result: **deployed** on **green**.
- **Postflight regression:** The deployment commits but user-facing verification fails. Required result: **recovered** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. preflight checks baseline, lock, capacity, compatibility, rollback and authorization. execute supports migrate-expand, deploy, record and contract, with retry set to resume, repeat or stop. resume queries durable operation checkpoints after a previous commit or lost acknowledgement. postflight takes onFailure: rollback, escalate or ignore. Contract is irreversible and separately authorized. No SQL, cloud command or external side effect executes.
:::

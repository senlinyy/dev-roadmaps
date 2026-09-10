---
retired: true
title: "Encode the Point of No Return"
sectionSlug: how-should-failure-paths-and-the-point-of-no-return-be-encoded
order: 5
revision: 2
---

## Current situation

After successful deployment and a durable release record, an explicitly authorized contract migration closes the rollback window. One case is healthy, one refuses irreversible authorization, and one fails verification after contract. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter treats every failure as permission to restore blue. Once contract commits, that binary recovery path is no longer safe; irreversible work also needs its own authorization.

## Your task

Build the complete preflight, migration, deploy, verify and record sequence. Contract only after verification and explicit authority. Re-verify afterward; escalate a post-contract failure without attempting binary rollback. Hold denied irreversible authorization while preserving the completed healthy release.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Contract completes:** Both health checks and irreversible authorization pass. Required result: **deployed** on **green**.
- **Contract not authorized:** Production release is authorized; destructive contract is not. Required result: **held** on **green**.
- **Failure past the rollback window:** Verification fails only after contract has committed. Required result: **escalated** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. preflight checks baseline, lock, capacity, compatibility, rollback and authorization. execute supports migrate-expand, deploy, record and contract, with retry set to resume, repeat or stop. resume queries durable operation checkpoints after a previous commit or lost acknowledgement. postflight takes onFailure: rollback, escalate or ignore. Contract is irreversible and separately authorized. No SQL, cloud command or external side effect executes.
:::

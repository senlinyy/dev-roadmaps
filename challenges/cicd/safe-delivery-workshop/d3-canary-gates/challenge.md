---
title: "Fail closed when a canary lacks trustworthy evidence"
sectionSlug: fail-closed-when-a-canary-lacks-trustworthy-evidence
order: 3
revision: 1
---

## Description

Orders emits request counts, successful-order counts, and latency metrics for each release. One canary returns HTTP 200 while business success falls; another has too little traffic to evaluate. The current gate treats average HTTP health and missing samples as success.

As the release engineer, implement an evidence-based canary decision using the supplied CloudWatch results and rollout policy.

## Requirements

1. **Comparable Metrics**. Query baseline and candidate cohorts over the same bounded observation window and compare business success and latency.
2. **Evidence Sufficiency**. Enforce the supplied minimum sample counts and observation period. Reject missing or incomplete data rather than assuming health.
3. **Explicit Outcomes**. Distinguish healthy, degraded, and insufficient-data results in the gate’s output.
4. **Traffic Progression**. Configure a native ECS canary and require explicit continuation after the gate passes. Degraded or insufficient evidence must not authorize full traffic.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/gate.py`, `cloudwatch/queries.json`, `ecs/update.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::

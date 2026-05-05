---
title: "Inspect RDS Snapshot Evidence"
sectionSlug: rds-snapshots-and-point-in-time-recovery
order: 4
---

The team is about to make a risky schema change against `devpolaris-orders-prod` in Region `us-east-1`. Before the change, inspect the RDS snapshot evidence so you know there is a recent recovery point and whether it is encrypted.

Your job:

1. **List snapshots** for DB instance `devpolaris-orders-prod`.
2. **Keep the output visible** so the grader can see the snapshot status, time, and encryption state.
3. **Do not create or delete snapshots** for this step.

The grader checks the AWS CLI output, not a written explanation.

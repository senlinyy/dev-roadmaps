---
title: "Check Recovery Evidence"
sectionSlug: backups
order: 5
---

Before a risky order import, check two recovery surfaces: RDS snapshots for `devpolaris-orders-prod` and S3 versioning for bucket `devpolaris-orders-exports-prod`.

Your job:

1. **Inspect database snapshots** for DB instance `devpolaris-orders-prod`.
2. **Inspect object versioning** on bucket `devpolaris-orders-exports-prod`.
3. **Keep both outputs visible** so the grader can see database and object recovery evidence.

The grader checks AWS recovery evidence, not a written explanation.

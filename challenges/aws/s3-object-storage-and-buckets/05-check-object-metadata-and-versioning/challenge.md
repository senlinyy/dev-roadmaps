---
title: "Check Object Metadata And Versioning"
sectionSlug: versioning-overwrites-and-safe-deletion
order: 5
---

Support found the daily export object `orders-api/daily/2026/05/orders-2026-05-04.csv` in bucket `devpolaris-orders-exports-prod` in Region `us-east-1`. Before anyone depends on it, check both the object metadata and whether the bucket keeps object versions.

Your job:

1. **Inspect the object head** for `orders-api/daily/2026/05/orders-2026-05-04.csv`.
2. **Check versioning** on bucket `devpolaris-orders-exports-prod`.
3. **Keep both outputs visible** so the grader can see the metadata and versioning state.

The grader checks the AWS CLI output, not a written explanation.

---
title: "Check Lifecycle And Protection"
sectionSlug: tiers-and-lifecycle-rules-are-cost-decisions
order: 4
---

The storage review needs evidence for exports in `stdevpolarisordersprod`. The container is `exports`, and the daily export prefix is `exports/daily/2026/05/`. Use Azure CLI evidence to inspect lifecycle and protection settings.

Your job:

1. **List** the export blobs under the daily prefix.
2. **Check** blob soft delete and versioning settings.
3. **Check** the lifecycle policy for daily exports and temporary files.

The grader checks for export object evidence plus the protection and lifecycle policy names.

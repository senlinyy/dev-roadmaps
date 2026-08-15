---
title: "Build the Export Lifecycle Policy"
sectionSlug: access-tiers-and-lifecycle-rules
order: 3
---

Complete the lifecycle policy for order exports. It must apply only to block blobs under `exports/daily/`, move base blobs to cool storage after 30 days, archive them after 90 days, and delete them after 365 days. Keep the rule enabled and do not add another prefix or blob type.

The grader parses the policy and checks the complete action and filter contract.

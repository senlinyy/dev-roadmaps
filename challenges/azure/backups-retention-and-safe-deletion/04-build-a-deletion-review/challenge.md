---
title: "Build A Deletion Review"
sectionSlug: failure-scenarios-and-first-responses
order: 4
---

A cleanup PR wants to remove old exports, retry keys, and a legacy share. Use Azure CLI evidence from storage account `stdevpolarisordersprod`, Cosmos container `idempotency-keys`, and share `legacy-orders-share`.

Your job:

1. **Inspect** the lifecycle policy that controls export and temporary blob deletion.
2. **Inspect** the Cosmos TTL for retry keys.
3. **Inspect** the file share snapshot evidence before any deletion decision.

The grader checks that you gathered deletion and recovery evidence before acting.

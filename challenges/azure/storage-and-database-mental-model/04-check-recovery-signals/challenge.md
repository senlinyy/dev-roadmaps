---
title: "Check Recovery Signals"
sectionSlug: failure-modes-that-reveal-the-storage-layer
order: 4
---

A production review for `devpolaris-orders-api` asks whether each data store has enough recovery evidence. Use Azure CLI evidence from storage account `stdevpolarisordersprod`, SQL database `sqldb-devpolaris-orders-prod`, Cosmos container `idempotency-keys`, and file share `legacy-orders-share`.

Your job:

1. **Check** blob protection settings on the storage account.
2. **Check** the SQL database retention policy.
3. **Check** the Cosmos DB container expiry setting.
4. **Check** the file share snapshot evidence.

The grader checks that you collected recovery-related evidence from each storage shape.

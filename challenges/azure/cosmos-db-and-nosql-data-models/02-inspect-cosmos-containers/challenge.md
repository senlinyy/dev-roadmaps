---
title: "Inspect Cosmos Containers"
sectionSlug: partition-keys-are-a-product-decision
order: 2
---

Use Azure CLI evidence for Cosmos DB account `cosmos-devpolaris-orders-prod` in `rg-devpolaris-data-prod`. The SQL database is `orders-events`. The containers to inspect are `idempotency-keys` and `job-status`.

Your job:

1. **Inspect** the account-level settings.
2. **Inspect** the database that owns the containers.
3. **Inspect** both containers and their partition key or TTL settings.

The grader checks for the account, database, both containers, partition keys, and TTL evidence.

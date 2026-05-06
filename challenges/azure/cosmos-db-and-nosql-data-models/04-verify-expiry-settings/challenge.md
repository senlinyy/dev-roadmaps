---
title: "Verify Expiry Settings"
sectionSlug: failure-modes-and-first-checks
order: 4
---

The support team reports old retry and job-status records staying longer than expected. Use Azure CLI evidence for Cosmos DB account `cosmos-devpolaris-orders-prod`, database `orders-events`, and containers `idempotency-keys` and `job-status`.

Your job:

1. **Inspect** each container.
2. **Find** the TTL values and partition keys.
3. **Keep** the evidence connected to the named account and database.

The grader checks for both containers and their TTL values.

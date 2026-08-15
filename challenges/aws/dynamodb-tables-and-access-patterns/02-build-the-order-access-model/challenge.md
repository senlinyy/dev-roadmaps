---
title: "Build the Order Access Model"
sectionSlug: design-access-patterns-first
order: 2
---

Design the create-table input for the orders workload from its access patterns. The base table retrieves one order by tenant and order ID. A customer-status index lists a customer's orders by status and creation time. An idempotency index finds an order from one idempotency key. Use on-demand billing and AWS-owned server-side encryption. Keep the exact key attributes in AttributeDefinitions, and do not add non-key attributes there.

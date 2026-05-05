---
title: "Inspect Runtime Identity"
sectionSlug: evidence-from-a-working-setup
order: 4
---

Inspect the runtime identity evidence for `devpolaris-orders-api`. The container app is `ca-orders-api-prod`, the resource group is `rg-devpolaris-orders-prod`, and the expected user-assigned managed identity is `mi-orders-api-prod`.

Your job:

1. **Inspect the container app identity** attached to `ca-orders-api-prod`.
2. **Inspect the managed identity** named `mi-orders-api-prod`.
3. **Confirm the principal ID** used by the running app.

The grader checks terminal evidence from Azure.

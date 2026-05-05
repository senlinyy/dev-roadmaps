---
title: "Inspect Security Evidence"
sectionSlug: evidence-you-can-inspect
order: 4
---

Inspect the evidence for a failed secret read by `devpolaris-orders-api`. The running app is `ca-orders-api-prod`, the resource group is `rg-devpolaris-orders-prod`, the managed identity is `mi-orders-api-prod`, the Key Vault is `kv-devpolaris-prod`, and the secret is `orders-sql-connection`.

Your job:

1. **Inspect the app identity** attached to `ca-orders-api-prod`.
2. **Inspect the role assignments** for `mi-orders-api-prod`.
3. **Inspect the secret metadata** for `orders-sql-connection` in `kv-devpolaris-prod`.

The grader checks terminal evidence from Azure.

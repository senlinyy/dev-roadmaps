---
title: "Check Key Vault Access"
sectionSlug: managed-identity-lets-the-app-read-without-a-password
order: 5
---

Check whether the orders API can read its database secret through a managed identity instead of a stored password. The identity is `mi-orders-api-prod`, and the vault scope is `/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.KeyVault/vaults/kv-devpolaris-prod`.

Your job:

1. **Inspect role assignments** for `mi-orders-api-prod`.
2. **Confirm the Key Vault secret-read role** is present.
3. **Confirm the scope** is the production vault.

The grader checks terminal evidence from Azure.

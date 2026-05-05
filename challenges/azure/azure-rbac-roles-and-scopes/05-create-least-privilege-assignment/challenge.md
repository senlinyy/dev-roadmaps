---
title: "Create Least Privilege Assignment"
sectionSlug: least-privilege-for-the-orders-api
order: 5
---

Grant the orders API identity access to write export files without giving it broad subscription access. The principal is `mi-orders-api-prod`, the needed role is `Storage Blob Data Contributor`, and the target scope is the storage account `/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.Storage/storageAccounts/stdevpolarisexports`.

Your job:

1. **Create a role assignment** for `mi-orders-api-prod`.
2. **Use the storage blob data role** needed for export writes.
3. **Limit the scope** to the `stdevpolarisexports` storage account.

The grader checks the Azure assignment evidence created in the terminal.

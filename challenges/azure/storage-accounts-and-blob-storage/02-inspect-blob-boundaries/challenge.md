---
title: "Inspect Blob Boundaries"
sectionSlug: the-storage-account-is-the-outer-boundary
order: 2
---

Use Azure CLI evidence to inspect the Blob Storage boundary for `devpolaris-orders-api`. The storage account is `stdevpolarisordersprod` in `rg-devpolaris-storage-prod`. The receipt container is `receipts`.

Your job:

1. **Inspect** the storage account settings that affect access and network defaults.
2. **Inspect** the receipt container and confirm its public access state.
3. **List** the receipt blobs so the team can see real object names.

The grader checks that your output includes the account, container, private access state, and receipt objects.

---
title: "Check Workload Access"
sectionSlug: rbac-is-the-permission-identity-is-the-caller
order: 5
---

The runtime identity exists, but identity alone is not permission. Inspect whether `mi-orders-api-prod` has access to read secrets from the production vault `kv-devpolaris-prod`.

Your job:

1. **Inspect role assignments** for `mi-orders-api-prod`.
2. **Find the Key Vault role** used by the workload.
3. **Confirm the scope** is the production vault, not the whole subscription.

The grader checks terminal evidence from Azure.

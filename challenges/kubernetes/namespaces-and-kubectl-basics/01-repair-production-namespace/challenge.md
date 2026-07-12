---
title: "Repair the Production Namespace"
sectionSlug: namespaces
order: 1
---

The notification platform Namespace retains its API identity and ownership annotations, but its production name and labeling structure are incomplete. Finish the metadata so policy, ownership, and cost tooling can recognize the production boundary.

Your job:

1. **Keep API version `v1` and kind `Namespace`** for the cluster-scoped resource.
2. **Set the Namespace name** to `notifications-prod`.
3. **Author a labels mapping** with `app.kubernetes.io/part-of` set to `customer-notification-platform`.
4. **Add the environment label** with value `prod` in the same mapping.

The grader checks the parsed Namespace identity and both exact label values.

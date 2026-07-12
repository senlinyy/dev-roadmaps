---
title: "Repair the Orders Release Role"
sectionSlug: roles-and-rolebindings
order: 1
---

The orders release service account has an approved Role identity, but its namespace scope and least-privilege rules are missing. Build the complete release authorization contract without granting access to Secrets.

Your job:

1. **Keep the Role named `orders-release`** and define its namespace scope as `orders`.
2. **Build one rule for API group `apps`** covering resources `deployments` and `replicasets` with verbs `get`, `list`, `watch`, `patch`, and `update`.
3. **Build one core API rule** covering only resource `pods` with verbs `get`, `list`, and `watch`.
4. **Keep Secrets outside the contract** so no rule grants access to resource `secrets`.

The grader checks the exact namespace, resource sets, and verb sets in the parsed Role.

---
title: "Build a Least-Privilege Release Identity"
sectionSlug: roles-and-rolebindings
order: 1
---

The delivery controller needs a namespaced Kubernetes identity that can observe Pods and update orders Deployments, but it must not read Secrets or gain cluster-wide access. Build the ServiceAccount, Role, and RoleBinding as three separate reviewable resources.

Your job:

1. **Create ServiceAccount `orders-release`** in namespace `orders` without adding token Secrets.
2. **Create Role `orders-release`** in the same namespace with one `apps` rule for `deployments` and `replicasets` using `get`, `list`, `watch`, `patch`, and `update`.
3. **Add one core API rule** for `pods` using only `get`, `list`, and `watch`.
4. **Create RoleBinding `orders-release`** that binds that exact Role to that exact ServiceAccount in namespace `orders`.
5. **Do not add ClusterRoles, ClusterRoleBindings, Secrets, wildcard resources, or wildcard verbs.**

The grader parses the complete RBAC resource set, checks the exact least-privilege rules, resolves both RoleBinding references, and rejects broader resource kinds.

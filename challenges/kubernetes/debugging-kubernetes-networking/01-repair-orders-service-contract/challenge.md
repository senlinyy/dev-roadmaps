---
title: "Repair the Orders Service Contract"
sectionSlug: the-service-contract
order: 1
---

The caller can resolve `orders-api.orders`, and the Service identity is correct, but its internal traffic contract is missing. Build the Service selection and port mapping so the stable caller contract reaches the current orders API Pods.

Your job:

1. **Keep Service `orders-api`** in namespace `orders` with API version `v1`.
2. **Build an internal Service contract** with type `ClusterIP` that selects Pods labeled `app.kubernetes.io/name: orders-api`.
3. **Publish one port named `http`** using protocol `TCP` and caller-facing port `80`.
4. **Map that Service port to Pod target port `3000`**.

The grader checks the parsed Service identity, selector, type, and exact port mapping.

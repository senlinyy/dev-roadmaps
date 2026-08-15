---
title: "Isolate the Orders API Ingress Path"
sectionSlug: allowing-ingress
order: 1
---

The checkout frontend and orders API run in separate namespaces. Inspect their supplied namespace and workload labels, then author the NetworkPolicy that permits only checkout web Pods to reach the orders API port.

Your job:

1. **Keep NetworkPolicy `allow-checkout-web-to-orders-api`** in namespace `orders` using API version `networking.k8s.io/v1`.
2. **Build the protected workload selection** for Pods labeled `app.kubernetes.io/name: orders-api` and declare policy type `Ingress`.
3. **Build one ingress peer** that requires both Pods labeled `app.kubernetes.io/name: checkout-web` and a namespace labeled `kubernetes.io/metadata.name: checkout`.
4. **Keep both source selectors in that same peer item** and allow only protocol `TCP` on destination Pod port `8080`.

The grader parses the complete workspace, proves every selector matches the intended supplied resource, and rejects extra peers, ports, or policy types that would widen access.

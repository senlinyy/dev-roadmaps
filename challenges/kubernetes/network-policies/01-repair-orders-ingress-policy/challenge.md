---
title: "Repair the Orders API Ingress Boundary"
sectionSlug: allowing-ingress
order: 1
---

A policy review approved the NetworkPolicy identity, but the workload boundary and ingress contract are missing. Build the complete policy so only the approved checkout workload can enter the protected Pods.

Your job:

1. **Keep NetworkPolicy `allow-checkout-web-to-orders-api`** in namespace `orders` using API version `networking.k8s.io/v1`.
2. **Build the protected workload selection** for Pods labeled `app.kubernetes.io/name: orders-api` and declare policy type `Ingress`.
3. **Build one ingress peer** that requires both Pods labeled `app.kubernetes.io/name: checkout-web` and a namespace labeled `kubernetes.io/metadata.name: checkout`.
4. **Keep both source selectors in that same peer item** and allow only protocol `TCP` on destination Pod port `8080`.

The grader checks the parsed policy identity, protected workload, combined source boundary, and destination port.

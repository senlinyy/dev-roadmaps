---
title: "Repair the Public Gateway Service"
sectionSlug: loadbalancer-for-infrastructure-entry
order: 1
---

The platform edge needs an infrastructure-managed external address. The submitted Service has approved identity, ownership, and traffic-policy context, but no exposure, workload selection, or listener contract. Build the missing contract so the gateway is the public entry point while application backends can remain private.

Your job:

1. **Preserve the approved Service identity and metadata** for `public-gateway` in the `platform` namespace.
2. **Build infrastructure-managed exposure** using the exact type `LoadBalancer`.
3. **Define the gateway workload contract** with `app.kubernetes.io/name: public-gateway`.
4. **Publish one named `https` listener** on numeric port `443` over `TCP` and route it to the Pod port named `https`.
5. **Leave node-port allocation to the implementation** by defining no fixed `nodePort` field.

The grader checks the parsed Service identity, exposure type, selector, and exact HTTPS port contract.

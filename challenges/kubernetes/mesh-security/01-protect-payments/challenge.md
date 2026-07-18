---
title: "Protect Payments With Mesh Identity"
sectionSlug: allow-checkout-and-block-analytics
order: 1
---

Payments must reject plain transport and accept application calls only from checkout. Complete the namespace transport policy and the workload authorization boundary.

Your job:

1. **Require strict mTLS** for namespace `store` with PeerAuthentication `store-strict-mtls`.
2. **Select only Pods labeled `app: payments`** in AuthorizationPolicy `payments-allow-checkout`.
3. **Use action `ALLOW`** and permit only principal `cluster.local/ns/store/sa/checkout`.
4. **Keep each policy** in namespace `store` with the Istio security v1 API.

The grader checks both parsed policies and rejects extra authorization rules, sources, or principals.

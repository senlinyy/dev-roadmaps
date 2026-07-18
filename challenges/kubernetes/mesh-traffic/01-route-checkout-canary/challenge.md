---
title: "Route the Checkout Canary"
sectionSlug: a-small-canary
order: 1
---

Checkout v2 is ready for a five percent production canary. Complete the destination subsets and route split while keeping callers on the stable checkout Service hostname.

Your job:

1. **Define subsets `v1` and `v2`** from matching `version` Pod labels for host `checkout.store.svc.cluster.local`.
2. **Route the same host through one VirtualService HTTP rule**.
3. **Send weight `95` to subset `v1`** and weight `5` to subset `v2`.
4. **Keep both mesh resources** named `checkout` in namespace `store`.

The grader checks both parsed Istio resources and allows no extra subsets or weighted destinations.

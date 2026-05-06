---
title: "Inspect Backend Health"
sectionSlug: health-probes-decide-who-gets-traffic
order: 2
---

The regional public entry for `devpolaris-orders-api` is Application Gateway `agw-orders-prod` in `rg-devpolaris-network-prod`. The backend pool is expected to contain two API copies.

Your job:

1. **Inspect** backend health for `agw-orders-prod`.
2. **Identify** which backend IP is healthy and which one is failing the probe.
3. **Use** the probe evidence before deciding whether this is DNS, routing, or application health.

The grader checks that you gathered backend health evidence from Azure.

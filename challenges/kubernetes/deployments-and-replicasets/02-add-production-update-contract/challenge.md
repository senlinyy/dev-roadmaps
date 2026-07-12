---
title: "Add the Production Update Contract"
sectionSlug: add-production-runtime-details
order: 2
---

The notification API can run, but its Deployment does not yet protect traffic or bound a production update. Add the approved readiness, capacity, and rollout settings without changing the image or labels.

Your job:

1. **Reserve container capacity** with requests of `300m` CPU and `384Mi` memory, plus limits of `1` CPU and `768Mi` memory.
2. **Gate Service traffic** with an HTTP readiness probe on `/health/ready` through named port `http`, using a 5-second period and failure threshold `3`.
3. **Use a RollingUpdate** with `maxSurge: 1` and `maxUnavailable: 0`.
4. **Bound stalled progress** at `300` seconds and keep `5` old revisions.

The grader checks the production runtime and update fields in the parsed Deployment.

---
title: "Repair the Orders API Probe Contract"
sectionSlug: the-three-probe-questions
order: 1
---

The orders API Deployment has stable production identity and container context, but its probe contract was removed during a merge. Author the three probe structures on the existing `api` container so startup, traffic eligibility, and process recovery remain separate platform decisions.

Your job:

1. **Author a startup HTTP probe** on path `/startupz` and port `8080`, with `periodSeconds: 5` and `failureThreshold: 24`.
2. **Author a readiness HTTP probe** on path `/readyz` and port `8080`, with `periodSeconds: 10`, `timeoutSeconds: 2`, and `failureThreshold: 3`.
3. **Author a liveness HTTP probe** on path `/livez` and port `8080`, with `periodSeconds: 10`, `timeoutSeconds: 2`, and `failureThreshold: 3`.
4. **Keep the Deployment named `devpolaris-orders-api`** in the `orders` namespace and leave the `api` container image unchanged.

The grader checks the parsed Deployment identity, image, and every exact probe path, port, period, timeout, and failure threshold listed above.

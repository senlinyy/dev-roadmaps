---
title: "Budget and Order the Proxy"
sectionSlug: putting-it-all-together
order: 1
---

The checkout workload was meshed without a proxy resource budget, and the application performs a dependency call before its sidecar becomes ready. Add the operating contract to the Pod template.

Your job:

1. **Request 100m CPU and 128Mi memory for the proxy**.
2. **Limit the proxy to 500m CPU and 512Mi memory**.
3. **Hold application startup until the proxy starts**.
4. **Preserve the existing application container resources and image**.

The grader checks all proxy annotations, startup ordering, and the approved application resource contract.

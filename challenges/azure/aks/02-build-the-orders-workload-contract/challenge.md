---
title: "Build the Orders Workload Contract"
sectionSlug: pods-and-deployments
order: 2
---

Complete the AKS workload across three manifests. The `orders-api` ServiceAccount in namespace `orders` must carry client ID `11111111-2222-3333-4444-555555555555`. The Deployment must run three replicas, use that ServiceAccount, opt into Azure workload identity, expose named port `http` on 3000, and include readiness and liveness checks. The ClusterIP Service must select the workload and route port 80 to `http`.

The grader validates all resources and their selector, identity, and port relationships.

---
title: "Build the Orders Workload Contract"
sectionSlug: workload-identity-and-secrets
order: 2
---

Complete the GKE workload across three manifests. Kubernetes ServiceAccount `orders-api` in namespace `orders` must map to `orders-runtime@devpolaris-prod.iam.gserviceaccount.com`. The Deployment must use three replicas, that ServiceAccount, named port `http` on 8080, and readiness and liveness probes. The ClusterIP Service must select the workload and route port 80 to `http`.

The grader validates all resources and their selector, identity, reference, and port relationships.

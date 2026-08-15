---
title: "Build an EKS Workload Contract"
sectionSlug: networking-and-pod-aws-permissions
order: 1
---

Build the production contract for orders-api in the orders namespace. Use the supplied service account with the exact IAM role annotation, a three-replica Deployment that runs as non-root with a read-only root filesystem, named HTTP port 8080, resource requests and limits, and readiness plus liveness probes. Add a ClusterIP Service whose selector reaches the Deployment Pods. Keep the ServiceAccount, Deployment, and Service in separate files so ownership and review stay clear.

---
title: "Inspect Ingress, Egress, and Traffic"
sectionSlug: putting-it-together
order: 2
---

The `orders-api` Cloud Run release is reachable through the load balancer but cannot reach a private database. Inspect the service and its revisions in `europe-west2`.

Verify ingress, runtime service account, VPC connection, egress mode, latest ready revision, and traffic split. Gather evidence before proposing a networking change.

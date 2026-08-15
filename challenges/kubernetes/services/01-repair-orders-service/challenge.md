---
title: "Publish the Orders API Inside the Cluster"
sectionSlug: the-first-service
order: 1
---

The orders API Deployment is already reviewed, but clients need a stable address that survives Pod replacement. Inspect the read-only workload contract, then author the Service that selects exactly those Pods and forwards traffic to their named application port.

Your job:

1. **Keep Service `orders-api`** in namespace `orders` and make it internal-only with type `ClusterIP`.
2. **Derive the selector from the Deployment's Pod template**, requiring both the application and component labels.
3. **Publish exactly one port named `http`** on Service port `80` over `TCP`.
4. **Target the workload's named port `http`** rather than repeating the container's numeric port.

The grader parses both manifests, proves that the Service selector reaches the supplied Deployment, and verifies that every Service target port resolves to a declared container port.

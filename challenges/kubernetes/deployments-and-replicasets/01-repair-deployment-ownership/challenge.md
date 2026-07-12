---
title: "Repair Deployment Ownership"
sectionSlug: labels-and-selectors
order: 1
---

The notification API Deployment was rejected during a production review because it has no controller ownership or Pod template contract. Build both structures while preserving the approved workload name and namespace.

Your job:

1. **Keep the Deployment named `notification-api`** in the `notifications` namespace with `3` replicas.
2. **Build the selector** with `app.kubernetes.io/name: notification-api` and `app.kubernetes.io/component: api`.
3. **Build a Pod template** whose labels exactly match both selector labels.
4. **Define container `api`** with image `ghcr.io/customer-notification/notification-api:2026.06.14-1` and a port named exactly `http` at container port `8080`.

The grader checks the parsed Deployment, matching selector and template labels, replica count, and container contract.

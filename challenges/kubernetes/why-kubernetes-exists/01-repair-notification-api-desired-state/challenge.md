---
title: "Repair the Notification API Desired State"
sectionSlug: desired-state-in-one-example
order: 1
---

The notification API object retains its production identity and platform labels, but its desired-state specification was lost before review. Author the Deployment spec so Kubernetes has a complete ownership and Pod-template contract to reconcile.

Your job:

1. **Keep Deployment `notification-api`** in namespace `notifications-prod`.
2. **Author a Deployment spec** that requests exactly `4` replicas.
3. **Build the ownership relationship** with `app: notification-api` in both the selector and Pod template labels.
4. **Build the Pod template** with container `notification-api` using image `ghcr.io/devpolaris/notification-api:1.4.2`.

The grader checks the parsed object identity, replica count, selector contract, container name, and exact image literal.

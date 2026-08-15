---
title: "Build a Deployable Notification API"
sectionSlug: labels-and-selectors
order: 1
---

The notification API is entering Kubernetes for the first time. Build the application configuration and Deployment as two reviewable manifests so the controller can reconcile three Pods with a stable identity and an explicit runtime contract.

Your job:

1. **Complete ConfigMap `notification-api-config`** in namespace `notifications` with `LOG_LEVEL: info` and `DELIVERY_MODE: async`.
2. **Build Deployment `notification-api`** in the same namespace with `3` replicas and a selector containing both `app.kubernetes.io/name: notification-api` and `app.kubernetes.io/component: api`.
3. **Author matching Pod template labels** and container `api` from image `ghcr.io/customer-notification/notification-api:2026.06.14-1`.
4. **Expose named container port `http` at `8080`** and load the complete ConfigMap through `envFrom.configMapRef`.

The grader parses both files, checks the complete resource set, proves the Deployment selector owns its Pod template, and resolves the ConfigMap reference.

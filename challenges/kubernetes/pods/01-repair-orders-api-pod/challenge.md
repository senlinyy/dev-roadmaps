---
title: "Repair the Orders API Pod"
sectionSlug: the-first-pod-shape
order: 1
---

The platform team received an incomplete Pod manifest for the production orders API. Build the missing metadata and runtime contract so Kubernetes can identify, start, expose, configure, and restart the workload correctly.

Your job:

1. **Keep the Pod named `orders-api`** and place it in the `production` namespace.
2. **Label the Pod `app: orders-api`** so later resources can select it.
3. **Complete container `api`** with image `ghcr.io/devpolaris/orders-api:2026.07.11` and an application port at container port `8080`.
4. **Build the runtime settings** so `LOG_LEVEL` is exactly `info` and the Pod restart policy is exactly `Always`.

The grader checks the parsed manifest structure and exact runtime contract.

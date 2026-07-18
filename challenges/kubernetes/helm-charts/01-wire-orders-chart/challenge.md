---
title: "Wire the Orders Helm Chart"
sectionSlug: how-rendering-connects-values-to-yaml
order: 1
---

The orders chart metadata is approved, but its default values and Deployment template are disconnected. Complete the chart inputs and consume each input in the Kubernetes fields it controls.

Your job:

1. **Keep chart `orders-api` at package version `0.1.0`** and application version `2026.06.16.1`.
2. **Define defaults** for one replica and image repository `ghcr.io/devpolaris/orders-api` with tag `2026.06.16-dev`.
3. **Name the Deployment from the Helm release** with suffix `-orders-api`.
4. **Render the replica count and combined repository and tag** from `.Values` into the Deployment.

The grader checks each file for the chart contract and anchored template expressions.

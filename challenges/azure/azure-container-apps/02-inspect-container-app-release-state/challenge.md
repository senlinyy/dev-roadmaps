---
title: "Inspect Container App Release State"
sectionSlug: revisions-replace-copies-safely
order: 2
description: "Use Azure CLI evidence to verify image, revision traffic, ingress, scale, and secrets."
---

The production container app is `ca-devpolaris-orders-api-prod` in `rg-devpolaris-orders-prod`. A candidate revision is already receiving some traffic.

Collect evidence for:

- The image Azure is running.
- The active revisions and traffic weights.
- The public ingress target port.
- The scale range and secret references.

---
title: "Verify Runtime Inputs And Scale"
sectionSlug: a-release-checklist-for-runtime-trust
order: 2
description: "Use Azure CLI evidence to check configuration, secrets, health-related settings, and scale before approving traffic."
---

The next release touches both App Service and Container Apps for `devpolaris-orders-api`. Use Azure CLI evidence from `rg-devpolaris-orders-prod`.

Inspect:

- App Service settings and identity for `app-devpolaris-orders-api-prod`.
- Container Apps revision, ingress, secrets, and scale for `ca-devpolaris-orders-api-prod`.

You are looking for the values and access the runtime will receive when it starts, plus the health and scale settings that decide whether traffic should continue.

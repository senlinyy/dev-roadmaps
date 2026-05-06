---
title: "Inspect App Service Runtime"
sectionSlug: logs-health-checks-and-first-diagnosis
order: 2
description: "Use Azure CLI evidence to verify the web app runtime, settings, identity, and deployment slots."
---

The production App Service app is `app-devpolaris-orders-api-prod` in `rg-devpolaris-orders-prod`. Inspect it before approving a release.

You need evidence for:

- The runtime and health check path.
- The app settings that shape the Node.js process.
- Whether managed identity is attached.
- Whether a staging slot exists for safer release testing.

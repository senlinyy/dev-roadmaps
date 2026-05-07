---
title: "Inspect Observability Resources"
sectionSlug: the-checkout-request-creates-several-clues
order: 2
---

Use Azure evidence for the production observability setup. The Log Analytics workspace is `law-devpolaris-prod` in `rg-devpolaris-observability-prod`. The Application Insights component is `appi-devpolaris-orders-prod`. The runtime resource is `ca-devpolaris-orders-prod`, with resource ID `/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod`.

Your job:

1. **Inspect** the workspace that stores searchable logs.
2. **Inspect** the Application Insights component for the backend API.
3. **Inspect** current request and failure metrics for the runtime resource.

The grader checks that you gathered workspace, application, and metric evidence.

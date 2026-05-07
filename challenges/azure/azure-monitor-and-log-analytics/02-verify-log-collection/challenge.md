---
title: "Verify Log Collection"
sectionSlug: the-orders-api-needs-app-logs-and-resource-logs
order: 2
---

Use Azure evidence to check log collection for `devpolaris-orders-api`. The workspace is `law-devpolaris-prod`. The Container App resource ID is `/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod`. The Application Gateway resource ID is `/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationGateways/agw-devpolaris-prod`.

Your job:

1. **Inspect** the workspace and its tables.
2. **Inspect** diagnostic settings for the Container App.
3. **Inspect** diagnostic settings for the Application Gateway.

The grader checks that logs from both the app runtime and gateway are connected to the workspace.

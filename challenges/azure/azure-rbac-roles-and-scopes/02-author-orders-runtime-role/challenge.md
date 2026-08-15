---
title: "Author the Orders Runtime Role"
sectionSlug: role-definitions
order: 2
---

The orders runtime needs to inspect its App Service configuration and read production logs, but it must not change the app, role assignments, or subscription resources. Complete `orders-runtime-reader.json` with only `Microsoft.Web/sites/read`, `Microsoft.Web/sites/config/list/action`, and `Microsoft.OperationalInsights/workspaces/query/read`. Keep data actions empty and restrict the single assignable scope to `/subscriptions/sub-prod/resourceGroups/rg-orders-prod`.

The grader parses the role definition and rejects broader scopes or extra permissions.

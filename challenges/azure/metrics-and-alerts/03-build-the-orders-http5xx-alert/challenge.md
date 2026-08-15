---
title: "Build the Orders HTTP 5xx Alert"
sectionSlug: metrics-and-alerts-as-code
order: 3
---

Complete the Azure Monitor metric alert payload for the production Orders App Service. Evaluate every minute over a five-minute window, use severity 1, and fire when the `Microsoft.Web/sites` `Http5xx` total exceeds 25. Scope the rule to `app-devpolaris-orders-prod` and route it only to `ag-devpolaris-orders-oncall`.

The grader parses the metric criteria and routing contract and rejects additional criteria or action groups.

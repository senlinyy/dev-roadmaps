---
title: "Verify Alert Routing"
sectionSlug: a-practical-metrics-and-alerts-review
order: 4
---

Use Azure evidence for the failure-rate alert on `devpolaris-orders-api`. The alert is `alert-orders-api-failure-rate` in `rg-devpolaris-observability-prod`, and it should notify action group `ag-orders-oncall`.

Your job:

1. **Inspect** the alert definition and threshold.
2. **Inspect** the action group that receives the alert.
3. **Inspect** the current failed request metric for the runtime resource.

The grader checks alert threshold, receiver, and current metric evidence.

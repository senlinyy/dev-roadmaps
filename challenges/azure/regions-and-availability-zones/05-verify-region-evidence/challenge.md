---
title: "Verify Region Evidence"
sectionSlug: a-first-placement-record-for-the-orders-api
order: 3
---

Before the deployment handoff, inspect the regional evidence for `devpolaris-orders-api`. The resource group to inspect is `rg-devpolaris-orders-prod-eastus` in subscription `sub-devpolaris-training`; the expected location is `eastus`, with tags for `service`, `env`, and `region-plan`.

Your job:

1. **Inspect the resource group** named `rg-devpolaris-orders-prod-eastus`.
2. **Confirm the location** is `eastus`.
3. **Confirm the tags** identify the service as `orders-api`, the environment as `prod`, and the regional plan as `primary`.

The grader checks the terminal evidence from Azure.

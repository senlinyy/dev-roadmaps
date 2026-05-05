---
title: "Verify The Inventory Boundary"
sectionSlug: deployment-images-resource-groups-and-inventory
order: 4
---

Inspect the Azure resource group boundary for `devpolaris-orders-api`. The production group is `rg-devpolaris-orders-prod` in subscription `sub-devpolaris-training`; it should be in `eastus` and tagged with `team=orders`, `env=prod`, `service=orders-api`, and `owner=backend`.

Your job:

1. **Inspect Azure resource groups** to find the production orders API boundary.
2. **Confirm the location** is `eastus`.
3. **Confirm the tags** show the team, environment, service, and owner.

The grader checks terminal evidence from Azure.

---
title: "Verify Resource Group Tags And Location"
sectionSlug: artifacts-that-prove-where-you-are
order: 5
---

The production resource group should already exist. Verify `rg-devpolaris-orders-prod` before placing application resources inside it.

Your job:

1. **Inspect the resource group** named `rg-devpolaris-orders-prod`.
2. **Confirm the location** is `eastus`.
3. **Confirm the tags** include `team=orders`, `env=prod`, and `service=orders-api`.

The grader checks Azure CLI evidence for the resource group name, location, subscription path, and tags.

---
title: "Verify Inventory Tags"
sectionSlug: tags-turn-resources-into-team-inventory
order: 5
---

The subscription has several resource groups. Verify the inventory before an automation job selects resources by tags.

Your job:

1. **Inspect the resource group inventory** for the active subscription.
2. **Find the orders production group** `rg-devpolaris-orders-prod`.
3. **Find the orders staging group** `rg-devpolaris-orders-staging`.
4. **Confirm tags separate production, staging, and shared resources.**

The grader checks Azure CLI evidence for resource group names, locations, and inventory tags.

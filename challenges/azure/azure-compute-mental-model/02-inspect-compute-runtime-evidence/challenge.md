---
title: "Inspect Compute Runtime Evidence"
sectionSlug: what-to-inspect-when-the-app-does-not-start
order: 2
description: "Use Azure CLI evidence to compare the four compute shapes used by the orders system."
---

The production resource group is `rg-devpolaris-orders-prod` in subscription `sub-devpolaris-training`. Inspect these resources and gather enough evidence to explain what each one runs:

- Web app: `app-devpolaris-orders-api-prod`
- Container app: `ca-devpolaris-orders-api-prod`
- Function app: `func-devpolaris-orders-jobs-prod`
- Virtual machine: `vm-devpolaris-orders-legacy-01`

Collect the runtime type, current state, and one detail that would help during a failed release.

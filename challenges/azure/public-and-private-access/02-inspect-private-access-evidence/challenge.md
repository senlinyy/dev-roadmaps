---
title: "Inspect Private Access Evidence"
sectionSlug: evidence-from-a-working-setup
order: 2
---

The orders API should reach Azure SQL through private endpoint `pe-orders-sql`. The private DNS record is `devpolaris-orders-sql` in zone `privatelink.database.windows.net`.

Your job:

1. **Inspect** the private endpoint in `rg-devpolaris-data-prod`.
2. **Inspect** the private DNS record in `rg-devpolaris-network-prod`.
3. **Confirm** the private endpoint is approved and the DNS record points to private IP `10.30.40.7`.

The grader checks private access evidence from Azure.

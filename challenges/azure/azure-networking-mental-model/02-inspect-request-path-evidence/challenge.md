---
title: "Inspect Request Path Evidence"
sectionSlug: the-orders-api-request-path
order: 2
---

The production review names these resources for `devpolaris-orders-api`: VNet `vnet-devpolaris-prod`, app subnet `snet-orders-api`, SQL private endpoint `pe-orders-sql`, and private DNS record `devpolaris-orders-sql` in zone `privatelink.database.windows.net`.

Your job:

1. **Inspect** the VNet boundary in `rg-devpolaris-network-prod`.
2. **Inspect** the app subnet placement and its attached network controls.
3. **Inspect** the SQL private endpoint and the private DNS record used by the API.

The grader checks that you gathered Azure network evidence from the simulated CLI.

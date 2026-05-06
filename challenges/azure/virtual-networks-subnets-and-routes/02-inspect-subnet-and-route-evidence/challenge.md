---
title: "Inspect Subnet And Route Evidence"
sectionSlug: evidence-before-you-blame-the-app
order: 2
---

The production API runs in VNet `vnet-devpolaris-prod` and subnet `snet-orders-api`. The subnet should use route table `rt-orders-private` in `rg-devpolaris-network-prod`.

Your job:

1. **Inspect** the API subnet placement and attached controls.
2. **Inspect** the route entries in `rt-orders-private`.
3. **Confirm** the route table sends default egress through the firewall appliance at `10.30.0.4`.

The grader checks that you gathered subnet and route evidence from Azure.

---
title: "Inspect VM Runtime Evidence"
sectionSlug: logs-patches-disk-and-monitoring-are-yours
order: 2
description: "Use Azure CLI evidence to verify the VM shape, power state, identity, network, and instance health."
---

The legacy worker runs on `vm-devpolaris-orders-legacy-01` in `rg-devpolaris-orders-prod`. Before touching the service, inspect the VM evidence Azure has.

Collect:

- VM size, image, and operating system.
- Power and provisioning state.
- Private network placement.
- Instance health and boot diagnostics status.

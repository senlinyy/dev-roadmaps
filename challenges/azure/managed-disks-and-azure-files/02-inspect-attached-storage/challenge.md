---
title: "Inspect Attached Storage"
sectionSlug: managed-disks-belong-to-vm-shaped-workloads
order: 2
---

Use Azure CLI evidence for attached storage in the legacy orders path. The managed disk is `disk-orders-legacy-data-01` in `rg-devpolaris-data-prod`. The Azure Files share is `legacy-orders-share` in storage account `stdevpolarisordersprod`.

Your job:

1. **Inspect** the managed disk and confirm its size, SKU, and attachment target.
2. **Inspect** the file share and confirm quota, protocol, and snapshot evidence.
3. **Inspect** the storage account boundary that owns the share.

The grader checks that you gathered evidence for both attached-disk and shared-folder shapes.

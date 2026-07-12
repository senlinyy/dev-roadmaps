---
title: "Repair the Restore Claim"
sectionSlug: pvc-snapshots-and-restore
order: 2
---

The drill's restore claim has stale identity and no recovery contract. Build the PVC so it creates a separate recovery volume from the approved snapshot.

Your job:

1. **Keep API version `v1` and kind `PersistentVolumeClaim`**.
2. **Set the recovery identity** to claim name `notification-postgres-data-restore` in namespace `customer-notifications`.
3. **Build the snapshot relationship** with source name `notification-postgres-2026-06-28`, kind `VolumeSnapshot`, and API group `snapshot.storage.k8s.io`.
4. **Build the restored storage request** with access mode `ReadWriteOnce` and exactly `20Gi` of capacity.

The grader checks every exact restore source, access mode, and capacity literal in the parsed YAML.

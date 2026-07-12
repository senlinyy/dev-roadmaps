---
title: "Repair the PostgreSQL Snapshot"
sectionSlug: pvc-snapshots-and-restore
order: 1
---

A restore drill cannot find the intended PostgreSQL data because the snapshot request has stale identity and no source contract. Build the request that captures the approved claim before the drill proceeds.

Your job:

1. **Keep API version `snapshot.storage.k8s.io/v1` and kind `VolumeSnapshot`**.
2. **Set the snapshot identity** to name `notification-postgres-2026-06-28` in namespace `customer-notifications`.
3. **Build the snapshot source** so it selects PVC `notification-postgres-data`.

The grader checks each exact snapshot identity and source literal in the parsed YAML.

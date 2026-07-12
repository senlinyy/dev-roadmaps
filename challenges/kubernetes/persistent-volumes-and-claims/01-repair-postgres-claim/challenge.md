---
title: "Repair the PostgreSQL Claim"
sectionSlug: dynamic-provisioning-through-a-storageclass
order: 1
---

The notification database claim was copied from a test namespace without its storage request. Build the production PVC contract so the platform can provision durable storage for PostgreSQL.

Your job:

1. **Keep API version `v1`, kind `PersistentVolumeClaim`, and claim name `notification-postgres-data`**.
2. **Place the claim in namespace `customer-notifications`**.
3. **Build the storage request** for StorageClass `fast-ssd`, access mode `ReadWriteOnce`, and exactly `20Gi` of capacity.

The grader checks the parsed object identity, namespace, storage profile, access mode, and capacity.

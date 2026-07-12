---
title: "Repair Stateful Database Identity"
sectionSlug: a-statefulset-skeleton
order: 1
---

The staging PostgreSQL StatefulSet has an approved identity and replica count, but its controller, Pod identity, and durable claim relationships are absent. Build those connected blocks before the database container is added.

Your job:

1. **Keep StatefulSet `notification-postgres`** in namespace `notifications` with exactly `1` replica.
2. **Build the identity relationship** with headless Service name `notification-postgres` and matching selector and Pod template label `app.kubernetes.io/name: notification-postgres`.
3. **Build claim template `data`** with access mode `ReadWriteOncePod`, StorageClass `fast-ssd`, and a `20Gi` storage request.

The grader checks every named identity, label, and storage literal in the parsed StatefulSet.

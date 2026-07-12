---
title: "Mount the PostgreSQL Claim"
sectionSlug: mount-the-claim-into-a-pod
order: 2
---

The PostgreSQL Pod still writes to its short-lived container filesystem. Build both sides of the storage relationship so the approved claim supplies the database data directory.

Your job:

1. **Keep namespace `customer-notifications`, container name `postgres`, and image `postgres:16` unchanged**.
2. **Build a Pod volume named `postgres-data`** that selects claim `notification-postgres-data`.
3. **Build the matching container mount** named `postgres-data` at `/var/lib/postgresql/data`.

The grader checks the stable workload context, PVC reference, and matching container mount.

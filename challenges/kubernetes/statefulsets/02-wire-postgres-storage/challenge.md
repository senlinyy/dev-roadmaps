---
title: "Wire the PostgreSQL Container and Storage"
sectionSlug: add-the-database-container-and-storage-mount
order: 2
---

The StatefulSet now creates stable identities and claims, but its Pod template has no database container contract. Build the PostgreSQL container, credential references, and claim mount without changing the existing controller fields.

Your job:

1. **Build container `postgres`** from image `postgres:16.4` and expose named port `postgres` at container port `5432`.
2. **Build indirect credential references** so `POSTGRES_USER` reads Secret `notification-postgres-auth`, key `username`, and `POSTGRES_PASSWORD` reads the same Secret, key `password`.
3. **Build a claim mount relationship** by mounting volume `data` at `/var/lib/postgresql/data` so it matches the existing claim template name.

The grader checks every exact container, Secret, port, volume, and mount literal in the parsed StatefulSet.

---
title: "Repair the Broken Stack"
sectionSlug: full-debugging-walkthrough
order: 1
---

The orders API starts, then exits because it tries to reach PostgreSQL on its own loopback address. The database is also exposed to the host unnecessarily and has no readiness signal. Repair the Compose contract.

Your job:

1. **Point `DB_HOST` at the `db` service**, not `localhost`.
2. **Remove the database host port** while preserving the API mapping `8080:8080`.
3. **Add a PostgreSQL health check** using `pg_isready -U postgres`.
4. **Make the API wait for healthy database evidence**.

The grader checks the repaired discovery name, exposure boundary, health check, and startup dependency.

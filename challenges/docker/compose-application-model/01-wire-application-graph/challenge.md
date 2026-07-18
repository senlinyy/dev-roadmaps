---
title: "Wire the Application Graph"
sectionSlug: composeyaml-as-the-application-graph
order: 1
---

The catalog stack defines two images but does not describe how they communicate or when the API may start. Complete the Compose application graph.

Your job:

1. **Connect `api` and `db`** to the private `backend` network.
2. **Give `db` the named `postgres-data` volume** at `/var/lib/postgresql/data`.
3. **Set `DB_HOST` to the service name `db`**.
4. **Make `api` wait for `db` to become healthy**.

The grader checks the service wiring, named volume, environment value, and health dependency.

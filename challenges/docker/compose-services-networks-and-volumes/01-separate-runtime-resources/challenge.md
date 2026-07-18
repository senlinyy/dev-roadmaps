---
title: "Separate Runtime Resources"
sectionSlug: the-full-notes-stack
order: 1
---

The notes stack currently places every service on one network and mounts configuration read-write. Repair its resource boundaries.

Your job:

1. **Attach `web` to both `public` and `backend`**, while `api` and `db` use only `backend`.
2. **Publish only the web service** on `8080:80`.
3. **Mount `./config/api.yaml` read-only** at `/etc/notes/api.yaml` in the API.
4. **Persist PostgreSQL data** with `postgres-data` at `/var/lib/postgresql/data`.

The grader checks network membership, public exposure, the read-only bind mount, and the named volume.

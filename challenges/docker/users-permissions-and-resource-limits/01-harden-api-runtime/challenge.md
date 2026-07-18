---
title: "Harden the API Runtime"
sectionSlug: putting-it-all-together
order: 1
---

A Compose review found that the API runs as root with a writable filesystem and no resource boundary. Harden only the `api` service while keeping its image and port mapping.

Your job:

1. **Run as UID and GID `10001:10001`** and drop all Linux capabilities.
2. **Enable `no-new-privileges:true`** and make the root filesystem read-only.
3. **Provide writable temporary space at `/tmp`** through tmpfs.
4. **Limit the service to `0.50` CPUs and `512M` of memory**.

The grader checks the exact runtime restrictions and rejects privileged mode or added capabilities.

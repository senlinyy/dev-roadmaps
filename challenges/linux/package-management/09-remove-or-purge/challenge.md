---
title: "Remove or Purge?"
sectionSlug: how-do-removal-rollback-and-audit-differ
order: 9
revision: 1
---

Nginx is being retired from a host that will be rebuilt for another service. Operations wants proof of the difference between removing program files and purging retained configuration.

You start in `/home/dev`. Your job:

1. **Remove the Nginx package** without requesting a purge.
2. **Show that its configuration remains** after ordinary removal.
3. **Purge the residual package configuration.**
4. **Verify no configuration files remain** under `/etc/nginx`.

The grader checks both the intermediate retained configuration evidence and the final clean state.

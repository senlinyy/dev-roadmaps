---
title: "Repair a Deployment Permission Incident"
sectionSlug: how-does-a-complete-access-check-work
order: 12
revision: 1
---

A new release is present, its configuration file is `root:app` mode `0640`, and the `app` service belongs to the correct group. Production still reports `Permission denied`. Operators are proposing `chmod -R 777 /srv/app`, but the release tree must retain its existing ownership boundaries.

You are logged in as `deploy`. Your job:

1. **Inspect your identity, trace the failing pathname, and read the final file's ACL evidence.**
2. **Reproduce the read failure as the `app` service account.**
3. **Repair only the directory that blocks service traversal.**
4. **Prove the service can read the configuration, then create a deployment proof file** without changing the protected configuration.

The grader checks the original denial, narrow parent repair, service access, inherited release group, and absence of world-open modes.

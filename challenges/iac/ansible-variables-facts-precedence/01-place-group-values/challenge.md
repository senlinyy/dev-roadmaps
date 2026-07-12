---
title: "Place Group Values"
sectionSlug: "defaults-environments-and-host-exceptions"
order: 1
---

The orders web hosts share a service name, API port, and ownership value. Put those shared values in the group vars file so every host in the group gets the same defaults unless a deliberate exception overrides them.

Your job:

1. **Set the shared service name** to `devpolaris-orders-api`.
2. **Set the shared API port** to `8080`.
3. **Set the shared owner** to `devpolaris`.

The grader checks the vars file, not command output.

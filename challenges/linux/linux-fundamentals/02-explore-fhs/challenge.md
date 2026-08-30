---
title: "Follow the Application Trail"
sectionSlug: where-does-linux-put-important-things
order: 2
revision: 2
---

The `orders-api` service failed during startup. Its configuration, changing logs, deployed release, and runtime PID should each live under the standard Linux directory for that kind of data.

You start in `/home/dev`. Your job:

1. **Read the service configuration** from the standard system-wide configuration tree.
2. **Inspect the latest two application log lines** from the directory used for changing log data.
3. **List the deployed release data** from the part of the filesystem used for service content.
4. **Read the runtime PID** from the volatile runtime directory.

The grader checks that your evidence reaches all four filesystem roles.

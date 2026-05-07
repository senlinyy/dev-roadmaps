---
title: "Hide Secret Task Output"
sectionSlug: "no-log-and-log-leakage"
order: 2
---

Protect task output for the environment file that contains the API token.

Requirements:

1. **Template:** render `orders-api.env.j2` to `/etc/default/devpolaris-orders-api`.
2. **Mode:** `"0640"`.
3. **Log safety:** `no_log: true` on the task.

---
title: "Manage One Env Line"
sectionSlug: "why-file-state-matters"
order: 2
---

The role should own one environment setting without creating a duplicate line on every run. Replace the append-style task with a line-level desired-state edit for the orders API port.

Your job:

1. **Manage the orders API environment file** at `/etc/default/devpolaris-orders-api`.
2. **Match the existing port line** before writing the desired `ORDERS_API_PORT` value.
3. **Allow the file to be created** with root ownership and mode `0644`.

The grader checks the parsed task structure, not command output.

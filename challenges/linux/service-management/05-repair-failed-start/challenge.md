---
title: "Repair a Failed Start"
sectionSlug: how-do-the-journal-exit-codes-and-signals-explain-failure
order: 5
---

The deployment starts correctly in an administrator's shell, but `orders.service` fails. Its template was installed with restrictive access. You need the service to work without granting it root privileges. You start in `/home/dev`.

Your job:

1. Inspect the failed service and its journal before changing anything.
2. Inspect `/srv/orders/templates/index.html`. Keep root ownership and mode `640`, but let the `app` group read it.
3. Keep the unit and template contents unchanged. Restart the repaired service under its existing account and verify its current state.

The grader checks diagnostic evidence, narrowly repaired access, the unchanged unit, and a running process under `app`.

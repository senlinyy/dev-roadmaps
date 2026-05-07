---
title: "Notify Nginx Reload"
sectionSlug: "reloading-nginx-after-config-changes"
order: 1
---

Make the Nginx template task notify a reload handler only when the rendered config changes.

Requirements:

1. **Task notification:** `notify: Reload nginx` on the template task.
2. **Handler:** define `Reload nginx` in `roles/orders_web/handlers/main.yml`.
3. **Service action:** use `ansible.builtin.service` with `name: nginx` and `state: reloaded`.

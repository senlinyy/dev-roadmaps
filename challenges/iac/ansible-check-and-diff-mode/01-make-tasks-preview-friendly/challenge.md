---
title: "Make Tasks Preview-Friendly"
sectionSlug: writing-preview-friendly-tasks
order: 1
---

A role copies rendered configuration through a shell command and always runs an external verification command during previews. Replace the file mutation with an idempotent module and isolate the command that cannot model check mode.

Your job:

1. **Render `orders.conf.j2` to `/etc/orders/orders.conf`** with `ansible.builtin.template`.
2. **Enable diff output**, set mode `0640`, and notify `Restart orders`.
3. **Keep the external verification command** but skip it when `ansible_check_mode` is true.
4. **Mark verification as unchanged** because it only reads state.

The grader checks the preview-friendly template task and the guarded verification task.

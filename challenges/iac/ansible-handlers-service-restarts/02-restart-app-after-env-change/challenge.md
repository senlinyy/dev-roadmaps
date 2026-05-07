---
title: "Restart App After Env Change"
sectionSlug: "restarting-a-systemd-service-after-environment-changes"
order: 2
---

Make the environment file task restart the orders API through a handler.

Requirements:

1. **Notification:** `notify: Restart orders API` on the env file task.
2. **Handler module:** `ansible.builtin.systemd_service`.
3. **Service:** `devpolaris-orders-api`, `state: restarted`, `daemon_reload: true`.

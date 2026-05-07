---
title: "Add Health Check Between Batches"
sectionSlug: "health-checks-between-batches"
order: 3
---

Add a post-role health check so each batch proves the local service is responding.

Requirements:

1. **Module:** `ansible.builtin.uri`.
2. **URL:** `http://127.0.0.1/health`.
3. **Expected status:** `status_code: 200`.
4. **Retry shape:** `register: orders_health`, `retries: 5`, `delay: 3`, `until: orders_health.status == 200`.

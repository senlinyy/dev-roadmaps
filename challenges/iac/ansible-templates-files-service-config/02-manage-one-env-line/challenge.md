---
title: "Manage One Env Line"
sectionSlug: "making-small-edits-with-lineinfile"
order: 2
---

Use `lineinfile` to manage one environment setting without appending duplicates.

Requirements:

1. **Path:** `/etc/default/devpolaris-orders-api`.
2. **Match:** `regexp: "^ORDERS_API_PORT="`.
3. **Line:** `line: "ORDERS_API_PORT={{ orders_api_port }}"`.
4. **Create:** `create: true`, owner and group `root`, mode `"0644"`.

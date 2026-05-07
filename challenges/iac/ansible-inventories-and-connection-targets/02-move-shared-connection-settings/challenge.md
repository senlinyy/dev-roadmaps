---
title: "Move Shared Connection Settings"
sectionSlug: "variables-belong-near-the-scope-they-describe"
order: 2
---

Put shared orders web connection settings in `group_vars/orders_web.yml` instead of repeating them per host.

Requirements:

1. **Remote user:** `ansible_user: ubuntu`.
2. **Privilege:** `ansible_become: true`.
3. **Environment:** `orders_environment: prod`.

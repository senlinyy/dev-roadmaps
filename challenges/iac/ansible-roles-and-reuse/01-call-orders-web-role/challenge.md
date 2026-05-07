---
title: "Call Orders Web Role"
sectionSlug: "calling-the-role-from-a-play"
order: 1
---

Update `site.yml` so the play calls the `orders_web` role for the orders web hosts.

Requirements:

1. **Target:** `hosts: orders_web`.
2. **Privilege:** `become: true`.
3. **Role:** call `orders_web` from `roles`.

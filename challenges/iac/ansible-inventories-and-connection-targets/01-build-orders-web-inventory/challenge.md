---
title: "Build the Orders Web Inventory"
sectionSlug: "inventory-is-your-server-map"
order: 1
---

Repair `inventory/prod.yml` so Ansible has two clear orders web hosts.

Requirements:

1. **Group:** create `orders_web` under `all.children`.
2. **First host:** `orders-web-01` with `ansible_host: 10.0.10.21`.
3. **Second host:** `orders-web-02` with `ansible_host: 10.0.10.22`.

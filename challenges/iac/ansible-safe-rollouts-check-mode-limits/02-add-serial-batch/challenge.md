---
title: "Add Serial Batch"
sectionSlug: "serial-rolling-through-the-fleet-in-batches"
order: 2
---

Make the production play roll through the orders web fleet one host at a time.

Requirements:

1. **Target:** `hosts: orders_web`.
2. **Batch size:** `serial: 1`.
3. **Role:** keep the `orders_web` role call.

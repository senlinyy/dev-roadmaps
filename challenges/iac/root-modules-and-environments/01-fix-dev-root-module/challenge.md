---
title: "Fix the Dev Root Module"
sectionSlug: a-devpolaris-orders-environment-layout
order: 1
---

Fix the development root module in `envs/dev/main.tf`.

Requirements:

1. **Module:** `orders_service`.
2. **Source:** `../../modules/orders-service`.
3. **Environment:** `dev`.
4. **Buckets:** `invoice_bucket_name = "dp-orders-invoices-dev"`, `export_bucket_name = "dp-orders-exports-dev"`.
5. **Runtime values:** `replica_count = 1`, `deletion_protection = false`.

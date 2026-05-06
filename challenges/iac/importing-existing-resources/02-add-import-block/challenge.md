---
title: "Add the Import Block"
sectionSlug: import-blocks-in-review
order: 2
---

Describe the bucket in `main.tf` and add the import mapping in `imports.tf`.

Requirements:

1. **Resource:** `aws_s3_bucket.orders_invoices`.
2. **Bucket:** `dp-orders-invoices-prod`.
3. **Import target:** `to = aws_s3_bucket.orders_invoices`.
4. **Import ID:** `id = "dp-orders-invoices-prod"`.

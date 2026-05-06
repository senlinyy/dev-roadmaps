---
title: "Repair the Working Directory"
sectionSlug: the-smallest-useful-working-directory
order: 1
---

Write the first Terraform root module across `main.tf` and `s3.tf`.

Requirements:

1. **Provider:** source `hashicorp/aws`, version constraint `~> 5.0`, region `eu-west-2`.
2. **Bucket resource:** `aws_s3_bucket.orders_invoices`.
3. **Bucket name:** `dp-orders-invoices-prod`.
4. **Tags:** `service = "orders-api"`, `environment = "prod"`, `owner = "platform"`.

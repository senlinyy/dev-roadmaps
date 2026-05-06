---
title: "Separate Prod Values"
sectionSlug: variables-that-differ-by-environment
order: 2
---

Set the production values in `envs/prod/terraform.tfvars`.

Requirements:

1. **Environment:** `environment = "prod"`.
2. **Region:** `aws_region = "eu-west-2"`.
3. **Capacity and safety:** `replica_count = 3`, `deletion_protection = true`.
4. **Buckets:** `invoice_bucket_name = "dp-orders-invoices-prod"`, `export_bucket_name = "dp-orders-exports-prod"`.
5. **Do not add** `source` or `module` blocks to this values file.

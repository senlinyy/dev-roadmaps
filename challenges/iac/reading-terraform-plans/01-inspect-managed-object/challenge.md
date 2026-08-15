---
title: "Inspect a Managed Object in State"
sectionSlug: how-terraform-remembers-the-object
order: 1
revision: 2
---

The production stack is already initialized in `/workspace`. Use Terraform state inspection to prove which bucket address it owns and which remote ID is attached to that address.

Your job:

1. **List** every managed address.
2. **Inspect** `aws_s3_bucket.orders_archive` through Terraform.
3. **Confirm** its remote ID is `dp-orders-archive-prod` and region is `eu-west-2`.
4. **Do** not open `terraform.tfstate` directly.

The grader checks the command workflow and resulting Terraform state, not a prose explanation.

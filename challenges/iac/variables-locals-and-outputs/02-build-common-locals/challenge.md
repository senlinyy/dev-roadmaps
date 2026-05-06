---
title: "Build Common Locals"
sectionSlug: locals-name-decisions-inside-the-module
order: 2
---

Move naming and tags into `locals.tf`, then update `s3.tf` to consume them.

Requirements:

1. **Local:** `name_prefix = "${var.service_name}-${var.environment}"`.
2. **Local:** `common_tags` with `service = var.service_name`, `environment = var.environment`, `managed_by = "terraform"`, merged with `var.extra_tags`.
3. **Bucket name:** `dp-${local.name_prefix}-invoices`.
4. **Resource tags:** use `local.common_tags`.

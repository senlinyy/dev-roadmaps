---
title: "Extract Environment Variable"
sectionSlug: input-variables-bring-choices-in
order: 1
---

Add the environment input in `variables.tf` and use it from `s3.tf`.

Requirements:

1. **Variable:** `variable "environment"` with `type = string`.
2. **Bucket name:** include `${var.environment}` in the name.
3. **Environment tag:** use `var.environment`.
4. **Do not use** hardcoded `"prod"` in the editable file.

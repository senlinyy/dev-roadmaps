---
title: "Add Module Inputs"
sectionSlug: inputs-are-the-module-contract
order: 2
---

Add the missing module inputs in `variables.tf`.

Requirements:

1. **Environment input:** `variable "environment"` with `type = string`.
2. **Validation:** allow only `dev`, `staging`, or `prod`.
3. **Owner input:** `variable "owner"` with `type = string` and `default = "platform"`.
4. **Versioning input:** `variable "versioning_enabled"` with `type = bool` and `default = false`.

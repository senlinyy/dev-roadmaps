---
title: "Use an Ephemeral Write-Only Secret"
sectionSlug: ephemeral-and-write-only-values
order: 1
revision: 2
---

The database module currently accepts a normal password value that can be retained in plan and state. Tighten the contract using current Terraform language support and the provider write-only password argument.

Your job:

1. **Mark** variable `db_password` as string, sensitive, and ephemeral.
2. **Declare** number variable `db_password_version` so password rotation is explicit.
3. **Set** `password_wo` from `var.db_password` and `password_wo_version` from the version variable.
4. **Do** not create an output or local that exposes the password.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.

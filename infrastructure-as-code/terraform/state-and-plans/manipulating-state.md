---
title: "Manipulating State"
description: "Learn how to safely rename, move, import, and remove Terraform state records without corrupting your infrastructure or causing unintended replacements."
overview: "State manipulation changes Terraform's record of which address manages which real object. This article shows moved blocks, import blocks, state commands, removed blocks, and the plan output that proves the state change is safe."
tags: ["state", "terraform state", "import", "mv", "rm", "terraform"]
order: 4
id: article-iac-terraform-state-manipulating
---

## Table of Contents

1. [What State Manipulation Means](#what-state-manipulation-means)
2. [Renaming a Resource with a moved Block](#renaming-a-resource-with-a-moved-block)
3. [Importing an Existing Object](#importing-an-existing-object)
4. [Removing an Object from State Without Destroying It](#removing-an-object-from-state-without-destroying-it)
5. [Using terraform state Commands Carefully](#using-terraform-state-commands-carefully)
6. [A Safe Review Checklist](#a-safe-review-checklist)
7. [Putting It All Together](#putting-it-all-together)

## What State Manipulation Means
<!-- section-summary: State manipulation changes Terraform's address-to-object bindings, so every change needs a plan that proves the real infrastructure will not be damaged. -->

**Manipulating state** means changing Terraform's record of which resource address manages which real object. You might do this when you rename a resource, move a resource into a module, import an existing cloud object, or stop managing an object without deleting it.

This is powerful because state is Terraform's source of managed-object identity. A simple code rename can look like a destroy and create unless Terraform understands that the address moved. A manually created object can be brought under Terraform only after state has a binding for it.

The rule is to make state changes reviewable whenever possible. Modern Terraform gives you configuration-driven `moved`, `import`, and `removed` blocks for many workflows. CLI state commands still exist, but they should be used deliberately and usually with a backup and a peer review.

## Renaming a Resource with a moved Block
<!-- section-summary: A moved block tells Terraform that an existing state binding has a new address, so a code rename plans as a move instead of a destroy and create. -->

Say the old resource name in `main.tf` is too generic:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "dp-billing-prod-logs"
}
```

The team wants the Terraform address to say what kind of logs these are:

```hcl
resource "aws_s3_bucket" "service_logs" {
  bucket = "dp-billing-prod-logs"
}
```

Without a moved block, Terraform may plan to destroy `aws_s3_bucket.logs` and create `aws_s3_bucket.service_logs`. The bucket name is the same, but the Terraform address changed.

Add a `moved` block:

```hcl
moved {
  from = aws_s3_bucket.logs
  to   = aws_s3_bucket.service_logs
}
```

The plan should now show the state move instead of a replacement:

```hcl
  # aws_s3_bucket.logs has moved to aws_s3_bucket.service_logs
    resource "aws_s3_bucket" "service_logs" {
        bucket = "dp-billing-prod-logs"
        id     = "dp-billing-prod-logs"
    }

Plan: 0 to add, 0 to change, 0 to destroy.
```

This plan output is the proof. Terraform understands that the same real bucket now belongs to a new address.

## Importing an Existing Object
<!-- section-summary: Importing creates a state binding for an object that already exists, then the configuration must match the real object closely enough for a clean plan. -->

Import is useful when a real object exists outside Terraform and you want Terraform to manage it. The safe workflow has two parts: write the resource block and declare the import.

In `main.tf`, write the resource as you intend to manage it:

```hcl
resource "aws_s3_bucket" "audit_archive" {
  bucket = "company-audit-archive-prod"

  tags = {
    environment = "prod"
    service     = "audit"
    managed_by  = "terraform"
  }
}
```

In `imports.tf`, declare the import:

```hcl
import {
  to = aws_s3_bucket.audit_archive
  id = "company-audit-archive-prod"
}
```

Then run a plan:

```hcl
  # aws_s3_bucket.audit_archive will be imported
    resource "aws_s3_bucket" "audit_archive" {
        bucket = "company-audit-archive-prod"
        id     = "company-audit-archive-prod"
    }

Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.
```

After the import, run another plan. If Terraform proposes changes, compare them carefully. Some changes may be intentional normalization, like adding missing tags. Others may reveal that the written configuration does not match the real object.

:::expand[Import does not write perfect configuration for you]{kind="pitfall"}
Import connects a Terraform address to a real object. It does not magically prove that your resource block includes every setting the provider will manage. If the written configuration omits an argument that Terraform manages, the next plan may propose changing the real object to match the code.

A careful import starts by reading the current object in the cloud console or CLI, writing the resource block close to the existing settings, running the import plan, and then running a second normal plan. The second plan is where you learn whether the code and object agree.

For important production resources, import in a dedicated pull request. Keep the import block, resource block, and plan output together so reviewers can see that Terraform is adopting the object rather than replacing it.
:::

## Removing an Object from State Without Destroying It
<!-- section-summary: A removed block can tell Terraform to stop managing an object while leaving the real infrastructure in place. -->

Sometimes Terraform should stop managing an object without deleting it. A team may move a DNS zone to another stack, hand a resource to a different team, or retire Terraform management for a legacy object.

Use a `removed` block with `destroy = false`:

```hcl
removed {
  from = aws_s3_bucket.legacy_reports

  lifecycle {
    destroy = false
  }
}
```

The plan should show the state removal, not a destroy:

```hcl
  # aws_s3_bucket.legacy_reports will no longer be managed by Terraform, but will not be destroyed
  . resource "aws_s3_bucket" "legacy_reports" {
      . bucket = "legacy-reports-prod"
    }

Plan: 0 to add, 0 to change, 0 to destroy.
```

This is safer than deleting the resource block and hoping reviewers catch the difference. The configuration says exactly what should happen to the state binding.

## Using terraform state Commands Carefully
<!-- section-summary: CLI state commands are useful recovery tools, but configuration-driven moves and imports are usually easier to review. -->

Terraform still has direct state commands:

```bash
terraform state list
terraform state show aws_s3_bucket.logs
terraform state mv aws_s3_bucket.logs aws_s3_bucket.service_logs
terraform state rm aws_s3_bucket.legacy_reports
```

These commands modify state directly. They can be appropriate during an emergency fix, a legacy Terraform version workflow, or a controlled migration. They also bypass the normal code review trail unless the team records exactly what happened.

Before running direct state commands on shared infrastructure, pull a backup if your backend workflow requires it, confirm the backend key and workspace, acquire the lock, and save the command output in the change record. Afterward, run `terraform plan` and check that the plan matches the intended state change.

## A Safe Review Checklist
<!-- section-summary: The safest state changes are small, backed up, planned, and proven by plan output. -->

A safe state manipulation review answers these questions:

1. Which Terraform address is changing?
2. Which real provider object does that address manage?
3. Is the desired action move, import, forget, or direct state edit?
4. Does the plan show zero unintended creates, replacements, or destroys?
5. Is the backend key, workspace, account, and variable file correct?
6. Is there a backup or backend version to recover from?

The plan is the center of the review. A moved block should show a move. An import block should show an import. A removed block with `destroy = false` should show that Terraform stops managing the object without destroying it.

## Putting It All Together
<!-- section-summary: State manipulation is safe when Terraform's record changes in the exact way the team intended and the plan proves it. -->

State manipulation is not a shortcut around Terraform. It is maintenance on Terraform's address-to-object map. Use configuration-driven blocks when you can, keep changes small, and make the resulting plan part of the review.

For official reference, use Terraform's docs for [refactoring with moved blocks](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring), [import blocks](https://developer.hashicorp.com/terraform/language/import), [removed blocks](https://developer.hashicorp.com/terraform/language/resources/syntax#removing-resources), and [`terraform state`](https://developer.hashicorp.com/terraform/cli/commands/state).

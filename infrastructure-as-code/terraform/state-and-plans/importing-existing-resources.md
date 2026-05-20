---
title: "Importing Existing Resources"
description: "Bring existing AWS resources under Terraform management by connecting real objects to resource addresses and reviewing the first plan carefully."
overview: "Import is an ownership change, not a create operation. This article follows an existing S3 bucket as the team writes configuration, imports it into state, and decides what Terraform should manage next."
tags: ["terraform", "opentofu", "aws", "import", "state"]
order: 5
id: article-infrastructure-as-code-terraform-importing-existing-resources
aliases:
  - importing-existing-resources
  - infrastructure-as-code/terraform/importing-existing-resources.md
---

## Table of Contents

1. [The Adoption Question](#the-adoption-question)
2. [What Import Changes](#what-import-changes)
3. [Resource Block First](#resource-block-first)
4. [Import Blocks](#import-blocks)
5. [First Plan](#first-plan)
6. [CLI Import](#cli-import)
7. [Import or Reference](#import-or-reference)
8. [Common First Mistakes](#common-first-mistakes)
9. [Putting It All Together](#putting-it-all-together)

## The Adoption Question

The drift article started with AWS resources Terraform already managed. Import starts one step earlier. The AWS account already has a real resource, but Terraform state has no binding for it.

The orders team has an S3 bucket named `dp-orders-invoices-prod`. It was created in the AWS console before the team adopted Terraform. The bucket stores invoice exports, so deleting and recreating it would be a production incident. The team now wants Terraform to manage its tags, versioning, and public access settings.

A resource block alone does not adopt the bucket:

```hcl
resource "aws_s3_bucket" "invoices" {
  bucket = "dp-orders-invoices-prod"
}
```

With that block and no state entry, Terraform sees a configured resource address that it does not manage yet. It may plan to create a bucket with that name. AWS will reject the create if the name is already taken, but the deeper issue is ownership. Terraform has not been told that the existing bucket belongs to `aws_s3_bucket.invoices`.

Import creates that missing binding.

## What Import Changes

Import connects one real object to one Terraform resource address.

For the invoices bucket, the intended binding is:

```text
aws_s3_bucket.invoices -> dp-orders-invoices-prod
```

After import, state records that `aws_s3_bucket.invoices` maps to the existing S3 bucket. Terraform can then compare the resource block, state, and AWS reality during future plans.

Import does not create the bucket. It does not automatically write a complete hand-crafted configuration. It does not mean Terraform now manages every related S3 setting unless those settings are modeled in configuration and state. It changes Terraform's ownership record.

That ownership record matters. Terraform expects one remote object to be bound to one resource address in one state. Importing the same bucket into several states can create competing ownership, where one Terraform run treats another Terraform run's changes as drift.

## Resource Block First

Start by writing the resource block Terraform should use after import.

```hcl
resource "aws_s3_bucket" "invoices" {
  bucket = "dp-orders-invoices-prod"

  tags = {
    Name        = "orders-invoices-prod"
    Environment = "prod"
    Service     = "orders"
  }
}
```

The type and local name create the Terraform address: `aws_s3_bucket.invoices`. The `bucket` argument identifies the real bucket name.

Choose the address carefully before importing. If the bucket belongs to the orders service, `aws_s3_bucket.invoices` is easier to keep than a temporary name such as `aws_s3_bucket.old_bucket`. Address changes after import require state moves or `moved` blocks.

For S3, many controls are managed by separate AWS provider resources. Versioning, public access block settings, bucket policy, encryption, lifecycle rules, and ownership controls can each have their own resource type. Importing the bucket resource is only one part of adopting the full bucket configuration.

If Terraform should manage versioning too, model it:

```hcl
resource "aws_s3_bucket_versioning" "invoices" {
  bucket = aws_s3_bucket.invoices.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

If Terraform should manage public access controls, model those too:

```hcl
resource "aws_s3_bucket_public_access_block" "invoices" {
  bucket = aws_s3_bucket.invoices.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

The goal is to make the intended steady state visible before the first apply. You can still iterate after reading the plan, but the initial configuration should make ownership clear.

## Import Blocks

Modern Terraform can declare imports in configuration with an `import` block.

```hcl
import {
  to = aws_s3_bucket.invoices
  id = "dp-orders-invoices-prod"
}
```

The `to` argument names the Terraform address. The `id` argument is the provider-specific identifier for the real object. For `aws_s3_bucket`, the simple import ID is the bucket name.

With the resource and import block in the same root module, the plan can show the adoption:

```text
  # aws_s3_bucket.invoices will be imported
    resource "aws_s3_bucket" "invoices" {
        bucket = "dp-orders-invoices-prod"
        tags   = {
            "Environment" = "prod"
            "Name"        = "orders-invoices-prod"
            "Service"     = "orders"
        }
    }

Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.
```

That output is reviewable. The team can see which real object will be attached to which address before state changes.

Some provider resources also support a structured `identity` form in import blocks. The S3 bucket resource can be identified by bucket name, and optionally account ID and region. The simpler `id` form is common and easy to read for one bucket. Use provider documentation for the resource you are importing because import IDs are resource-specific.

After a successful import apply, the import block can either remain as historical configuration or be removed by team convention. The important part is that the resource block stays. Terraform now has a state binding for that address, and the configuration should continue to describe the managed object.

## First Plan

The first plan after import is where adoption becomes real review.

A clean result might say:

```text
No changes. Your infrastructure matches the configuration.
```

That means the resource block, state, and AWS reality agree for the modeled arguments.

More often, the first plan shows differences:

```text
  # aws_s3_bucket.invoices will be updated in-place
  ~ resource "aws_s3_bucket" "invoices" {
      ~ tags = {
          + "Environment" = "prod"
          + "Name"        = "orders-invoices-prod"
          + "Service"     = "orders"
        }
        id = "dp-orders-invoices-prod"
    }
```

This may be expected. The team wants Terraform to add standard tags. The same first plan might also reveal surprises: a missing lifecycle rule, a public access setting that is not modeled yet, versioning suspended in AWS, or a bucket policy managed by another team.

Do not rush the first apply after import. The first plan is an inventory conversation:

- Which differences should Terraform enforce?
- Which existing settings should be added to configuration?
- Which settings belong to another owner?
- Which planned changes would affect production data or application access?

Import is often iterative. Write enough configuration, import, plan, add missing resource blocks or arguments, plan again, and apply only when the planned changes are intentional.

## CLI Import

Terraform also has a CLI import command:

```bash
terraform import aws_s3_bucket.invoices dp-orders-invoices-prod
```

The CLI command writes the binding into state directly. It is useful for older Terraform versions, one-off recovery, and workflows that have not adopted import blocks.

The tradeoff is review visibility. A CLI import can happen outside a pull request unless the team records the command and reviews the follow-up plan. Import blocks fit code review better because the intended binding is visible in configuration before apply.

The same rules apply either way:

- write the destination resource block
- verify the AWS account and region
- import the real object into the intended address
- read the first plan carefully
- avoid importing the same object into multiple states

The command is short. The ownership decision behind it is the important part.

## Import or Reference

Use import when this Terraform root module should own the object's lifecycle going forward.

The invoices bucket belongs in the orders production root module if the orders team owns its tags, versioning, public access settings, policy, lifecycle, and eventual retirement. Import says, "this state owns this resource."

Use a data source or input variable when another system owns the object and this module only needs to read it.

For example, if a central networking team owns the VPC, the orders module might read it:

```hcl
data "aws_vpc" "shared" {
  tags = {
    Name = "shared-prod-vpc"
  }
}
```

The orders module can then use `data.aws_vpc.shared.id` without taking lifecycle ownership of the VPC. If the networking team changes the VPC tags or replaces the VPC through its own workflow, that ownership remains with the networking state.

The review question is ownership, not convenience. Import is right when the module should manage the object. A data source is right when the module needs information about an object owned elsewhere.

## Common First Mistakes

**Writing no resource block.** Terraform needs a destination address and configuration for the imported object.

**Importing into a temporary name.** Choose the long-term resource address before import.

**Using the wrong AWS account or region.** Import uses the active provider configuration and credentials.

**Assuming one import covers every related setting.** S3 bucket controls such as versioning and public access block can be separate resources.

**Applying the first plan too quickly.** The first plan may reveal configuration gaps or risky changes.

**Importing shared resources into an app module.** Use a data source when another team owns the object.

**Binding one object to several states.** Competing Terraform owners create drift and unpredictable changes.

## Putting It All Together

The orders team started with a real S3 bucket that Terraform did not manage. Recreating it was unsafe because it held production invoice exports.

The safe adoption path was:

- write the destination resource block
- choose the final Terraform address
- add an import block mapping the existing bucket name to that address
- review the import plan
- inspect the first post-import plan for missing configuration and risky changes
- model related S3 controls when this module should own them
- use data sources for objects owned by other teams

Import is an ownership operation. It tells Terraform, "this existing AWS object now belongs to this resource address in this state." After that, the normal Terraform loop takes over: configuration, state, provider refresh, plan, review, and apply.

---

**References**

- [Import resources overview](https://developer.hashicorp.com/terraform/language/import) - Explains configuration-driven import workflows and resource identity.
- [import block reference](https://developer.hashicorp.com/terraform/language/block/import) - Documents `to`, `id`, `identity`, `for_each`, and provider selection for import blocks.
- [Import an existing resource](https://developer.hashicorp.com/terraform/language/import/single-resource) - Walks through writing destination resources, import blocks, planning, and applying imports.
- [terraform import command](https://developer.hashicorp.com/terraform/cli/commands/import) - Documents the CLI import command and its address and ID arguments.
- [Import existing infrastructure resources](https://developer.hashicorp.com/terraform/cli/import) - Explains CLI import workflows and limitations.
- [aws_s3_bucket resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) - Documents S3 bucket arguments, attributes, and import IDs.
- [Query infrastructure data](https://developer.hashicorp.com/terraform/language/data-sources) - Explains data sources for reading objects managed outside the current state.

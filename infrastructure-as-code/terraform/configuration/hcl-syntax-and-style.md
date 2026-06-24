---
title: "HCL Syntax & Style"
description: "Learn how Terraform .tf files use blocks, arguments, expressions, formatting, and references to describe real infrastructure safely."
overview: "HCL is the language Terraform reads from .tf files. This article walks through a small web service configuration, shows where variables, locals, resources, and outputs are consumed, and connects the code to the plan output you review before apply."
tags: ["terraform", "hcl", "syntax", "formatting"]
order: 1
id: article-iac-terraform-config-hcl-syntax
---

## Table of Contents

1. [What HCL Is Doing in a Terraform Project](#what-hcl-is-doing-in-a-terraform-project)
2. [The Four File Types You Read First](#the-four-file-types-you-read-first)
3. [Blocks, Labels, and Arguments](#blocks-labels-and-arguments)
4. [Variables, Locals, Resources, and Outputs in One Flow](#variables-locals-resources-and-outputs-in-one-flow)
5. [How the Same Values Appear in a Plan](#how-the-same-values-appear-in-a-plan)
6. [Style That Helps Review](#style-that-helps-review)
7. [Common Syntax Mistakes](#common-syntax-mistakes)
8. [Putting It All Together](#putting-it-all-together)

## What HCL Is Doing in a Terraform Project
<!-- section-summary: HCL gives Terraform a readable structure for infrastructure, and Terraform uses that structure to build a plan before it changes anything. -->

**HCL**, short for HashiCorp Configuration Language, is the configuration language Terraform reads from `.tf` files. It gives you a readable way to describe cloud resources, provider settings, variables, local names, and outputs. You write the target shape of the infrastructure, and Terraform works out the provider calls needed to reach that shape.

For this article, imagine a small team running a public status page. The page has one S3 bucket for static files, standard tags for cost reporting, and an output that gives the bucket name to the deployment job that uploads HTML. This is small enough to read in one sitting, but it uses the same HCL shapes that appear in production modules.

The important thing to notice is that HCL is not just text. Terraform reads every `.tf` file in the current directory, combines the blocks, checks the syntax, evaluates expressions, and then creates a plan. That plan shows which resources will be created, updated, replaced, or destroyed before Terraform sends requests to the provider APIs.

Official Terraform documentation describes the language around **arguments** and **blocks**. That is the beginner anchor. Blocks create containers like resources, variables, providers, and outputs. Arguments set values inside those containers. Expressions connect those values together.

## The Four File Types You Read First
<!-- section-summary: Terraform loads all .tf files in a directory together, so file names are for humans and teams rather than execution order. -->

A Terraform root module often has several `.tf` files. Terraform does not run them from top to bottom like a shell script. It loads all `.tf` files in the directory as one configuration. Teams still split files because review and maintenance get clearer when each file has a job.

For the status page project, the file layout can stay simple:

```hcl
terraform-status-page/
  providers.tf
  variables.tf
  locals.tf
  main.tf
  outputs.tf
```

`providers.tf` usually holds Terraform and provider setup. `variables.tf` declares the inputs that callers can change. `locals.tf` gives names to expressions you reuse. `main.tf` holds the main resources. `outputs.tf` exposes useful results after the plan applies.

This split does not create hidden ordering. A resource in `main.tf` can consume a variable declared in `variables.tf`, a local declared in `locals.tf`, and an output declared in `outputs.tf` can read a resource attribute from `main.tf`. Terraform connects them through references, not through file order.

## Blocks, Labels, and Arguments
<!-- section-summary: Blocks create structure, labels identify the block, and arguments assign values inside the block. -->

A **block** is a container. A **label** is a quoted name after the block type. An **argument** is a named setting inside the block. These three pieces show up again and again in Terraform code.

Here is the smallest resource shape:

```hcl
resource "aws_s3_bucket" "status_site" {
  bucket = "devpolaris-status-prod"
}
```

`resource` is the block type. `"aws_s3_bucket"` is the provider resource type. `"status_site"` is the local name this Terraform project uses for the bucket. `bucket = "devpolaris-status-prod"` is an argument that sets the real bucket name sent to AWS.

Nested blocks use the same idea, but they describe a smaller object inside a larger object. Arguments use `=`, while nested blocks open with `{` directly. That difference matters because providers define which names are arguments and which names are nested blocks.

```hcl
resource "aws_s3_bucket_website_configuration" "status_site" {
  bucket = aws_s3_bucket.status_site.id

  index_document {
    suffix = "index.html"
  }
}
```

`bucket = aws_s3_bucket.status_site.id` is an argument that consumes another resource attribute. `index_document { ... }` is a nested block because the provider schema expects a website index object there.

:::expand[Why Terraform cares about argument shape]{kind="design"}
Terraform has to know the difference between structure and data before it can validate a configuration. A map argument like `tags = { service = "status-page" }` is one value assigned to one argument. Terraform evaluates that expression and gives the resulting map to the provider.

A nested block like `index_document { suffix = "index.html" }` is part of the provider's resource schema. Terraform validates that block name, the number of allowed blocks, and the arguments inside it against the provider schema. That is why replacing the nested block with `index_document = { suffix = "index.html" }` can fail even though the braces look similar.

This matters in review. When you see `=`, you are reading a value expression. When you see a block name followed directly by `{`, you are reading structure. That one visual check catches many Terraform syntax mistakes before you even run `terraform validate`.
:::

## Variables, Locals, Resources, and Outputs in One Flow
<!-- section-summary: A practical Terraform value often starts as a variable, gets shaped by a local, feeds a resource argument, and appears again in an output. -->

Now connect the common value types in real files. The status page team wants each environment to choose its own bucket name and tags, while the module keeps naming and merge rules in one place.

In `variables.tf`, the caller-facing inputs are declared:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment name, such as dev, stage, or prod."
}

variable "service_name" {
  type        = string
  description = "Short service name used in resource names and tags."
}

variable "extra_tags" {
  type        = map(string)
  description = "Additional tags supplied by the owning team."
  default     = {}
}
```

These variables do not create cloud objects. They define named inputs. A caller can pass values through a `.tfvars` file, environment variables, CLI flags, or a parent module.

In `locals.tf`, the project gives names to expressions it will reuse:

```hcl
locals {
  bucket_name = "dp-${var.service_name}-${var.environment}"

  common_tags = merge(
    {
      service     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )
}
```

`local.bucket_name` consumes `var.service_name` and `var.environment`. `local.common_tags` consumes both variables and `var.extra_tags`. The local values keep the naming and tagging rules in one place so the resource blocks stay readable.

In `main.tf`, the resource consumes those local values:

```hcl
resource "aws_s3_bucket" "status_site" {
  bucket = local.bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "status_site" {
  bucket = aws_s3_bucket.status_site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

The first resource uses `local.bucket_name` for the real bucket name and `local.common_tags` for tags. The second resource uses `aws_s3_bucket.status_site.id`, so Terraform knows the public access block depends on the bucket. That reference is both a value lookup and a dependency signal.

In `outputs.tf`, the project exposes the values that other tools or modules need:

```hcl
output "status_bucket_name" {
  description = "Name of the S3 bucket that stores the status page files."
  value       = aws_s3_bucket.status_site.bucket
}

output "status_bucket_arn" {
  description = "ARN of the S3 bucket for IAM policy wiring."
  value       = aws_s3_bucket.status_site.arn
}
```

The deployment job that uploads the static page can read `status_bucket_name` after apply. A parent module can read `module.status_page.status_bucket_arn` and place that ARN in an IAM policy. This is the full value path: **variable input -> local expression -> resource argument -> output value**.

## How the Same Values Appear in a Plan
<!-- section-summary: The plan shows evaluated values where Terraform already knows them and marks provider-generated values as known after apply. -->

The plan is where HCL turns into a reviewable change. If the team passes this environment file:

```hcl
environment  = "prod"
service_name = "status"
extra_tags = {
  owner = "platform"
}
```

Terraform can evaluate the bucket name and tags before creating the bucket. The plan shows the consumed values inside the resource change:

```hcl
Terraform will perform the following actions:

  # aws_s3_bucket.status_site will be created
  + resource "aws_s3_bucket" "status_site" {
      + arn    = (known after apply)
      + bucket = "dp-status-prod"
      + id     = (known after apply)
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "status"
        }
    }

  # aws_s3_bucket_public_access_block.status_site will be created
  + resource "aws_s3_bucket_public_access_block" "status_site" {
      + block_public_acls       = true
      + block_public_policy     = true
      + bucket                  = (known after apply)
      + ignore_public_acls      = true
      + restrict_public_buckets = true
    }

Changes to Outputs:
  + status_bucket_arn  = (known after apply)
  + status_bucket_name = "dp-status-prod"
```

This plan shows exactly where the values land. `var.environment` and `var.service_name` created `local.bucket_name`, and that local value appears as `bucket = "dp-status-prod"`. The merged tags appear inside the `tags` argument. The public access block's `bucket` value depends on `aws_s3_bucket.status_site.id`, so Terraform marks it as known after apply because AWS will return the final ID during creation.

## Style That Helps Review
<!-- section-summary: Terraform style is less about decoration and more about making infrastructure diffs small, predictable, and easy to review. -->

`terraform fmt` is Terraform's built-in formatter for `.tf` files. It normalizes spacing, indentation, and alignment so a pull request shows infrastructure changes rather than personal formatting choices. Teams usually run it locally and in CI.

The rough version of the bucket resource might look like this:

```hcl
resource "aws_s3_bucket" "status_site" {
bucket=local.bucket_name
tags=local.common_tags
}
```

After `terraform fmt`, the same resource reads like this:

```hcl
resource "aws_s3_bucket" "status_site" {
  bucket = local.bucket_name
  tags   = local.common_tags
}
```

The style rule is practical: keep files boring enough that reviewers can focus on risk. Use two-space indentation, let `terraform fmt` align nearby arguments, keep related resource blocks close, and use names that explain the role of the object in this Terraform project.

For names, prefer `aws_s3_bucket.status_site` over `aws_s3_bucket.bucket1`. The local name does not have to match the cloud name exactly. It should help a reader understand what the object does in the configuration.

## Common Syntax Mistakes
<!-- section-summary: Most beginner HCL errors come from mixing up blocks and arguments, using a reference name that does not exist, or expecting file order to control behavior. -->

The first common mistake is writing an argument like a block:

```hcl
resource "aws_s3_bucket" "status_site" {
  tags {
    service = "status"
  }
}
```

For AWS S3 buckets, `tags` is a map argument, so the shape should use `=`:

```hcl
resource "aws_s3_bucket" "status_site" {
  tags = {
    service = "status"
  }
}
```

The second common mistake is writing a nested block like an argument. If a provider expects a block, keep the block shape:

```hcl
resource "aws_s3_bucket_website_configuration" "status_site" {
  bucket = aws_s3_bucket.status_site.id

  index_document {
    suffix = "index.html"
  }
}
```

The third common mistake is using a reference that does not exist. `local.bucket_name` only works if a `locals` block defines `bucket_name`. `aws_s3_bucket.status_site.arn` only works if a resource named `aws_s3_bucket.status_site` exists and the provider exposes an `arn` attribute.

`terraform validate` catches many of these issues before planning. `terraform plan` then proves how Terraform evaluated the values and which resources those values affect.

## Putting It All Together
<!-- section-summary: HCL is easiest to learn when you trace one value from input, through expression, into resource configuration, and finally into plan output. -->

The useful way to read a Terraform project is to trace values. Start with `variables.tf` to see what the caller supplies. Move to `locals.tf` to see naming and tagging rules. Read `main.tf` to see where those values are consumed by resources. Finish with `outputs.tf` to see what leaves the module after apply.

That flow also gives you a review habit. If a pull request changes a variable default, check every local and resource that consumes it. If a local naming rule changes, look for replacements in the plan. If an output changes, check the downstream module or deployment job that reads it.

For official reference, keep the Terraform docs for [configuration syntax](https://developer.hashicorp.com/terraform/language/syntax/configuration), [references to values](https://developer.hashicorp.com/terraform/language/expressions/references), [`terraform fmt`](https://developer.hashicorp.com/terraform/cli/commands/fmt), and [`terraform validate`](https://developer.hashicorp.com/terraform/cli/commands/validate) close by while reading real projects.

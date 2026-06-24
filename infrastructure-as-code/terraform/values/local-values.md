---
title: "Local Values"
description: "Use local values to name and reuse computed expressions inside a Terraform configuration, removing repetition and making complex logic readable."
overview: "Local values are named expressions inside a module. This article shows how locals shape variable inputs into names, tags, policy fragments, and resource arguments that appear clearly in Terraform plans."
tags: ["locals", "local values", "expressions", "terraform", "hcl"]
order: 2
id: article-iac-terraform-values-locals
---

## Table of Contents

1. [What Local Values Do](#what-local-values-do)
2. [The Naming and Tagging Problem](#the-naming-and-tagging-problem)
3. [Declaring Locals](#declaring-locals)
4. [Consuming Locals in Resources](#consuming-locals-in-resources)
5. [Reading Locals in Plan Output](#reading-locals-in-plan-output)
6. [When Locals Help and When They Hide Too Much](#when-locals-help-and-when-they-hide-too-much)
7. [Putting It All Together](#putting-it-all-together)

## What Local Values Do
<!-- section-summary: Local values give names to expressions inside one module so repeated logic has one readable home. -->

A **local value** is a named expression inside a Terraform module. You declare it in a `locals` block and reference it as `local.<name>`. Locals do not accept values from outside the module. They are calculated from variables, resource attributes, functions, and literal values already available inside the module.

Locals are useful when a value appears in several places or when an expression deserves a name. A bucket name rule, a common tag map, or a generated IAM policy document can be easier to review when the expression is named once and consumed by resources.

The practical test is simple: a local should make the resource code easier to read. If a local hides one tiny literal that is used once, it may add noise. If it explains a naming rule or keeps tags consistent across ten resources, it earns its place.

## The Naming and Tagging Problem
<!-- section-summary: Real Terraform modules often repeat service names, environment names, and tags unless locals centralize those expressions. -->

Imagine a team building a module for a service log bucket and a CloudWatch log group. Both resources need the service name, environment, owner, and cost center. Without locals, every resource repeats the same tag expression and every name repeats the same string pattern.

That repetition creates review risk. One resource gets `environment = "prod"` while another gets `env = "prod"`. One name uses `billing-prod`, while another uses `prod-billing`. Locals let the module define those rules once.

## Declaring Locals
<!-- section-summary: A locals block can collect naming rules, common tags, and derived values that resources will consume later. -->

In `locals.tf`, the module turns variables into reusable values:

```hcl
locals {
  name_prefix = "dp-${var.service_name}-${var.environment}"

  common_tags = merge(
    {
      service     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )

  log_bucket_name = "${local.name_prefix}-logs"
  app_log_group   = "/aws/app/${local.name_prefix}"
}
```

`local.name_prefix` consumes `var.service_name` and `var.environment`. `local.common_tags` consumes both variables and `var.extra_tags`. The later locals consume earlier locals in the same module, which keeps the naming chain clear.

Locals can appear in one `locals` block or several. Terraform treats all local values in the module as one namespace. Teams often keep them in `locals.tf` because it gives reviewers one place to inspect naming and tagging rules.

## Consuming Locals in Resources
<!-- section-summary: Locals show up in resource blocks through local.name references. -->

In `main.tf`, resources consume the local values:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.log_bucket_name
  tags   = local.common_tags
}

resource "aws_cloudwatch_log_group" "app" {
  name              = local.app_log_group
  retention_in_days = var.retention_days
  tags              = local.common_tags
}
```

The resource blocks stay compact. The bucket does not repeat the full string template, and the log group does not rebuild the tag map. Both resources consume the same local tags, so a change to the tag rule affects both in one reviewable place.

Locals can also feed outputs:

```hcl
output "resource_name_prefix" {
  description = "Shared prefix used by resources in this module."
  value       = local.name_prefix
}
```

That output helps parent modules and deployment logs understand the naming rule without duplicating it.

## Reading Locals in Plan Output
<!-- section-summary: Terraform plans show the evaluated result of a local, not the local expression itself. -->

If the caller passes `service_name = "billing"` and `environment = "prod"`, Terraform evaluates the locals before building the resource diff:

```hcl
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }

  # aws_cloudwatch_log_group.app will be created
  + resource "aws_cloudwatch_log_group" "app" {
      + name              = "/aws/app/dp-billing-prod"
      + retention_in_days = 90
      + tags              = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }
```

The plan shows `dp-billing-prod-logs`, not `local.log_bucket_name`. Reviewers connect the two by reading the code path: variables feed locals, and locals feed resource arguments.

## When Locals Help and When They Hide Too Much
<!-- section-summary: Locals help when they name real shared logic, but too many locals can make readers jump around for simple values. -->

Good locals usually have one of three jobs. They name a repeated expression, they give business meaning to a derived value, or they keep a rule consistent across resources. `local.common_tags`, `local.name_prefix`, and `local.private_subnet_ids_by_az` are examples that usually help.

Weak locals usually rename a value without adding meaning:

```hcl
locals {
  env = var.environment
}
```

If every resource now uses `local.env`, reviewers have to jump from the resource to the local and then to the variable to learn the value. The local did not reduce complexity.

:::expand[The local that grows into a module boundary]{kind="pattern"}
A local sometimes starts as a simple expression and grows into business logic. For example, a module may build a large IAM policy document from variables, feature flags, and resource ARNs. At first, a local keeps the policy readable. Later, the policy generation takes over half the file.

That is a signal to reconsider the design. The module may need a clearer input object, a separate submodule, or a data source such as `aws_iam_policy_document` that gives the policy structure. The local itself is not the problem. The problem is that the module boundary no longer explains the rule clearly.

During review, ask whether the local makes the resource easier to understand. If the answer is yes, keep it. If the answer requires tracing many unrelated branches, simplify the inputs or move the logic to a better boundary.
:::

## Putting It All Together
<!-- section-summary: Locals are best when they name a real expression that several resources or outputs consume. -->

Local values sit between inputs and resources. Variables bring values into the module. Locals shape those values into names, tags, maps, lists, and policy fragments. Resources and outputs consume the locals.

Use locals for repeated rules and meaningful derived values. Keep them close enough to the resource story that a reviewer can trace `var.service_name` into `local.name_prefix`, then into `aws_s3_bucket.logs.bucket`, then into the plan output.

For official reference, use Terraform's docs for [local values](https://developer.hashicorp.com/terraform/language/values/locals), [references to values](https://developer.hashicorp.com/terraform/language/expressions/references), and [functions](https://developer.hashicorp.com/terraform/language/functions).

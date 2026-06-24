---
title: "Input Variables"
description: "Parameterize your Terraform configurations with input variables so the same code works across different environments and teams."
overview: "Input variables are the public inputs to a Terraform module. This article shows how variables are declared, how values are supplied, where they are consumed in resources and locals, and how the evaluated values appear in plan output."
tags: ["variables", "input", "parameterization", "terraform", "hcl"]
order: 1
id: article-iac-terraform-values-input-variables
---

## Table of Contents

1. [What Input Variables Do](#what-input-variables-do)
2. [Declaring the Inputs](#declaring-the-inputs)
3. [Supplying Values for an Environment](#supplying-values-for-an-environment)
4. [Consuming Variables in Locals and Resources](#consuming-variables-in-locals-and-resources)
5. [Reading Variables in the Plan](#reading-variables-in-the-plan)
6. [Validation, Defaults, and Sensitive Values](#validation-defaults-and-sensitive-values)
7. [Putting It All Together](#putting-it-all-together)

## What Input Variables Do
<!-- section-summary: Input variables let one Terraform configuration accept different environment values without copying the resource code. -->

An **input variable** is a named value that a Terraform module receives from the outside. It works like a module setting. The module declares what it needs, and the caller supplies the actual value for development, staging, production, or another deployment.

Think about a logging bucket module. The bucket naming rule stays the same, but each environment has a different service name, retention setting, and tag set. Variables let you keep one resource definition and feed it the values that change.

This matters in real teams because copied Terraform folders drift quickly. One copied folder gets a new tag. Another gets a stronger retention setting. A third keeps the old name rule. Variables keep the reusable shape in one place and make the changing pieces visible in the plan.

## Declaring the Inputs
<!-- section-summary: A variable block declares the input name, type, description, default behavior, and optional validation rules. -->

Variables usually live in `variables.tf`. The block name is the reference name used elsewhere as `var.<name>`.

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment, such as dev, stage, or prod."

  validation {
    condition     = contains(["dev", "stage", "prod"], var.environment)
    error_message = "environment must be one of dev, stage, or prod."
  }
}

variable "service_name" {
  type        = string
  description = "Short service name used in names and tags."
}

variable "retention_days" {
  type        = number
  description = "Number of days to retain log objects."
  default     = 30
}

variable "extra_tags" {
  type        = map(string)
  description = "Additional tags supplied by the owning team."
  default     = {}
}
```

The type is part of the contract. `environment` must be a string. `retention_days` must be a number. `extra_tags` must be a map where every value is a string. Terraform can catch wrong shapes before it calls a provider API.

## Supplying Values for an Environment
<!-- section-summary: Teams usually pass variable values through tfvars files, CI variables, parent modules, or environment variables. -->

A local development run might use `dev.tfvars`:

```hcl
environment    = "dev"
service_name   = "billing"
retention_days = 7

extra_tags = {
  owner = "platform"
}
```

A production run might use `prod.tfvars`:

```hcl
environment    = "prod"
service_name   = "billing"
retention_days = 90

extra_tags = {
  owner       = "platform"
  compliance  = "sox"
  cost_center = "finops-42"
}
```

In CI/CD, the pipeline often chooses the file:

```bash
terraform plan -var-file=env/prod.tfvars
```

For child modules, the caller supplies variables inside the `module` block:

```hcl
module "log_bucket" {
  source = "./modules/log-bucket"

  environment    = "prod"
  service_name   = "billing"
  retention_days = 90
  extra_tags     = local.platform_tags
}
```

This is where variables define an interface. The module author chooses the input names and types. The caller chooses the values.

## Consuming Variables in Locals and Resources
<!-- section-summary: Variables help when locals and resources consume them through var.name references. -->

Variables do not create cloud resources by themselves. They do their work when other `.tf` files consume them.

In `locals.tf`, the module shapes the variable values into names and tags:

```hcl
locals {
  bucket_name = "dp-${var.service_name}-${var.environment}-logs"

  tags = merge(
    {
      service     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )
}
```

In `main.tf`, resources consume those locals and one variable directly:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    expiration {
      days = var.retention_days
    }
  }
}
```

The value path is concrete. `var.service_name` and `var.environment` feed `local.bucket_name`. `local.bucket_name` feeds `aws_s3_bucket.logs.bucket`. `var.retention_days` feeds `aws_s3_bucket_lifecycle_configuration.logs.rule.expiration.days`.

## Reading Variables in the Plan
<!-- section-summary: Plan output shows where variable values landed after Terraform evaluated locals and resource arguments. -->

If production passes `service_name = "billing"`, `environment = "prod"`, and `retention_days = 90`, the plan shows the evaluated values inside resources:

```hcl
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "compliance"  = "sox"
          + "cost_center" = "finops-42"
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }

  # aws_s3_bucket_lifecycle_configuration.logs will be created
  + resource "aws_s3_bucket_lifecycle_configuration" "logs" {
      + bucket = (known after apply)

      + rule {
          + id     = "expire-old-logs"
          + status = "Enabled"

          + expiration {
              + days = 90
            }
        }
    }
```

The plan does not usually say "this came from `var.retention_days`." You connect that by reading the `.tf` files. The code says `days = var.retention_days`, and the plan shows `days = 90`. That is the review loop.

## Validation, Defaults, and Sensitive Values
<!-- section-summary: Validation blocks catch bad inputs, defaults reduce repeated values, and sensitive variables hide display output without removing state risk. -->

Validation belongs close to the variable because it protects every resource that consumes the input. The `environment` validation above catches a typo like `prd` before Terraform creates incorrectly tagged infrastructure.

Defaults are useful when the value has a safe common choice. `retention_days = 30` can be a reasonable default for development. Production can override it with a longer value. Required variables omit `default`, so Terraform asks the caller to provide a value.

Sensitive variables hide values from normal CLI output:

```hcl
variable "database_password" {
  type        = string
  description = "Password used only for a local training database."
  sensitive   = true
}
```

Sensitive display is helpful, but it does not make Terraform state a secret vault. If a sensitive value is sent to a resource argument, Terraform may still store it in state so future plans can compare changes. Real production secrets should usually come from a secret manager, short-lived identity, or provider-managed password feature.

:::expand[Choosing a variable type that helps the caller]{kind="pattern"}
A loose variable type makes a module flexible at first, but it can push errors into resource planning. A stronger type catches mistakes at the module boundary.

For example, `type = map(any)` accepts almost anything. That may let a caller pass a number where the module expected a string tag. `type = map(string)` gives Terraform enough information to reject the bad input early.

Objects are useful when several values travel together. Instead of three separate variables for `min_size`, `max_size`, and `instance_type`, a module can accept an object named `capacity`. The caller sees one grouped input, and the module can validate the relationship between fields.
:::

## Putting It All Together
<!-- section-summary: A good variable has a clear name, a useful type, a caller-friendly description, and visible consumption in locals, resources, or child modules. -->

Input variables are the doorway into a Terraform module. They should explain what the caller can change, what type each value must have, and which values have safe defaults. The real test is whether a reviewer can follow the variable from `variables.tf` into locals, resources, module calls, and plan output.

For official reference, use Terraform's docs for [input variables](https://developer.hashicorp.com/terraform/language/values/variables), [type constraints](https://developer.hashicorp.com/terraform/language/expressions/type-constraints), [custom validation](https://developer.hashicorp.com/terraform/language/expressions/custom-conditions), and [sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data).

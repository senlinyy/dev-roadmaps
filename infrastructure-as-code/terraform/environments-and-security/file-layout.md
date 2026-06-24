---
title: "File Layout and Environment Isolation"
description: "Organize your Terraform repository with a directory structure that keeps environments cleanly separated and scales with your team."
overview: "Terraform file layout is an operations choice. This article shows a practical live/modules layout, where variables and backend settings live, how resources consume module inputs, and how plans prove you are targeting the right environment."
tags: ["file layout", "environments", "organization", "repository", "terraform"]
order: 2
id: article-iac-terraform-environments-file-layout
---

## Table of Contents

1. [Why File Layout Matters](#why-file-layout-matters)
2. [A Practical live/modules Repository](#a-practical-livemodules-repository)
3. [The Environment Folder](#the-environment-folder)
4. [The Shared Module Folder](#the-shared-module-folder)
5. [How the Plan Proves the Target](#how-the-plan-proves-the-target)
6. [Layout Rules That Age Well](#layout-rules-that-age-well)
7. [Putting It All Together](#putting-it-all-together)

## Why File Layout Matters
<!-- section-summary: File layout controls how easy it is to see the target environment, backend, variables, and reusable module boundaries. -->

Terraform does not require one universal repository layout. The best layout makes the target environment obvious and keeps reusable code separate from environment-specific configuration.

A risky layout hides production and development behind the same folder, same backend, and a pile of runtime flags. A safer layout lets a reviewer answer basic questions quickly: which environment is this, which backend state does it use, which account or subscription does it target, and which module code does it call?

For many teams, the clean starting point is a `live/` folder for environment stacks and a `modules/` folder for reusable building blocks.

## A Practical live/modules Repository
<!-- section-summary: live folders hold deployable stacks, while modules hold reusable infrastructure code with inputs and outputs. -->

A small repository can look like this:

```hcl
terraform/
  live/
    dev/
      backend.hcl
      main.tf
      providers.tf
      terraform.tfvars
    prod/
      backend.hcl
      main.tf
      providers.tf
      terraform.tfvars
  modules/
    log-bucket/
      variables.tf
      locals.tf
      main.tf
      outputs.tf
```

Each folder under `live/` is a deployable root module. It has its own backend config, provider config, and environment values. The `modules/` folder contains reusable module code. The live folders call those modules with environment-specific inputs.

This separation helps production review. A change under `modules/log-bucket` changes reusable code. A change under `live/prod` changes production wiring. A change under `live/dev` changes development wiring.

## The Environment Folder
<!-- section-summary: An environment folder chooses backend state, provider target, and module input values. -->

In `live/prod/backend.hcl`:

```hcl
bucket       = "dp-terraform-state-prod"
key          = "infrastructure/billing/prod/terraform.tfstate"
region       = "us-east-1"
use_lockfile = true
```

In `live/prod/terraform.tfvars`:

```hcl
environment    = "prod"
service_name   = "billing"
retention_days = 90

extra_tags = {
  owner       = "platform"
  cost_center = "finops-42"
}
```

In `live/prod/main.tf`, the root module passes those values into the shared module:

```hcl
module "log_bucket" {
  source = "../../modules/log-bucket"

  environment    = var.environment
  service_name   = var.service_name
  retention_days = var.retention_days
  extra_tags     = var.extra_tags
}
```

The environment folder does not define every S3 argument. It chooses the environment values and calls the module that knows how to build the logging bucket.

## The Shared Module Folder
<!-- section-summary: A shared module declares inputs, shapes locals, creates resources, and publishes outputs. -->

Inside `modules/log-bucket/variables.tf`:

```hcl
variable "environment" {
  type = string
}

variable "service_name" {
  type = string
}

variable "retention_days" {
  type = number
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
```

Inside `modules/log-bucket/locals.tf`:

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

Inside `modules/log-bucket/main.tf`:

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

Inside `modules/log-bucket/outputs.tf`:

```hcl
output "bucket_name" {
  value = aws_s3_bucket.logs.bucket
}
```

This gives you the full path. `live/prod/terraform.tfvars` supplies `environment` and `service_name`. `live/prod/main.tf` passes them into the module. The module locals build the bucket name. The resources consume the locals and variables. The output publishes the bucket name back to the root module.

## How the Plan Proves the Target
<!-- section-summary: A plan should show environment-specific names, tags, backend context, and module addresses that match the folder you intended to run. -->

From `live/prod`, the commands should make the target obvious:

```bash
terraform init -backend-config=backend.hcl
terraform plan -var-file=terraform.tfvars
```

The plan uses module addresses:

```hcl
  # module.log_bucket.aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "cost_center" = "finops-42"
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }

Changes to Outputs:
  + log_bucket_name = "dp-billing-prod-logs"
```

If you are in the production folder, the plan should show production names and tags. If it shows development names, check the variable file. If it shows a huge create plan, check the backend key. If it shows module paths you did not expect, check the source path.

## Layout Rules That Age Well
<!-- section-summary: Good layouts make environment context explicit, keep modules reusable, and avoid hiding backend or provider choices in scripts. -->

Keep root modules deployable. A person should be able to enter `live/prod`, initialize the backend, run a plan, and understand the target without reading a custom wrapper script first.

Keep modules reusable. A module should declare inputs and outputs clearly, avoid hardcoding environment-specific names, and let root modules choose provider configuration and environment values.

Keep backend config visible. Hidden backend flags in CI scripts make state targeting hard to review. A checked-in backend config template or environment-specific backend file gives reviewers something concrete to inspect.

:::expand[When a layout is telling you to split a stack]{kind="pattern"}
A root module can grow too large. If one plan touches networking, databases, Kubernetes clusters, monitoring, and app deploy roles together, every small change carries a huge blast radius. Slow plans and nervous reviews are signals that the stack boundary may be too broad.

Splitting a stack can help when parts have different owners, different apply schedules, different state access, or different recovery procedures. A network foundation stack can publish subnet IDs. An application stack can consume those IDs through variables or remote state data where the team accepts that coupling.

The goal is not many folders for decoration. The goal is a state boundary that matches operational ownership and risk.
:::

## Putting It All Together
<!-- section-summary: Terraform layout should make the environment, backend, provider target, module source, and plan impact visible. -->

A good Terraform layout answers operational questions quickly. The environment folder chooses the backend and values. The module folder defines reusable infrastructure. The plan shows the module address and evaluated environment values.

For official reference, use Terraform's docs for [modules](https://developer.hashicorp.com/terraform/language/modules), [backends](https://developer.hashicorp.com/terraform/language/backend), [input variables](https://developer.hashicorp.com/terraform/language/values/variables), and [outputs](https://developer.hashicorp.com/terraform/language/values/outputs).

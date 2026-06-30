---
title: "Input Variables"
description: "Parameterize your Terraform configurations with input variables so the same code works across different environments and teams."
overview: "Input variables are the public inputs to a Terraform root module. This article shows how variables are declared, how values are supplied, where they are consumed in resources and locals, and how the evaluated values appear in plan output."
tags: ["variables", "input", "parameterization", "terraform", "hcl"]
order: 5
id: article-iac-terraform-values-input-variables
aliases:
  - infrastructure-as-code/terraform/values/input-variables.md
---

## Table of Contents

1. [The First Value That Should Change](#the-first-value-that-should-change)
2. [Declaring Variables](#declaring-variables)
3. [Supplying Values](#supplying-values)
4. [Consuming Variables in Locals and Resources](#consuming-variables-in-locals-and-resources)
5. [Validation, Defaults, and Sensitive Inputs](#validation-defaults-and-sensitive-inputs)
6. [Reading Variables in the Plan](#reading-variables-in-the-plan)
7. [Putting It All Together](#putting-it-all-together)

## The First Value That Should Change
<!-- section-summary: Input variables let one Terraform module receive different environment values without copying resource blocks. -->

The first example is one `devpolaris-orders-api` bucket. The dev environment needs `devpolaris-orders-api-dev-exports`, and production needs `devpolaris-orders-api-prod-exports`. Copying the resource block for each environment would work for a short time, but the copies would drift.

![Variable Contract](/content-assets/articles/article-iac-terraform-values-input-variables/variable-contract.png)

*The contract view shows variables as the input surface for values that change between runs.*

An **input variable** is a value a Terraform configuration accepts from outside. The first folder you run Terraform from is called the **root module**. The root module declares the variable name and type. A value file, CLI flag, or environment variable supplies the actual value for a run.

That gives the module a clean contract. The bucket resource can use `var.environment`, and the caller can supply `dev`, `staging`, or `prod`. The resource shape stays in one place.

This is the beginner reason variables exist. They separate the reusable infrastructure code from the values that change between environments, teams, regions, or services.

That input surface should stay small and meaningful. `environment`, `service_name`, `retention_days`, and `extra_tags` are useful inputs because the person or pipeline running Terraform owns those choices. A value such as `managed_by = "terraform"` probably belongs inside the configuration as a local because callers should not change it for each environment.

## Declaring Variables
<!-- section-summary: A variable block declares the input name, type, description, default, and optional validation rules. -->

Variables usually live in `variables.tf`. Terraform's [input variable documentation](https://developer.hashicorp.com/terraform/language/values/variables) covers the full behavior, and the block label is the name you use later with `var.<name>`.

The smallest required input is the service name:

```hcl
variable "service_name" {
  type        = string
  description = "Short service name used in resource names and tags."
}
```

The type is part of the module contract. Terraform can reject a number or list passed to `service_name` before it calls a provider API. Descriptions matter because modules are read by teammates and sometimes generated into documentation. A useful description says who should supply the value and what the value controls.

The next input adds environment validation:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}
```

The validation rule gives a friendlier error if someone passes an unsupported environment name.

Defaults fit values with a safe ordinary choice:

```hcl
variable "retention_days" {
  type        = number
  description = "Number of days to keep export files."
  default     = 30
}
```

The caller can omit `retention_days`, and Terraform uses `30`. Production can still supply a stronger value in a production value file.

A tag map shows a collection type:

```hcl
variable "extra_tags" {
  type        = map(string)
  description = "Additional tags supplied by the owning team."
  default     = {}
}
```

The `map(string)` type says every tag key maps to a string value. That keeps tag values predictable before they flow into resources.

Precise types help for important shapes. A `map(string)` tells callers that every tag value must be a string. An `object` can describe a structured setting:

```hcl
variable "database" {
  type = object({
    instance_class = string
    storage_gb     = number
    multi_az       = bool
  })
  description = "Database sizing and availability settings for the orders API."
}
```

That type catches a missing field or wrong value shape before the provider receives a partial database configuration. The type also documents the module contract more accurately than a loose `any` value.

## Supplying Values
<!-- section-summary: Variable values can come from tfvars files, CLI flags, environment variables, or defaults. -->

For local or CI runs, a `.tfvars` file is common. A dev value file might look like this:

```hcl
service_name   = "orders-api"
environment    = "dev"
retention_days = 7

extra_tags = {
  owner       = "orders-team"
  cost_center = "learning"
}
```

The plan command names the file:

```bash
terraform plan -var-file=dev.tfvars
```

The `-var-file` flag tells Terraform to load `dev.tfvars` for this run. In review, the plan should show dev names, dev tags, and dev-sized settings. The relevant plan lines should look like this:

```console
  + bucket = "devpolaris-orders-api-dev-exports"
  + tags   = {
      + "environment" = "dev"
      + "owner"       = "orders-team"
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

If the output shows production names, the team should check the value file and target environment before applying.

A production file can supply different values:

```hcl
service_name   = "orders-api"
environment    = "prod"
retention_days = 365

extra_tags = {
  owner       = "orders-team"
  cost_center = "commerce"
}
```

Values can also come from `-var`, `TF_VAR_environment`, auto-loaded `*.auto.tfvars` files, or later from module calls. Teams choose a consistent path so reviewers know where environment values live. Secret values should stay out of committed value files.

Module inputs use the same declare, supply, consume idea, but modules deserve their own lesson. For now, the beginner path stays focused on the root module: variables are declared, values are supplied for this run, and resources consume `var.*`.

CI/CD often supplies root-module values with a value file checked into the repository, a generated value file, or environment variables set by the workflow:

```bash
terraform plan -var-file=environments/prod.tfvars -out=tfplan
```

`-var-file=environments/prod.tfvars` tells Terraform which production values to load. `-out=tfplan` saves the exact reviewed plan into a binary plan file for a later apply. A production plan should make the selected environment visible:

```console
Saved the plan to: tfplan

  + bucket = "devpolaris-orders-api-prod-exports"
  + tags   = {
      + "cost_center" = "commerce"
      + "environment" = "prod"
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

Reviewers should confirm the value file path and planned environment before trusting the saved plan.

The team should be able to answer where production values came from during review. A plan with no visible value source is hard to trust.

## Consuming Variables in Locals and Resources
<!-- section-summary: Locals and resources consume variables to build names, tags, and settings. -->

The values above need to reach a resource. A **local value** is an internal named expression calculated inside the module. A `locals.tf` file can shape the inputs before resources consume them, and the next article studies this pattern in more detail:

```hcl
locals {
  name_prefix = "devpolaris-${var.service_name}-${var.environment}"

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

The `main.tf` file consumes the local and variable values:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "${local.name_prefix}-exports"
  tags   = local.common_tags
}

resource "aws_s3_bucket_lifecycle_configuration" "orders_exports" {
  bucket = aws_s3_bucket.orders_exports.id

  rule {
    id     = "expire-old-exports"
    status = "Enabled"

    expiration {
      days = var.retention_days
    }
  }
}
```

This is the full path beginners should trace. `dev.tfvars` supplies `retention_days = 7`. The variable block declares the type. The lifecycle resource consumes `var.retention_days`. The plan shows the final `days` value Terraform will send to AWS.

An **output** is a named value Terraform publishes after planning or applying. Variables can feed outputs and scripts through the resources they shape:

```hcl
output "exports_bucket_name" {
  description = "Bucket name used by the export upload job."
  value       = aws_s3_bucket.orders_exports.bucket
}
```

After apply, a script can consume the output:

```bash
terraform output -raw exports_bucket_name
```

The raw output should be only the value, which makes it useful in shell scripts:

```console
devpolaris-orders-api-dev-exports
```

The deployment step can reuse the applied value:

```bash
bucket_name="$(terraform output -raw exports_bucket_name)"
aws s3 cp ./exports "s3://${bucket_name}/" --recursive
```

`terraform output -raw` returns the bucket name without JSON quotes, and the shell stores it in `bucket_name`. The S3 URI then points to that applied bucket, and `--recursive` uploads the contents of the local `./exports` directory rather than one file. For a folder with one report file, the AWS CLI might print:

```console
upload: exports/orders-2026-06-28.csv to s3://devpolaris-orders-api-dev-exports/orders-2026-06-28.csv
```

The script never needs to rebuild the naming rule. It receives the value Terraform planned and applied. That keeps variable logic inside Terraform and keeps deployment scripts focused on their own job.

## Validation, Defaults, and Sensitive Inputs
<!-- section-summary: Defaults reduce required inputs, validation catches bad values early, and sensitive inputs reduce display of secrets. -->

A default value means callers can omit the variable. In the example, `retention_days` defaults to `30`, so a small dev module can skip it. Production supplies a stronger value because the retention requirement differs.

![Validation And Defaults](/content-assets/articles/article-iac-terraform-values-input-variables/validation-and-defaults.png)

*The validation view shows where defaults help, where required inputs force a choice, and where validation catches bad values early.*

Validation rules catch mistakes before provider calls. The `environment` validation prevents a typo such as `prd` from creating resources with the wrong naming and tags. Validation is most useful for values that would create confusing or risky infrastructure.

Sensitive variables reduce display in CLI output:

```hcl
variable "database_password" {
  type        = string
  description = "Initial database password supplied by a secure secret source."
  sensitive   = true
}
```

Sensitive values can still land in state if Terraform must store them. Terraform's [sensitive data guidance](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) is worth reading before production secret handling. Teams usually prefer provider-managed secrets or references to secret IDs where possible, and they protect state, logs, CI variables, and the path that supplies the value.

Defaults should express a safe normal choice, not hide an important production decision. A default retention of `30` days can be fine for training. A production database instance class, deletion protection flag, or backup retention setting may belong as an explicit input so the caller has to choose it.

Validation should protect values that would create bad names, wrong environments, or risky settings. For example, a retention value can require a reasonable range:

```hcl
variable "retention_days" {
  type        = number
  description = "Number of days to keep export files."
  default     = 30

  validation {
    condition     = var.retention_days >= 1 && var.retention_days <= 3650
    error_message = "retention_days must be between 1 and 3650."
  }
}
```

That error appears before Terraform asks the provider to configure the lifecycle rule.

## Reading Variables in the Plan
<!-- section-summary: The plan shows the evaluated values that variables feed into resources, which is the review point before apply. -->

A dev review uses the dev value file:

```bash
terraform plan -var-file=dev.tfvars
```

`-var-file=dev.tfvars` loads the development values for this review. The plan output is the place to confirm that those values reached the resource arguments.

The bucket plan may show:

```console
  + bucket = "devpolaris-orders-api-dev-exports"
  + tags   = {
      + "cost_center" = "learning"
      + "environment" = "dev"
      + "managed_by"  = "terraform"
      + "owner"       = "orders-team"
      + "service"     = "orders-api"
    }
```

Those values came from variables and locals. A reviewer can check the final resource settings without opening every file first. If the plan shows `prod` in a dev pull request, the value source needs review before the resource changes.

This is how variables support safe review. They let modules stay reusable, and the plan still shows the concrete values that will reach the provider.

For debugging value supply, make the command path visible first. The quick check below lists named value files, auto-loaded value files, and shell-provided `TF_VAR_` values:

```bash
ls *.tfvars *.auto.tfvars 2>/dev/null
env | grep '^TF_VAR_'
terraform plan -var-file=dev.tfvars
```

That quick check might show something like this:

```console
dev.tfvars
prod.tfvars
TF_VAR_environment=staging
```

`*.auto.tfvars` files load automatically, while ordinary `.tfvars` files load only after a `-var-file` flag names them. `2>/dev/null` hides the "no matches" error if no files exist in shells that pass unmatched globs to `ls`. `TF_VAR_` environment variables can supply input values from the shell. In this exact command, `dev.tfvars` should win for any variable it sets because a named variable file has higher precedence than `TF_VAR_` environment variables. The plan should show the final resolved values before review.

If the plan shows a different value than expected, the supply path needs fixing before the resource changes. The resource may be working correctly with the wrong input.

## Putting It All Together
<!-- section-summary: Input variables form the module contract between reusable Terraform code and environment-specific values. -->

Input variables let Terraform code accept values from outside the module. Declare them in `variables.tf`, supply them through a clear team-approved path, consume them in locals and resources, and review their final evaluated values in the plan.

![Variables Summary](/content-assets/articles/article-iac-terraform-values-input-variables/variables-summary.png)

*The summary board gathers the variable rules that make inputs clear, supplied deliberately, and safe to review.*

The orders export bucket showed the full connection. A value file supplied `environment`, `service_name`, `retention_days`, and `extra_tags`. Locals shaped those inputs into names and tags. Resources consumed the final values.

Values that change between environments belong in variables. Values that should always stay internal to the module often belong in locals. That is where the next article goes.

---

**References**

- [Terraform input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Official reference for variable declarations, types, defaults, validation, and value assignment.
- [Terraform variable definitions files](https://developer.hashicorp.com/terraform/language/values/variables#variable-definitions-tfvars-files) - Documents `.tfvars`, `.auto.tfvars`, and command-line variable files.
- [Terraform CLI environment variables](https://developer.hashicorp.com/terraform/cli/config/environment-variables) - Documents `TF_VAR_name` and other Terraform CLI environment variables.
- [Terraform output values](https://developer.hashicorp.com/terraform/language/values/outputs) and [terraform output](https://developer.hashicorp.com/terraform/cli/commands/output) - Explain output blocks and the CLI command used by scripts.
- [Terraform sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - Guidance for sensitive inputs, output display, plans, and state exposure.

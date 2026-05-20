---
title: "Passing Variable Values"
description: "Supply Terraform variable values through tfvars files, auto-loaded files, command flags, and environment variables without making plans hard to reproduce."
overview: "A variable declaration says what a module can receive. This article follows the orders AWS environment as dev, prod, and CI supply concrete values through files, flags, and `TF_VAR_` environment variables."
tags: ["terraform", "opentofu", "tfvars", "variables", "ci"]
order: 3
id: article-infrastructure-as-code-terraform-passing-variable-values
---

## Table of Contents

1. [Where Does This Value Come From](#where-does-this-value-come-from)
2. [Root Module Values](#root-module-values)
3. [terraform.tfvars](#terraformtfvars)
4. [Auto tfvars](#auto-tfvars)
5. [Explicit Var Files](#explicit-var-files)
6. [TF_VAR Environment Variables](#tf_var-environment-variables)
7. [Precedence](#precedence)
8. [Common First Mistakes](#common-first-mistakes)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Where Does This Value Come From

The previous article gave the orders Terraform module a clean input interface. It now declares variables for the environment name, VPC CIDR, instance type, allowed HTTP CIDRs, and tags.

That creates the next review question: when Terraform plans production, where did the production values come from?

A plan that says `instance_type = "t3.small"` is useful only if the team can trace that value to an approved source. A value might come from a checked-in production variable file, a local developer override, a CI environment variable, or a command typed by hand. All four can work. They do not create the same review story.

Passing variable values is about reproducibility. The goal is for a teammate to rerun the same plan and understand why Terraform chose the values it chose.

## Root Module Values

Variable assignment happens at the root module Terraform is running. A child module receives values through arguments in the parent module's `module` block.

For a root module, variables might be declared like this:

```hcl
variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 CIDR block for this environment VPC."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for the web server."
  type        = string
  default     = "t3.micro"
}

variable "allowed_http_cidrs" {
  description = "CIDR ranges allowed to reach the web server on HTTP."
  type        = set(string)
}

variable "tags" {
  description = "Extra tags to apply to created resources."
  type        = map(string)
  default     = {}
}
```

A variable value file then assigns values by name. It does not repeat the `variable` blocks. It does not use `var.environment`. It gives Terraform concrete input values for this run.

That distinction prevents a common confusion:

| File | Job |
| --- | --- |
| `variables.tf` | Declares the module's input interface |
| `terraform.tfvars` | Assigns values to root module variables |
| `prod.tfvars` | Assigns values when explicitly selected |
| `main.tf` | Uses values through `var.<name>` |

The declaration says what can be provided. The assignment says what is provided this time.

## terraform.tfvars

Terraform automatically loads a file named `terraform.tfvars` in the current root module directory. That makes it convenient for the default local values of one environment.

For a development root module, the file might look like this:

```hcl
environment = "dev"
vpc_cidr    = "10.0.0.0/16"

instance_type = "t3.micro"

allowed_http_cidrs = [
  "10.0.0.0/8",
  "203.0.113.10/32",
]

tags = {
  Owner      = "platform"
  CostCenter = "orders"
}
```

The syntax is HCL assignment syntax. The left side is the variable name. The right side is the value. Terraform matches these assignments to declared variables in the root module.

This is a good fit when the directory represents one environment:

```text
infra/orders/dev/
  main.tf
  variables.tf
  terraform.tfvars
```

The path itself says this is the dev root module. The `terraform.tfvars` file says which dev values it uses. A reviewer does not have to remember a command flag to understand the default plan for that directory.

## Auto tfvars

Terraform also automatically loads files whose names end in `.auto.tfvars` or `.auto.tfvars.json`.

Auto-loaded files are useful when the root module has values from several visible sources:

```text
infra/orders/dev/
  main.tf
  variables.tf
  00-common.auto.tfvars
  10-dev.auto.tfvars
```

The common file might hold tags shared across environments:

```hcl
tags = {
  Owner      = "platform"
  CostCenter = "orders"
}
```

The dev file might hold environment-specific choices:

```hcl
environment = "dev"
vpc_cidr    = "10.0.0.0/16"

instance_type = "t3.micro"

allowed_http_cidrs = [
  "10.0.0.0/8",
]
```

Auto tfvars files are loaded in lexical order among the auto-loaded files. Prefixes like `00-` and `10-` make that order visible. If two files assign the same variable, the later value wins according to Terraform's precedence rules.

That can be useful, but it can also hide surprises. Keep auto-loaded files small and named for their role. A production value hidden in `misc.auto.tfvars` is harder to review than one in `10-prod.auto.tfvars`.

## Explicit Var Files

The `-var-file` flag tells Terraform to load a specific variable file for a command.

This pattern is common when one root module has several environment value files:

```text
infra/orders/
  main.tf
  variables.tf
  env/
    dev.tfvars
    prod.tfvars
```

Development values can stay in one file:

```hcl
environment = "dev"
vpc_cidr    = "10.0.0.0/16"

instance_type = "t3.micro"

allowed_http_cidrs = [
  "10.0.0.0/8",
]

tags = {
  Owner      = "platform"
  CostCenter = "orders"
}
```

Production values can stay in another:

```hcl
environment = "prod"
vpc_cidr    = "10.20.0.0/16"

instance_type = "t3.small"

allowed_http_cidrs = [
  "198.51.100.0/24",
  "203.0.113.0/24",
]

tags = {
  Owner       = "platform"
  CostCenter  = "orders"
  Compliance  = "pci"
}
```

The command selects the file:

```bash
terraform plan -var-file="env/prod.tfvars"
```

This makes the selected value set explicit in the command and in CI logs. It also creates a sharp risk: a person can run the right directory with the wrong `-var-file`. For important environments, combine explicit files with separate root modules, separate state, and automation that chooses the file instead of relying on memory.

## TF_VAR Environment Variables

Terraform can read environment variables that start with `TF_VAR_`. The suffix after `TF_VAR_` is the variable name.

Simple string values are straightforward:

```bash
export TF_VAR_environment="staging"
export TF_VAR_vpc_cidr="10.30.0.0/16"
export TF_VAR_instance_type="t3.small"
terraform plan
```

Complex values need syntax Terraform can parse. JSON is usually the easiest choice in shell environments:

```bash
export TF_VAR_allowed_http_cidrs='["198.51.100.0/24","203.0.113.0/24"]'
export TF_VAR_tags='{"Owner":"platform","CostCenter":"orders","Environment":"staging"}'
terraform plan
```

Environment variables are useful in CI systems because the pipeline can inject values without writing new files. They are less visible in ordinary code review. If a production plan depends on CI environment variables, the team should know where those variables are configured, who can edit them, and how the plan output records their effective values.

Avoid using environment variables as invisible long-term configuration. A future engineer reading the repository should be able to understand the environment's shape without access to one person's shell history.

## Precedence

Terraform has precedence rules for variable values. If the same root module variable is assigned from more than one source, Terraform uses the value from the source with higher precedence.

For local CLI workflows, the practical order to remember is:

| Source | Review meaning |
| --- | --- |
| Command-line `-var` and `-var-file` | Explicit for this command |
| `*.auto.tfvars` files | Automatically loaded, ordered by file name |
| `terraform.tfvars` and `terraform.tfvars.json` | Automatically loaded root module defaults |
| `TF_VAR_` environment variables | Supplied by shell or CI environment |
| Variable `default` | Built into the module interface |

This ordering explains a subtle failure. A developer may export `TF_VAR_instance_type=t3.large` while testing, then forget it exists. If `terraform.tfvars` also sets `instance_type`, the tfvars value wins. If no file sets it, the exported environment variable wins over the variable default. The result can feel inconsistent unless the team knows the value sources.

For important environments, prefer one visible value path. A separate production root module with a checked-in `terraform.tfvars` file is easier to review than a mixture of local exports, ad hoc command flags, and hidden CI settings.

## Common First Mistakes

**Putting `variable` blocks in tfvars files.** A tfvars file assigns values. The declarations stay in `.tf` files.

**Assuming every `.tfvars` file loads automatically.** Terraform automatically loads `terraform.tfvars`, `terraform.tfvars.json`, and files ending in `.auto.tfvars` or `.auto.tfvars.json`. A file named `prod.tfvars` needs `-var-file`.

**Passing child module variables from tfvars directly.** Tfvars files assign root module variables. A child module receives values through arguments in the parent module's `module` block.

**Letting command flags become production process.** `-var-file` is useful, but a production workflow should make the selected file hard to miss and hard to mix up.

**Using `TF_VAR_` for complex values without JSON.** Lists, sets, maps, and objects need syntax Terraform can parse. JSON avoids most shell quoting mistakes.

## Putting It All Together

The orders module now has declarations and value sources.

The declarations live in Terraform configuration:

```hcl
variable "vpc_cidr" {
  description = "IPv4 CIDR block for this environment VPC."
  type        = string
}
```

The values come from a visible source for the run:

```hcl
environment = "prod"
vpc_cidr    = "10.20.0.0/16"

instance_type = "t3.small"

allowed_http_cidrs = [
  "198.51.100.0/24",
  "203.0.113.0/24",
]
```

Terraform combines those pieces before planning. The declaration gives the input a name and shape. The value source gives the environment its concrete choices. The plan then shows what those choices would change in AWS.

The review habit is to ask two questions for every important value: where is it declared, and where was it assigned for this run?

## What's Next

The next article handles repeated decisions inside the module. Values now enter through a clear doorway, but the AWS example still repeats names and tags in several resource blocks. Locals give those internal decisions one home.

---

**References**

- [Use input variables to add module arguments](https://developer.hashicorp.com/terraform/language/values/variables) - Terraform guide to assigning root module variables through CLI flags, variable definition files, environment variables, and defaults.
- [Variable block reference](https://developer.hashicorp.com/terraform/language/block/variable) - Language reference for variable block behavior and value validation.
- [Input variables on the command line](https://developer.hashicorp.com/terraform/language/values/variables#variables-on-the-command-line) - Terraform documentation for `-var` and `-var-file` usage.
- [Variable definitions files](https://developer.hashicorp.com/terraform/language/values/variables#variable-definitions-tfvars-files) - Terraform documentation for `terraform.tfvars`, JSON tfvars files, and `*.auto.tfvars` loading.
- [Environment variables](https://developer.hashicorp.com/terraform/language/values/variables#environment-variables) - Terraform documentation for the `TF_VAR_` environment variable convention.

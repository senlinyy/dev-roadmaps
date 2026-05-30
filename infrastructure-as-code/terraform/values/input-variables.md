---
title: "Input Variables"
description: "Parameterize your Terraform configurations with input variables so the same code works across different environments and teams."
overview: "Input variables are how you make Terraform configurations flexible. Instead of hardcoding every value, you declare variables and let the caller provide the specifics. This article covers how to declare variables, all the ways to provide values, and how type constraints and defaults make configurations safer and easier to use."
tags: ["variables", "input", "parameterization", "terraform", "hcl"]
order: 1
id: article-iac-terraform-values-input-variables
---

## Table of Contents

1. [Why Hardcoding Values Is a Problem](#why-hardcoding-values-is-a-problem)
2. [Declaring a Variable](#declaring-a-variable)
3. [Using Variables in Configuration](#using-variables-in-configuration)
4. [Ways to Provide Variable Values](#ways-to-provide-variable-values)
5. [Variable Files: .tfvars](#variable-files-tfvars)
6. [Type Constraints](#type-constraints)
7. [Default Values and Required Variables](#default-values-and-required-variables)
8. [Sensitive Variables](#sensitive-variables)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Hardcoding Values Is a Problem

Suppose you build a Terraform configuration that creates a web server in `us-east-1` using an instance type of `t3.small`. You deploy it to production. Six months later, a colleague wants to set up an identical server for a staging environment — same configuration, but in `us-west-2` and using `t3.micro` to save cost.

If the region and instance type are hardcoded in the resource blocks, your colleague either has to edit the configuration file directly (risking an accidental commit to the production branch) or make a copy of the entire configuration and change those two lines. Both options create problems. Editing the live file risks changing production. Copying the file creates two separate codebases that will slowly drift from each other, just like the manual infrastructure problem that Terraform was supposed to solve.

Input variables eliminate this problem. Instead of writing `us-east-1` directly inside a resource block, you write `var.region`. Then you create a variable called `region`. The production deployment provides `"us-east-1"` for that variable. The staging deployment provides `"us-west-2"`. The same configuration code, run twice with different inputs, produces two separate and correctly configured environments.

This is the same idea as a function parameter in any programming language. You do not write a separate function for every value you might need. You write one function with parameters and call it with different arguments.

## Declaring a Variable

Variables are declared with a `variable` block. The block's label is the variable name. The name becomes the key you use to reference the variable's value throughout the configuration.

![Input variables act as a typed contract between callers, configuration, and resource arguments.](/content-assets/articles/article-iac-terraform-values-input-variables/variable-contract.png)

```hcl
variable "region" {
  type        = string
  description = "AWS region to deploy into, such as us-east-1 or eu-west-1."
  default     = "us-east-1"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for the application server."
}

variable "instance_count" {
  type        = number
  description = "Number of instances to create in the auto-scaling group."
  default     = 2
}
```

Each attribute inside the `variable` block is optional, but you should include at least `type` and `description` for every variable.

`type` constrains what values are acceptable. `string`, `number`, and `bool` are the basic types. Terraform will try to coerce the value into the declared type — if you declare `type = number` and the caller provides `"3"` (a string containing a digit), Terraform converts it to the number `3`. If the value cannot be coerced (like trying to convert `"hello"` to a number), Terraform reports an error immediately, before making any API calls.

`description` is free-form text that explains what the variable is for and what values make sense. It appears in the output of `terraform plan` when a variable has no value and Terraform asks for one interactively. Good descriptions save time — they answer "what should I put here?" without requiring the reader to trace through the rest of the configuration.

`default` makes the variable optional. If the caller does not provide a value, Terraform uses the default. A variable with no default is required — Terraform will not proceed without a value for it.

## Using Variables in Configuration

Inside your configuration, you reference a variable with `var.<name>`:

```hcl
provider "aws" {
  region = var.region
}

resource "aws_instance" "app" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = var.instance_type
  count         = var.instance_count
}
```

The `var.` prefix is how Terraform distinguishes a variable reference from a literal value. `"t3.small"` is a hardcoded string. `var.instance_type` is a reference to whatever value the caller provided for the `instance_type` variable.

Variable references can appear anywhere in a resource block, in module blocks, in data source blocks, and in local value expressions. They cannot appear inside backend configurations or inside `required_providers` blocks — those sections are processed before variables are evaluated.

## Ways to Provide Variable Values

Terraform accepts variable values from several different sources. It processes them in a specific order of precedence, with later sources overriding earlier ones.

**Default values** in the variable declaration are the starting point. If nothing else provides a value for a variable that has a default, the default is used.

**Environment variables** prefixed with `TF_VAR_` override defaults. For example, to provide the `region` variable through an environment variable:

```bash
export TF_VAR_region=eu-central-1
terraform plan
```

This is useful in CI/CD pipelines where injecting values through environment variables is standard practice, and for sensitive values that you do not want written to a file that might be committed to version control.

**A file named `terraform.tfvars`** in the working directory is automatically loaded by Terraform. You do not need to reference it explicitly. Create this file with one variable assignment per line:

```hcl
region         = "us-west-2"
instance_type  = "t3.micro"
instance_count = 1
```

Terraform also automatically loads `terraform.tfvars.json`, then any files ending in `.auto.tfvars` or `.auto.tfvars.json` in lexical order. These automatic files override environment variables and earlier automatic files.

**Files passed explicitly with the `-var-file` flag** override automatically loaded variable files:

```bash
terraform plan -var-file=staging.tfvars
```

This lets you maintain separate variable files for each environment without changing the configuration code.

**The `-var` flag** on the command line provides a single variable value and has the same high precedence as `-var-file`. If you pass several `-var` and `-var-file` options, Terraform processes them in the order they appear on the command line, so later options can override earlier ones:

```bash
terraform plan -var="instance_type=t3.medium"
```

This is convenient for one-off overrides but becomes unwieldy if you have many variables to provide.

**Interactive prompt** is the last resort for a required variable that still has no value. The prompt does not have a normal file-style precedence; it only fills in missing required values. This is only useful in manual workflows. In automated pipelines, a missing variable should cause the pipeline to fail with a clear error rather than hang waiting for input.

## Variable Files: .tfvars

The `.tfvars` file pattern is the most common way teams provide environment-specific values in practice. You maintain one file per environment:

`dev.tfvars`:
```hcl
region         = "us-east-1"
instance_type  = "t3.micro"
instance_count = 1
min_size       = 1
max_size       = 2
```

`prod.tfvars`:
```hcl
region         = "us-east-1"
instance_type  = "t3.medium"
instance_count = 4
min_size       = 2
max_size       = 10
```

Your deployment commands then reference the correct file:

```bash
# For development
terraform plan -var-file=dev.tfvars

# For production
terraform plan -var-file=prod.tfvars
```

One important thing to know: if you put variable files containing secrets (like `db_password = "supersecret"`) in your project directory, be careful about what gets committed to Git. A `.gitignore` entry for `*.tfvars` or `*.auto.tfvars` prevents secret-containing files from being accidentally committed. Use environment variables (via `TF_VAR_`) for secrets in CI/CD rather than files, since environment variables can be injected from a secrets manager without ever touching the filesystem.

Terraform also automatically loads files named `terraform.tfvars.json` and any files ending in `.auto.tfvars` — both the plain-text and JSON variants. Files loaded via `-var-file` are loaded explicitly and not automatically.

## Type Constraints

The type system in Terraform covers more than just strings and numbers. Understanding the full range lets you design variable interfaces that validate inputs at plan time rather than failing mid-apply when the wrong type is passed to an API.

**Primitive types**:
- `string` — any text value
- `number` — any integer or decimal number
- `bool` — `true` or `false`

**Collection types** hold multiple values of one type:
- `list(string)` — an ordered list of strings: `["us-east-1a", "us-east-1b"]`
- `set(string)` — an unordered, deduplicated collection, usually written by callers with list syntax and converted by Terraform: `["us-east-1a", "us-east-1b"]`
- `map(string)` — named string values: `{ environment = "prod", team = "platform" }`

**Structural types** define a fixed shape:
- `object({ key = type, ... })` — a fixed set of named attributes, each with its own type
- `tuple([type, type, ...])` — a fixed-length, ordered list where each position has its own type

Here is a practical example using a `list(string)` for availability zones and a `map(string)` for tags:

```hcl
variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones to spread resources across."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to all resources. Keys and values must be strings."
  default     = {}
}
```

A caller provides:

```hcl
availability_zones = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]

tags = {
  environment = "production"
  team        = "infrastructure"
  cost-center = "eng-core"
}
```

And the resource uses them:

```hcl
resource "aws_subnet" "web" {
  count             = length(var.availability_zones)
  cidr_block        = cidrsubnet(var.cidr_block, 8, count.index)
  availability_zone = var.availability_zones[count.index]
  tags              = var.tags
}
```

This creates one subnet per availability zone, each tagged with whatever the caller provided. The type constraint ensures the caller provides a list of strings for zones and a map of strings for tags — if they accidentally provide a number or a boolean, Terraform catches it immediately during plan.

## Default Values and Required Variables

A variable with a default value is optional. Terraform uses the default when no other source provides a value. Defaults should be the most sensible value for most use cases — something a new user running the configuration would want without knowing every possible setting.

![Defaults and validation let Terraform accept clean values and reject bad inputs early.](/content-assets/articles/article-iac-terraform-values-input-variables/validation-and-defaults.png)

A variable without a default is required. If no value is provided from any source, Terraform stops with an error. Required variables are for information that is fundamentally different between contexts — the target region, the environment name, the database password — where there is no reasonable default that would be safe to assume.

A common pattern is to require the critical, environment-specific variables and give defaults to everything else:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment: dev, staging, or prod. Required."
}

variable "region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "us-east-1"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}
```

`environment` is required — there is no sensible default because `dev` and `prod` have very different implications. `region` has a default that most teams will override for multi-region deployments but that is correct for many single-region setups. `instance_type` has a default that is appropriate for development and can be overridden for production.

## Sensitive Variables

Variables containing secrets — passwords, private keys, API tokens — should be marked with `sensitive = true`:

```hcl
variable "db_password" {
  type      = string
  sensitive = true
}
```

With `sensitive = true`, Terraform replaces the variable's value with `(sensitive value)` in normal plan and apply output, and in many error messages. This prevents many accidental leaks into CI/CD logs.

The sensitive marking is not a security wall. The value is still stored in the state file in plain text, and it is still accessible to any code or resource that uses it. The `sensitive` attribute only controls display. Protecting the actual secret requires restricting access to the state file and to whatever secrets manager you use to inject the value.

For sensitive variables in automated pipelines, the recommended pattern is to inject them as `TF_VAR_` environment variables sourced from a secrets manager (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, GitHub Actions secrets), rather than writing them to `.tfvars` files that might end up in version control.

## Putting It All Together

Input variables are the parameterization layer of Terraform. Instead of writing configurations that only work in one specific context, you write configurations that describe a shape of infrastructure and accept variable inputs that specify the details. The region, the instance size, the number of replicas, the tags — all of these become parameters rather than hardcoded values.

The same configuration code, paired with a `dev.tfvars` file, deploys a lightweight development environment. Paired with a `prod.tfvars` file, it deploys a fully scaled production environment. The logic of how to build the infrastructure lives in one place. The specifics of each environment live in their respective variable files.

Type constraints catch mistakes at plan time, before any real resources are touched. Defaults reduce the cognitive load for new users. Sensitive marking keeps secrets out of logs. Together, these features make a well-designed variable interface one of the most important investments you can make in a Terraform configuration.

## What's Next

Variables provide values from outside the configuration. But sometimes you need to compute intermediate values — combinations, transformations, or reformatted versions of other values — that are used in multiple places within the same configuration. The next article covers local values, which let you compute and name these intermediate expressions so you do not have to repeat them.


![Input variables summary: define clear contracts, provide values deliberately, and protect sensitive inputs.](/content-assets/articles/article-iac-terraform-values-input-variables/variables-summary.png)

---

**References**

- [Input Variables (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/variables) — Complete reference for variable declaration, type system, sensitive flag, and validation rules.
- [Variable Definition Precedence (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/variables#variable-definition-precedence) — The exact order in which Terraform processes values from different sources.
- [Environment Variables (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/config/environment-variables) — Reference for `TF_VAR_` and other Terraform environment variables.

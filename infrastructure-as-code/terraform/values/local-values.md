---
title: "Local Values"
description: "Use local values to name and reuse computed expressions inside a Terraform configuration, removing repetition and making complex logic readable."
overview: "When the same expression appears in three resource blocks, that is a sign you need a local value. Locals let you give a name to any computed expression — a combination of variables, resource attributes, and function calls — and reference it throughout the configuration. This article explains when and how to use them."
tags: ["locals", "local values", "expressions", "terraform", "hcl"]
order: 2
id: article-iac-terraform-values-locals
---

## Table of Contents

1. [The Problem Locals Solve](#the-problem-locals-solve)
2. [Declaring and Using Locals](#declaring-and-using-locals)
3. [Locals as Computed Intermediate Values](#locals-as-computed-intermediate-values)
4. [Locals for Tag Management](#locals-for-tag-management)
5. [Locals With for Expressions](#locals-with-for-expressions)
6. [Locals Are Not Variables](#locals-are-not-variables)
7. [Debugging an Unexpected Local Value](#debugging-an-unexpected-local-value)
8. [When Locals Go Too Far](#when-locals-go-too-far)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem Locals Solve

Imagine a configuration that creates a set of AWS resources — a VPC, several subnets, an EC2 instance, an RDS database, and a security group. Each resource needs a name tag and an environment tag. The name follows the pattern `<project>-<environment>-<resource-type>`.

![Local values normalize repeated raw inputs into consistent names, tags, and resource arguments.](/content-assets/articles/article-iac-terraform-values-locals/locals-normalization.png)

Without locals, you either hardcode the name in every resource block (which means updating it in five places if the project name ever changes) or you repeat the same string interpolation expression in every resource:

```hcl
resource "aws_vpc" "main" {
  cidr_block = var.cidr_block
  tags = {
    Name        = "${var.project}-${var.environment}-vpc"
    environment = var.environment
    project     = var.project
  }
}

resource "aws_instance" "app" {
  ami  = var.ami_id
  tags = {
    Name        = "${var.project}-${var.environment}-app"
    environment = var.environment
    project     = var.project
  }
}
```

Every resource repeats `"${var.project}-${var.environment}-..."`. If you need to add a `team` tag, you add it in every resource. If you want to change the naming pattern, you update it everywhere.

Locals let you compute these values once and give them a name:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = {
    environment = var.environment
    project     = var.project
    team        = "platform"
  }
}
```

Now the resources become:

```hcl
resource "aws_vpc" "main" {
  cidr_block = var.cidr_block
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpc" })
}

resource "aws_instance" "app" {
  ami  = var.ami_id
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-app" })
}
```

One change to `local.name_prefix` or `local.common_tags` propagates everywhere that references them. Adding a new tag means editing one `locals` block, not every resource.

## Declaring and Using Locals

All local values are declared in a single `locals` block (or multiple `locals` blocks — you can have more than one). Each entry is a name and an expression:

```hcl
locals {
  region_short   = substr(var.region, 0, 2)
  account_id     = data.aws_caller_identity.current.account_id
  bucket_name    = "${var.project}-${local.region_short}-${local.account_id}"
}
```

You reference a local with `local.<name>` — note the singular `local`, not `locals`. The `local.` prefix is how Terraform distinguishes local value references from variable references (`var.`) and resource attributes.

Locals can reference other locals, as shown above where `bucket_name` references `region_short` and `account_id`. Terraform evaluates locals lazily in the correct dependency order — it works out which locals depend on which and evaluates them in sequence. There is no need to declare locals in any particular order.

What locals cannot do: they cannot reference their own name, because circular references are not allowed. They can reference resource attributes and module outputs, but if those values are only known after apply, the local value is also unknown until apply. That is fine for normal resource arguments, but it does not work in places where Terraform must know the shape of the graph during planning, such as `count`, `for_each` keys, and some lifecycle decisions.

## Locals as Computed Intermediate Values

The most common use for locals beyond string construction is computing values that would be awkward or unreadable if written inline in a resource block.

Consider a configuration that needs to compute a CIDR block for each availability zone. The `cidrsubnet` function takes a base CIDR block and splits it into smaller sub-networks. Computing this inline in a resource `count` expression would be messy. A local makes it readable:

```hcl
locals {
  az_count   = length(var.availability_zones)
  subnet_cidrs = [
    for i in range(local.az_count) :
    cidrsubnet(var.vpc_cidr, 8, i)
  ]
}

resource "aws_subnet" "web" {
  count             = local.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]
}
```

The `subnet_cidrs` local uses a `for` expression to generate a list of CIDR blocks, one per availability zone. The subnet resource then iterates over the availability zones using `count` and picks the matching CIDR from the pre-computed list.

This is more readable than writing the `cidrsubnet` call inline in the resource block. It is also safer — the CIDR computation runs once and produces a stable list, rather than recomputing each time the resource is referenced.

Another common use is conditional logic. Suppose some resources should only be created in production, and you want to express that concisely:

```hcl
locals {
  is_production       = var.environment == "prod"
  enable_multi_az     = local.is_production
  db_deletion_protect = local.is_production
  replica_count       = local.is_production ? 2 : 0
}
```

Now resource blocks can reference `local.enable_multi_az` and `local.replica_count` instead of repeating the `var.environment == "prod"` expression throughout.

## Locals for Tag Management

Consistent tagging is one of the most practically useful applications of locals. Cloud providers charge you for resources, and tags are how you know which team, project, or environment to attribute those charges to. When tags are inconsistent — some resources have an `environment` tag, others have `env`, some use `prod`, others use `production` — cost allocation reports become unreliable.

A locals block that defines the complete tag set used across all resources in a configuration keeps tags consistent:

```hcl
locals {
  tags = {
    project     = var.project
    environment = var.environment
    region      = var.region
    managed_by  = "terraform"
  }
}
```

Each resource then uses the `merge` function to combine the common tags with any resource-specific ones:

```hcl
resource "aws_s3_bucket" "uploads" {
  bucket = "${local.name_prefix}-uploads"
  tags   = merge(local.tags, { purpose = "user-uploads" })
}

resource "aws_rds_cluster" "main" {
  cluster_identifier = "${local.name_prefix}-db"
  tags               = merge(local.tags, { purpose = "primary-database" })
}
```

`merge` combines multiple maps, with later maps overriding earlier ones if there are duplicate keys. So `merge(local.tags, { purpose = "user-uploads" })` produces a map that includes all four common tags plus the `purpose` key.

When the organization decides to add a `cost-center` tag to all resources, you add it to the `local.tags` map once and every resource picks it up.

## Locals With for Expressions

Locals and `for` expressions are a natural pairing. A `for` expression transforms one collection into another — filtering, reshaping, or regrouping. When that transformation is needed in multiple places, wrapping it in a local prevents the repetition of a complex expression throughout the configuration.

![For expressions can derive reusable maps from lists before resources consume the normalized values.](/content-assets/articles/article-iac-terraform-values-locals/derived-values-map.png)

A common real-world pattern is deriving a map from a list. Suppose you have a list of objects describing your team's users, and you frequently need to look up a user by name. A `for` expression can build the lookup map once:

```hcl
variable "users" {
  type = list(object({
    name  = string
    email = string
    admin = bool
  }))
}

locals {
  users_by_name  = { for u in var.users : u.name => u }
  admin_emails   = [for u in var.users : u.email if u.admin]
  non_admin_names = [for u in var.users : u.name if !u.admin]
}
```

`local.users_by_name` is a map where each user's name is the key and the full user object is the value. You can now look up a specific user with `local.users_by_name["alice"]` anywhere in the configuration, without repeating the `for` expression.

`local.admin_emails` is a filtered list — only the email addresses of users who have `admin = true`. You might use this to configure an SNS subscription or an email notification list.

`local.non_admin_names` is the opposite filter. Both derived lists come from the same source variable and stay in sync automatically — add a new admin user to `var.users` and `local.admin_emails` includes them without any other changes.

Another common pattern is transforming environment-specific configuration. Suppose you have a map of environment settings and you need to extract just the instance types as a flat list:

```hcl
variable "environments" {
  type = map(object({
    instance_type = string
    count         = number
    region        = string
  }))
}

locals {
  instance_types     = { for env, cfg in var.environments : env => cfg.instance_type }
  multi_region_envs  = { for env, cfg in var.environments : env => cfg if cfg.region != "us-east-1" }
}
```

`local.instance_types` extracts just the instance type for each environment into a simple map of strings. `local.multi_region_envs` filters to only the environments not in the primary region. Both are cleaner to read than repeating the `for` expression inline every time you need these derived collections.

The underlying principle: if you find yourself writing the same `for` expression more than once, give it a name in a `locals` block. The name documents the intent, the single definition prevents bugs from inconsistent copies, and future changes only need to happen in one place.

## Locals Are Not Variables

It is important to understand what locals are not. Unlike input variables, locals cannot be set by the caller. They are computed entirely from the configuration itself — from variables, resource attributes, data source results, and expressions. The caller cannot override a local from the command line or a `.tfvars` file.

This is by design. Locals are internal implementation details of a configuration. They are how the configuration author builds intermediate values from the inputs the caller provides. Exposing them to external override would break the abstraction.

This distinction matters when you are designing a module. If a value should be configurable by the module's caller, it should be an input variable. If it is computed from the caller's inputs and used internally, it should be a local.

A common mistake is making something a local when it should be a variable. For example, making the `name_prefix` a local computed from `project` and `environment` assumes that the naming pattern never needs to change. If a caller needs to override the prefix — because their project has an unusual naming convention — they cannot. Making `name_prefix` a variable with a computed default (using `local.name_prefix` as the default) would be more flexible, though Terraform's current language does not support using `local` values as variable defaults directly.

## Debugging an Unexpected Local Value

When a `terraform plan` shows a value that does not match what you expected, and the value comes from a local, you need to trace back through the chain of locals and the expressions they use to find where the discrepancy is.

The most direct tool is `terraform console`. This is an interactive session where you can type any Terraform expression and immediately see its evaluated value. After running `terraform init`, start the console:

```bash
terraform console
```

Inside the console, you can evaluate locals directly:

```
> local.name_prefix
"myproject-prod"

> local.common_tags
{
  "environment" = "prod"
  "managed_by"  = "terraform"
  "project"     = "myproject"
  "region"      = "us-east-1"
}

> local.subnet_cidrs
tolist([
  "10.0.0.0/24",
  "10.0.1.0/24",
  "10.0.2.0/24",
])
```

If `local.name_prefix` shows `"myproject-prod"` but you expected `"myproject-staging"`, you can check the variables it depends on:

```
> var.environment
"prod"
```

If `var.environment` is `"prod"` when you expected `"staging"`, the problem is in how you are providing the variable value — check your `.tfvars` file or environment variables.

The console evaluates locals in real-time, including any resource attributes available from the state file. This makes it the fastest way to verify that a complex chain of locals — ones that reference variables, filter lists, and compute CIDR blocks — produces the values you intend before running `terraform plan`.

Another debugging approach is to add a temporary `output` block for the local you want to inspect:

```hcl
output "debug_common_tags" {
  value = local.common_tags
}
```

Running `terraform plan` with this output block shows the current value of `local.common_tags` in the plan output. Remove the output block after debugging — you do not want permanent debug outputs cluttering the configuration.

## When Locals Go Too Far

Locals can become a problem when they obscure what the configuration actually does. If a locals block contains twenty entries, each one building on the previous ones in complex ways, the configuration becomes difficult to read and debug. When a plan shows an unexpected value, tracing back through a chain of locals to find where it came from is tedious.

A good test is whether the local's purpose is immediately obvious from its name. `local.name_prefix`, `local.common_tags`, `local.is_production` — these are clear. `local.x`, `local.computed_value`, `local.tmp` — these signal that the author was using locals as scratch space rather than as named, meaningful values.

Another warning sign is a local that is used in only one place. If you compute `local.complicated_expression` and then use it only once, in one resource block, the expression might be just as readable inline. Locals add value when they eliminate repetition or when they name a concept that would be opaque as an inline expression.

The general rule: use a local when the expression would appear in more than one place, or when the expression is complex enough that naming it makes the intent clear to a reader who did not write it.

## Putting It All Together

Locals are the glue in the middle layer of a Terraform configuration. Input variables bring in external information — the region, the environment, the project name. Resources create real infrastructure. Locals sit between them, transforming the raw inputs into derived values — name prefixes, tag maps, computed CIDR blocks, boolean flags — that the resources can use directly.

A well-used locals block is a sign of a mature configuration. Instead of repeating the same expression in ten resource blocks, you see `local.name_prefix` referenced cleanly. Instead of each resource declaring its own tags independently, they all call `merge(local.common_tags, {...})`. Changes that would otherwise require finding and updating every occurrence now require editing one line in the locals block.

Combined with `for` expressions, locals become a powerful data-transformation layer. A list of user objects from a variable can be transformed into a lookup map, a filtered list of admins, and a list of email addresses — each as a separate, named local — so that every resource that needs any of those shapes can reference it directly rather than re-deriving it.

When a local produces an unexpected value, `terraform console` gives you an interactive way to evaluate the expression chain and pinpoint where the value diverges from expectation. This makes even complex multi-step locals debuggable without running a full plan and apply cycle.

The discipline to apply is: write locals that clearly name a concept, put them close to where they are used (in the same file if the configuration is split across multiple files), and resist the temptation to build overly deep chains of locals just because the language allows it. The right amount of abstraction in locals — like the right amount of abstraction anywhere — is the amount that makes the configuration easier to read without requiring the reader to trace through layers of indirection.

## What's Next

Input variables bring values in and locals compute intermediate values from them. The third part of the values layer is outputs: how a configuration or module exposes information back to the caller or to the operator running the apply. The next article covers how to declare outputs, when to mark them sensitive, and how they carry data between modules.


![Local values summary: reduce repetition, compute shared values once, and keep external inputs separate.](/content-assets/articles/article-iac-terraform-values-locals/locals-summary.png)

---

**References**

- [Local Values (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/locals) — Full reference for the `locals` block syntax and evaluation semantics.
- [Functions: merge (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/functions/merge) — Reference for the `merge` function, essential for tag management with locals.
- [Functions: cidrsubnet (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/functions/cidrsubnet) — Reference for computing IP subnet ranges from a base CIDR, commonly used with locals.

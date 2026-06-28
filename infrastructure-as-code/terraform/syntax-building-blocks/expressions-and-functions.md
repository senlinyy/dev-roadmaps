---
title: "Expressions and Functions"
description: "Learn how Terraform's built-in expressions and functions compute, transform, and query values inside your configurations."
overview: "Expressions are the calculations inside Terraform arguments. This article shows how variables, locals, functions, for expressions, conditionals, and resource references combine into values that show up in plan output."
tags: ["expressions", "functions", "hcl", "for", "terraform"]
order: 9
id: article-iac-terraform-values-expressions
aliases:
  - infrastructure-as-code/terraform/values/expressions-and-functions.md
---

## Table of Contents

1. [The First Calculation in Terraform](#the-first-calculation-in-terraform)
2. [Functions That Shape Strings, Maps, and Lists](#functions-that-shape-strings-maps-and-lists)
3. [For Expressions for Repeated Values](#for-expressions-for-repeated-values)
4. [Conditionals for Small Choices](#conditionals-for-small-choices)
5. [Resources Consuming Expression Results](#resources-consuming-expression-results)
6. [Testing and Reviewing Expressions](#testing-and-reviewing-expressions)
7. [Putting It All Together](#putting-it-all-together)

## The First Calculation in Terraform
<!-- section-summary: An expression is any Terraform value calculation, from a literal string to a function call or reference. -->

An **expression** is any Terraform syntax that produces a value. `"prod"` is an expression. `var.environment` is an expression. `lower(format("devpolaris-%s-%s", var.service_name, var.environment))` is an expression. Terraform evaluates expressions while it builds a plan.

![Expression Evaluation](/content-assets/articles/article-iac-terraform-values-expressions/expression-evaluation.png)

*The evaluation view follows values through variables, locals, functions, and resource arguments.*

The orders module needs names, tags, filtered subnet lists, and a few environment-specific settings. Writing all of those values by hand in every resource would create mistakes. Expressions let the module compute values from inputs and provider-returned attributes.

The example starts with these inputs:

```hcl
variable "service_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnets" {
  type = map(object({
    id   = string
    tier = string
    az   = string
    cidr = string
  }))
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
```

A value file supplies the concrete values:

```hcl
service_name = "Orders API"
environment  = "prod"
vpc_id       = "vpc-12345678"

subnets = {
  private-a = {
    id   = "subnet-11111111"
    tier = "private"
    az   = "us-east-1a"
    cidr = "10.40.1.0/24"
  }
  public-a = {
    id   = "subnet-22222222"
    tier = "public"
    az   = "us-east-1a"
    cidr = "10.40.101.0/24"
  }
}
```

The module can now calculate the exact strings and collections its resources need.

Expressions have types. The first two variables are strings. `var.subnets` is a map of objects. `local.private_subnet_ids` later will be a list of strings. Terraform uses these types to catch mismatches before a provider call. If a resource expects a list and an expression produces a map, the plan can fail before anything changes.

Expressions can include values known during plan and values known only after apply. A string built from variables is usually known during plan. A string built from a provider-generated endpoint may stay unknown until the provider creates the resource. Reviewers should understand which case they are seeing because unknown values reduce what can be checked before apply.

## Functions That Shape Strings, Maps, and Lists
<!-- section-summary: Terraform functions transform input values into provider-ready strings, maps, lists, and objects. -->

Terraform has built-in functions for common value work. The official [function docs](https://developer.hashicorp.com/terraform/language/functions) cover strings, collections, encoding, files, dates, IP networks, and type conversion. Functions make values provider-ready while keeping the reason visible to reviewers.

![Function Transform Path](/content-assets/articles/article-iac-terraform-values-expressions/function-transform-path.png)

*The transform path shows functions as small value shapers inside resource-ready expressions.*

**Important `merge()` detail:** Terraform's `merge()` function receives maps or objects as separate arguments, such as `merge({ service = "orders" }, { owner = "platform" })`. A list of maps needs expansion with `...`: `merge(local.tag_maps...)`. The visual above uses a list as a teaching shorthand for several map values flowing into one merge operation, while the actual HCL syntax still needs separate map arguments or the expansion operator.

In `locals.tf`, the orders module can shape a clean name first:

```hcl
locals {
  normalized_service = replace(lower(var.service_name), " ", "-")
  name_prefix        = format("devpolaris-%s-%s", local.normalized_service, var.environment)
}
```

`lower` converts letters to lowercase. `replace` swaps spaces for hyphens. `format` builds the final prefix. With `service_name = "Orders API"` and `environment = "prod"`, the prefix evaluates to `devpolaris-orders-api-prod`.

The same locals file can then add the tag map:

```hcl
locals {
  normalized_service = replace(lower(var.service_name), " ", "-")
  name_prefix        = format("devpolaris-%s-%s", local.normalized_service, var.environment)

  common_tags = merge(
    {
      service     = local.normalized_service
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )
}
```

`merge` combines the standard tag map with caller-supplied tags.

If the same key appears in more than one map passed to `merge`, the later argument wins. In the example above, `var.extra_tags` comes second, so a caller can intentionally override a standard tag during a controlled lab. Many production teams choose the opposite order for mandatory tags, or they validate inputs so callers cannot replace required ownership and environment tags.

A list of maps needs the expansion form:

```hcl
locals {
  tag_maps = [
    {
      service = local.normalized_service
    },
    {
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  ]

  common_tags = merge(local.tag_maps...)
}
```

The `...` operator expands `local.tag_maps` so `merge` receives each map as its own argument.

That local file has a clear value path. The value file supplies `service_name = "Orders API"`. The locals normalize it to `orders-api`. Resources then receive names such as `devpolaris-orders-api-prod-exports`.

Functions are useful for making infrastructure values consistent. `lower`, `replace`, and `format` can enforce naming rules. `merge` can keep tags consistent. `jsonencode` can build valid JSON policies from HCL values. `cidrsubnet` can derive network ranges for modules that own subnet math.

Resource arguments should stay readable. If an expression has several nested functions, an intermediate local name gives reviewers a named checkpoint:

```hcl
locals {
  normalized_service = replace(lower(var.service_name), " ", "-")
  name_prefix        = format("devpolaris-%s-%s", local.normalized_service, var.environment)
}
```

That version gives reviewers a shorter path than one long expression repeated inside every resource.

## For Expressions for Repeated Values
<!-- section-summary: For expressions transform collections for resources that need filtered lists or maps. -->

A **for expression** builds a new collection from an existing collection. The orders module receives public and private subnets, but the service should run only in private subnets. The module can filter the input map.

```hcl
locals {
  private_subnet_ids = [
    for subnet in var.subnets : subnet.id
    if subnet.tier == "private"
  ]
}
```

The result is a list of subnet IDs where `tier` equals `"private"`. With the value file above, the list contains only `subnet-11111111`.

For expressions can build maps too:

```hcl
locals {
  subnet_cidrs_by_name = {
    for name, subnet in var.subnets : name => subnet.cidr
  }
}
```

This creates a map such as `{ private-a = "10.40.1.0/24", public-a = "10.40.101.0/24" }`. That shape helps a later resource, output, or validation rule read values by key.

For expressions often feed `for_each`. **for_each** is Terraform's resource repetition feature for creating one resource instance per item in a map or set. A common production pattern is to filter a map before creating resources:

```hcl
locals {
  private_subnets = {
    for name, subnet in var.subnets : name => subnet
    if subnet.tier == "private"
  }
}

resource "aws_route_table_association" "private" {
  for_each = local.private_subnets

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}
```

The local creates a named map, and `for_each` consumes that map. The plan addresses stay keyed by subnet name, so review can focus on names instead of list indexes.

Inside the resource, `each.value.id` reads the selected subnet ID, and `each.key` reads the map key such as `private-a`. The example assumes the module also creates route tables keyed by the same subnet names, so `aws_route_table.private[each.key].id` selects the matching route table for that subnet.

## Conditionals for Small Choices
<!-- section-summary: Conditional expressions choose between two values, which works well for small environment differences. -->

A **conditional expression** chooses between two values:

```hcl
condition ? true_value : false_value
```

The orders module can set retention based on environment:

```hcl
locals {
  export_retention_days = var.environment == "prod" ? 365 : 7
}
```

This is reasonable because the choice is small and easy to read. Production keeps exports for a year. Non-production keeps them for a week.

Large conditionals usually belong in a map. A map is more direct to extend and review:

```hcl
locals {
  retention_by_environment = {
    dev     = 7
    staging = 30
    prod    = 365
  }

  export_retention_days = local.retention_by_environment[var.environment]
}
```

Validation on `var.environment` gives an unsupported key a clear failure message. That connects expression design back to variable design.

Conditionals should return compatible value types on both sides. A conditional that returns a string in one branch and a list in the other branch will produce confusing type errors. The consistent shape matters:

```hcl
variable "pagerduty_topic_arns" {
  type    = list(string)
  default = []
}

locals {
  alarm_actions = var.environment == "prod" ? var.pagerduty_topic_arns : []
}
```

Both branches return a list of strings. The production branch supplies real topic ARNs from a list input such as `var.pagerduty_topic_arns`, and the non-production branch supplies an empty list.

## Resources Consuming Expression Results
<!-- section-summary: Expressions matter because resources and outputs consume their final evaluated values. -->

The resource blocks now consume the expression results:

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
      days = local.export_retention_days
    }
  }
}

resource "aws_security_group" "orders_app" {
  name   = "${local.name_prefix}-app"
  vpc_id = var.vpc_id

  tags = local.common_tags
}
```

Outputs can publish calculated values too:

```hcl
output "private_subnet_ids" {
  description = "Private subnet IDs selected for the orders API."
  value       = local.private_subnet_ids
}
```

This shows the full path. The value file supplies raw inputs. Functions and for expressions shape them in locals. Resources and outputs consume the final values. The plan shows what will reach the provider.

The same expression results can later feed module inputs. That is why the expression habit matters before the module lesson: if a root module can calculate clean names, tags, lists, and maps, it can pass those values into reusable code without scattering string cleanup across the repository.

Outputs can expose calculated review values:

```hcl
output "selected_private_subnet_ids" {
  description = "Private subnet IDs selected from the supplied subnet map."
  value       = local.private_subnet_ids
}
```

That output helps a human or script verify that the filter selected the expected subnets.

## Testing and Reviewing Expressions
<!-- section-summary: terraform console and plan output help test expressions before they affect real infrastructure. -->

`terraform console` can test expressions in a working directory:

```bash
terraform console
```

This command opens an interactive expression prompt for the current Terraform working directory. It is useful for checking how functions evaluate before those expressions appear in a plan.

Inside the console, you can try expressions:

```hcl
lower("Orders API")
replace(lower("Orders API"), " ", "-")
merge({ managed_by = "terraform" }, { owner = "orders-team" })
```

The console prints the evaluated values:

```console
"orders api"
"orders-api"
{
  "managed_by" = "terraform"
  "owner" = "orders-team"
}
```

For expressions that depend on variables, supply a value file during planning and inspect the plan. The plan is the review surface that matters because it shows the evaluated result inside resource arguments.

Expressions should stay readable. If a line has several nested functions, give part of it a local name. If a for expression filters and transforms many fields at once, consider splitting it into two locals with clear names. Terraform code is reviewed by humans before it changes infrastructure.

The console can load variable values:

```bash
terraform console -var-file=prod.tfvars
```

The `-var-file` flag loads the same values the production plan would use. That keeps the console test close to the real plan instead of testing expressions with empty or default values.

The console can then test expressions directly:

```hcl
local.normalized_service
local.private_subnet_ids
local.retention_by_environment[var.environment]
```

```console
"orders-api"
[
  "subnet-11111111"
]
365
```

The console gives fast feedback, and the plan gives final review. The console tells you what an expression evaluates to in the current context. The plan tells you how that result affects provider resources, module calls, and outputs.

If Terraform reports a type error, simplify the expression. The repair path is to check the input type, evaluate intermediate locals, and make both sides of any conditional return the same shape. Small named locals give each error a narrower place to inspect.

## Putting It All Together
<!-- section-summary: Expressions let Terraform compute provider-ready values from variables, locals, resources, outputs, and functions. -->

Expressions are the calculations inside Terraform. They read variables, locals, resources, and outputs. Functions transform values. For expressions reshape collections. Conditionals handle small choices. Later articles add data sources and reusable modules to the same expression pattern.

![Expressions Summary](/content-assets/articles/article-iac-terraform-values-expressions/expressions-summary.png)

*The summary board gathers the expression patterns that keep names, tags, collections, and choices reviewable.*

The orders example used expressions to normalize a service name, build standard tags, filter private subnets, choose retention days, feed resources, and publish outputs. Every expression had a consumer, so the plan could show the final result.

Expressions should make values accurate and consistent. They should stay simple enough that a reviewer can trace the path from supplied input to planned provider argument.

---

**References**

- [Terraform expressions](https://developer.hashicorp.com/terraform/language/expressions) - HashiCorp explains expression syntax and how Terraform evaluates values.
- [Terraform functions](https://developer.hashicorp.com/terraform/language/functions) - HashiCorp documents built-in functions for strings, collections, encoding, filesystem values, and type conversion.
- [merge function](https://developer.hashicorp.com/terraform/language/functions/merge) - HashiCorp documents `merge()` arguments, key precedence, and the expansion-symbol pattern for lists of maps.
- [For expressions](https://developer.hashicorp.com/terraform/language/expressions/for) - HashiCorp documents transforming lists, sets, tuples, maps, and objects.
- [Conditional expressions](https://developer.hashicorp.com/terraform/language/expressions/conditionals) - HashiCorp documents conditional syntax and result-type behavior.
- [Splat expressions](https://developer.hashicorp.com/terraform/language/expressions/splat) - HashiCorp documents collection projection patterns related to list-shaped value work.
- [terraform console](https://developer.hashicorp.com/terraform/cli/commands/console) - HashiCorp documents the interactive expression console used for testing values.

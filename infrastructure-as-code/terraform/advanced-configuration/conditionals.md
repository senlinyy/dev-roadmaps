---
title: "Conditionals"
description: "Control which resources Terraform creates and what values they receive based on input variables, environment settings, and computed conditions."
overview: "Conditionals let your Terraform configuration adapt to different situations without duplicating code. This article covers the ternary expression, count-based resource toggling, for_each filtering, and how to write conditions that make configurations flexible without making them unreadable."
tags: ["conditionals", "count", "for_each", "ternary", "terraform"]
order: 2
id: article-iac-terraform-advanced-conditionals
---

## Table of Contents

1. [Why Conditionals Matter](#why-conditionals-matter)
2. [The Ternary Expression](#the-ternary-expression)
3. [Toggling a Resource On or Off with count](#toggling-a-resource-on-or-off-with-count)
4. [Referencing a Resource That Might Not Exist](#referencing-a-resource-that-might-not-exist)
5. [Conditional Attribute Values](#conditional-attribute-values)
6. [Filtering with for_each](#filtering-with-for_each)
7. [Nested Conditionals and When to Avoid Them](#nested-conditionals-and-when-to-avoid-them)
8. [Conditions That Depend on Unknown Values](#conditions-that-depend-on-unknown-values)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Conditionals Matter

Infrastructure requirements differ between environments in ways that go beyond just size and count. A development environment might not need a CloudWatch alarm or a DDoS protection plan. A production environment does. A staging environment might need a read replica for the database. Development does not.

Without conditionals, you have two options: duplicate the configuration (one version with the alarm, one without), or always create the alarm even in environments where it is unnecessary. Both are bad. Duplication leads to drift. Always creating everything wastes money and creates clutter in environments where the feature is not needed.

Conditionals let you write one configuration that creates different sets of resources based on input values. The condition is declared in code, visible in code review, and deterministic — the same inputs always produce the same infrastructure.

## The Ternary Expression

The foundation of all conditionals in Terraform is the ternary expression. You have already seen it in examples throughout the previous articles. The syntax is:

![Conditional expressions choose between true and false values before the final resource argument is built.](/content-assets/articles/article-iac-terraform-advanced-conditionals/conditional-evaluation.png)

```
condition ? value_if_true : value_if_false
```

The condition is any expression that evaluates to `true` or `false`. The two result branches should produce values of the same type, or values Terraform can safely convert to a common type. If one branch returns a number and the other returns a string, Terraform may convert both to strings, which is usually less clear than writing the intended type explicitly.

Simple examples:

```hcl
locals {
  instance_type   = var.environment == "prod" ? "t3.medium" : "t3.micro"
  min_instances   = var.environment == "prod" ? 2 : 1
  enable_deletion_protection = var.environment == "prod"
}
```

The last local, `enable_deletion_protection`, does not need a ternary at all — the condition itself (`var.environment == "prod"`) is already a boolean, so you can assign it directly.

Comparison operators you can use in conditions:
- `==` (equal to)
- `!=` (not equal to)
- `>`, `<`, `>=`, `<=` (numeric comparisons)
- `&&` (and — both sides must be true)
- `||` (or — at least one side must be true)
- `!` (not — inverts a boolean)

```hcl
locals {
  is_prod_or_staging = var.environment == "prod" || var.environment == "staging"
  needs_monitoring   = var.environment == "prod" && var.enable_monitoring
}
```

## Toggling a Resource On or Off with count

The most common use of conditionals in Terraform is controlling whether a resource is created at all. You do this by combining `count` with a ternary expression:

```hcl
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  count = var.environment == "prod" ? 1 : 0

  alarm_name          = "${var.project}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"

  alarm_actions = [aws_sns_topic.alerts[0].arn]
}
```

When `var.environment` is `"prod"`, `count` is `1` and Terraform creates the alarm. When it is anything else, `count` is `0` and Terraform creates nothing. The resource block exists in the code, but the actual cloud resource does not exist in non-production environments.

This pattern works for any boolean condition. You can check a feature flag variable (`var.enable_waf ? 1 : 0`), a numeric threshold (`var.instance_count > 0 ? 1 : 0`), or any expression that returns a boolean.

You cannot use a boolean variable directly for `count`. The `count` argument expects a whole number, so the conditional expression must convert your boolean decision into either `1` or `0`:

```hcl
variable "enable_waf" {
  type    = bool
  default = false
}

resource "aws_wafv2_web_acl_association" "main" {
  count        = var.enable_waf ? 1 : 0
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main[0].arn
}
```

## Referencing a Resource That Might Not Exist

When you create a resource conditionally with `count`, its Terraform address becomes a list — either a list with one element (`[0]` when `count` is 1) or an empty list (`[]` when `count` is 0). This affects how other resources reference it.

If you try to reference a conditional resource with `aws_sns_topic.alerts.arn`, Terraform reports an error — that syntax expects a single resource, but a `count` resource is always a list. You must use the index syntax:

```hcl
alarm_actions = [aws_sns_topic.alerts[0].arn]
```

But this will fail if `count` is `0` — there is no element at index `0` in an empty list. To safely reference a conditional resource from another conditional resource, both resources need matching conditions:

```hcl
resource "aws_sns_topic" "alerts" {
  count = var.enable_alerts ? 1 : 0
  name  = "${var.project}-alerts"
}

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  count = var.enable_alerts ? 1 : 0

  alarm_name    = "${var.project}-high-cpu"
  alarm_actions = [aws_sns_topic.alerts[0].arn]
}
```

Both use the same condition (`var.enable_alerts`). When alerts are disabled, both resources have `count = 0` and neither is created. When alerts are enabled, both have `count = 1`, and the alarm can safely reference the SNS topic at index `[0]`.

An alternative to the `[0].attribute` pattern is the `one()` function, introduced in Terraform 1.0. It takes a list of zero or one elements and returns either the single element or `null`:

```hcl
locals {
  alert_topic_arn = one(aws_sns_topic.alerts[*].arn)
}
```

If `aws_sns_topic.alerts` has `count = 1`, `one()` returns the ARN. If `count = 0`, it returns `null`. This is cleaner than `aws_sns_topic.alerts[0].arn` because `null` is a safe value that Terraform handles gracefully, while accessing an empty list at index `[0]` causes an error.

## Conditional Attribute Values

Not all conditionals toggle a whole resource. Often you need to change a specific attribute based on a condition while keeping the rest of the resource the same.

![null omits an argument, while an empty string is still sent as a real value to the provider.](/content-assets/articles/article-iac-terraform-advanced-conditionals/null-vs-omitted-boundary.png)

A database resource that uses multi-AZ replication in production but not in development:

```hcl
resource "aws_db_instance" "main" {
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = var.environment == "prod" ? "db.t3.large" : "db.t3.micro"
  allocated_storage = var.environment == "prod" ? 100 : 20
  multi_az          = var.environment == "prod"

  deletion_protection = var.environment == "prod"
  skip_final_snapshot = var.environment != "prod"

  username = var.db_username
  password = var.db_password
}
```

Each attribute independently checks the environment. This is readable as long as there are not too many conditions. When many attributes differ by environment, a `locals` block that computes the environment-specific values keeps the resource block clean:

```hcl
locals {
  db_config = {
    dev = {
      instance_class    = "db.t3.micro"
      allocated_storage = 20
      multi_az          = false
    }
    prod = {
      instance_class    = "db.t3.large"
      allocated_storage = 100
      multi_az          = true
    }
  }

  db = local.db_config[var.environment]
}

resource "aws_db_instance" "main" {
  engine            = "postgres"
  instance_class    = local.db.instance_class
  allocated_storage = local.db.allocated_storage
  multi_az          = local.db.multi_az
  username          = var.db_username
  password          = var.db_password
}
```

The `local.db_config[var.environment]` lookup retrieves the settings for the current environment. The resource block itself becomes simple and free of conditionals. Adding a new environment (like `staging`) means adding a new key to `local.db_config`.

## Filtering with for_each

When you have a collection of items and only some of them need a particular resource, use a `for` expression with an `if` clause to filter the collection before passing it to `for_each`.

Suppose you have a map of team members, and only some of them should have admin IAM policies:

```hcl
variable "team_members" {
  type = map(object({
    email       = string
    is_admin    = bool
  }))
}

resource "aws_iam_user" "members" {
  for_each = var.team_members
  name     = each.key
}

resource "aws_iam_user_policy_attachment" "admin" {
  for_each = {
    for name, member in var.team_members : name => member
    if member.is_admin
  }

  user       = aws_iam_user.members[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
```

The `for_each` for the admin policy attachment filters to only the members where `is_admin` is true. Terraform creates one policy attachment per admin user and no attachment for non-admin users.

This pattern is cleaner than a boolean `count` approach when you have a collection with mixed properties. The filtering happens close to the resource that needs it, and the condition is visible in the `for_each` expression.

## Nested Conditionals and When to Avoid Them

Conditional expressions can be nested: the value in one branch can itself be another conditional. This lets you express three-way or four-way decisions:

```hcl
locals {
  instance_type = (
    var.environment == "prod"    ? "t3.large"  :
    var.environment == "staging" ? "t3.small"  :
    "t3.micro"
  )
}
```

This is a three-way decision: `t3.large` for production, `t3.small` for staging, and `t3.micro` for everything else (including development). The nested ternary is formatted here with each branch on its own line and consistent indentation to keep it readable.

Deeper nesting gets confusing quickly. If you find yourself with four or five nested ternary expressions, switch to a map lookup:

```hcl
locals {
  instance_types = {
    prod    = "t3.large"
    staging = "t3.small"
    dev     = "t3.micro"
  }
  instance_type = lookup(local.instance_types, var.environment, "t3.micro")
}
```

The map version is more readable, easier to extend (just add a new key), and produces a cleaner error message if an unknown environment is provided. The `lookup` default value of `"t3.micro"` handles any environment not in the map without an error.

Reserve nested ternaries for two-level decisions and use maps for three or more options.

## Conditions That Depend on Unknown Values

Terraform evaluates conditions during the plan phase, before making any API calls. This means conditions can only reference values that are known at plan time. Values from the cloud provider that are only assigned when a resource is created — like an auto-assigned IP address, an ARN generated by AWS, or a randomly generated password — are "unknown" during the plan phase.

If your condition depends on an unknown value, Terraform cannot evaluate it during plan and reports an error:

```hcl
resource "aws_security_group" "conditional" {
  count = length(aws_instance.app.private_ip) > 0 ? 1 : 0
}
```

`aws_instance.app.private_ip` is not known until the instance is created, so this condition cannot be evaluated during plan. Terraform will reject this with an error about using a known-only-after-apply value in a `count` expression.

The fix is to restructure the condition around known values — values that come from variables or data sources that can be evaluated before apply, not from the attributes of resources that are being created:

```hcl
resource "aws_security_group" "conditional" {
  count = var.environment == "prod" ? 1 : 0
}
```

`var.environment` is always known at plan time. Conditions based on input variables always work. If you find yourself writing a condition that depends on a resource attribute, reconsider whether the condition is expressing the right thing — what you actually want to know is usually something about the inputs (the environment, a feature flag, a size setting), not the runtime attributes of another resource.

## Putting It All Together

Conditionals give a single Terraform configuration the ability to describe many different real states. The same code creates a lightweight dev environment (one small instance, no alarms, no multi-AZ database) and a production environment (multiple larger instances, CloudWatch alarms with SNS notifications, multi-AZ database with deletion protection).

The ternary expression is the basic building block. `count` with a ternary toggles whole resources. Ternary expressions in attribute positions change individual settings. `for_each` with a filtered `for` expression selects subsets of a collection. Map lookups replace deeply nested ternaries with clean, extensible tables.

Each condition in the configuration is a documented design decision: "this alarm only exists in production," "this database is multi-AZ in production and single-AZ elsewhere," "these team members have admin policies." Future readers can understand the intent without needing to read external documentation.

## What's Next

Loops create multiple resources. Conditionals decide which resources exist. The final advanced configuration topic combines both techniques: how to deploy infrastructure changes — especially changes that would normally require a brief outage — in a way that keeps your application running throughout the update.


![Conditionals summary: choose values, toggle optional resources, handle missing outputs, and avoid tangled logic.](/content-assets/articles/article-iac-terraform-advanced-conditionals/conditionals-summary.png)

---

**References**

- [Conditional Expressions (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/conditionals) — Full reference for the ternary expression, type constraints, and evaluation rules.
- [count Meta-Argument (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/meta-arguments/count) — Reference for using `count` as a resource toggle.
- [The one() Function (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/functions/one) — Reference for safely extracting a single value from a zero-or-one-element list.

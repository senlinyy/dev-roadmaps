---
title: "Conditionals"
description: "Conditional expressions decide which resources Terraform creates and what values they receive based on input variables, environment settings, and computed conditions."
overview: "Conditionals let your Terraform configuration adapt to different situations without duplicating code. This article covers the ternary expression, count-based resource toggling, for_each filtering, and how to write conditions that make configurations flexible without making them unreadable."
tags: ["conditionals", "count", "for_each", "ternary", "terraform"]
order: 3
id: article-iac-terraform-advanced-conditionals
---

## Table of Contents

1. [One Optional Setting](#one-optional-setting)
2. [True and False Expressions](#true-and-false-expressions)
3. [Using null to Omit a Setting](#using-null-to-omit-a-setting)
4. [Creating an Optional Resource](#creating-an-optional-resource)
5. [Validating the Inputs](#validating-the-inputs)
6. [Filtering a Collection](#filtering-a-collection)
7. [Keeping Logic Untangled](#keeping-logic-untangled)
8. [Putting It All Together](#putting-it-all-together)

The loops article focused on repetition. This article focuses on choices. A Terraform conditional can choose a value for one argument, omit an optional setting, create zero or one resources, or filter a collection before `for_each` creates instances.

The safe order is important. First change values while the resource address stays the same. Then change resource shape for modules that truly need a different shape. Shape changes affect state addresses, so they need the same careful review you used for `count` and `for_each` in the loops article.

## One Optional Setting
<!-- section-summary: A conditional starts as one small choice, such as using a larger log retention period in production than in development. -->

Imagine a small billing service that writes application logs to CloudWatch. In development, the team only needs logs for a week because the environment changes often. In production, the same service needs ninety days of logs because incidents, audits, and customer questions often arrive later.

The resource is the same in both environments. Only one setting changes:

```hcl
variable "environment" {
  type    = string
  default = "dev"
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/apps/billing"
  retention_in_days = var.environment == "prod" ? 90 : 7
}
```

The expression after `retention_in_days` is a **conditional expression**. Terraform evaluates the part before the question mark first. If `var.environment == "prod"` is true, it uses `90`. If the expression is false, it uses `7`.

This small example is the best place to start because the resource does not change shape yet. The log group always exists. Terraform only chooses one value for one argument, and the plan will show the selected retention period before anything is applied.

A development plan shows the evaluated value, not the expression:

```bash
terraform plan -var='environment=dev'
```

The `-var` flag supplies one input value directly on the command line for this small comparison. In team workflows, the same value usually comes from a checked-in environment file or CI variable.

```console
  # aws_cloudwatch_log_group.app will be created
  + resource "aws_cloudwatch_log_group" "app" {
      + name              = "/apps/billing"
      + retention_in_days = 7
    }
```

The important line is `retention_in_days = 7`. Terraform has already evaluated the conditional expression before it prints the planned resource.

A production plan keeps the same resource address and gives the argument a different value:

```bash
terraform plan -var='environment=prod'
```

```console
      + retention_in_days = 90
```

The production run shows the same argument with the production value. That is the review point: the condition changes the value sent into the resource, not the resource address.

That under-the-hood detail matters for review. Terraform does not keep both branches in the planned resource. It evaluates the condition during planning, chooses one result, and sends the chosen value into the resource graph.

## True and False Expressions
<!-- section-summary: Terraform conditionals choose between two values after evaluating a boolean expression. -->

A **boolean expression** is any Terraform expression that produces `true` or `false`. Equality checks, number comparisons, and feature flags are common examples. Terraform uses those results to choose the value on the true side or the false side.

![Conditional Evaluation](/content-assets/articles/article-iac-terraform-advanced-conditionals/conditional-evaluation.png)

*The evaluation path shows how Terraform chooses one branch, then still expects the chosen value to fit the argument type.*

Here are a few choices for the same billing service:

```hcl
locals {
  is_prod               = var.environment == "prod"
  log_retention_days    = local.is_prod ? 90 : 7
  min_instance_count    = local.is_prod ? 3 : 1
  deletion_protection   = local.is_prod
  alarm_evaluation_time = local.is_prod ? 300 : 60
}
```

`local.deletion_protection` uses the boolean directly because it already has the right type. A ternary like `local.is_prod ? true : false` would add noise without changing the result.

Terraform expects both result values in a conditional to have compatible types. `local.is_prod ? 90 : 7` is clear because both sides are numbers. `local.is_prod ? 90 : "seven"` asks Terraform to reconcile a number and a string, which can produce confusing type conversion. Production modules should keep the two branches the same kind of value.

For optional object settings, make the type explicit so Terraform and the reader agree about the shape:

```hcl
variable "alarm_overrides" {
  type = object({
    evaluation_periods = optional(number)
    threshold          = optional(number)
  })
  default = {}
}

locals {
  alarm_threshold = var.alarm_overrides.threshold != null ? var.alarm_overrides.threshold : 0
}
```

This is safer than mixing an object on one side and a string or empty map on the other side. Terraform's type system tries to find one final type for the expression before it can build the plan. Matching branch types keep the plan predictable.

## Using null to Omit a Setting
<!-- section-summary: null is useful for optional provider arguments that should be left out instead of sent with an empty value. -->

Now the billing service gets a simple production-only alarm. In development, the team still wants the log group, but they do not want an alarm action wired to a paging topic. A common first attempt is to use an empty string for the missing ARN.

![Null Vs Omitted Boundary](/content-assets/articles/article-iac-terraform-advanced-conditionals/null-vs-omitted-boundary.png)

*`null` is safest for provider schemas that treat an omitted argument differently from an explicit value, and this boundary view shows that handoff.*

```hcl
variable "pager_topic_arn" {
  type    = string
  default = null
}

resource "aws_cloudwatch_metric_alarm" "errors" {
  alarm_name          = "billing-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "Billing/App"
  period              = 60
  statistic           = "Sum"
  threshold           = 0

  alarm_actions = var.environment == "prod" && var.pager_topic_arn != null ? [var.pager_topic_arn] : []
}
```

An empty list works for `alarm_actions` because the argument expects a list. For single optional arguments, Terraform often uses **null** to mean "leave this unset". The provider receives no value for that argument, which is different from sending an empty string or a made-up placeholder.

```hcl
variable "kms_key_id" {
  type    = string
  default = null
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/apps/billing"
  retention_in_days = local.log_retention_days
  kms_key_id        = var.environment == "prod" ? var.kms_key_id : null
}
```

This says production may use a customer-managed KMS key, while development leaves the provider default alone. The key detail is that `null` keeps the configuration honest. Terraform can omit the argument instead of smuggling an empty value into the provider call.

The plan usually makes this visible. If `kms_key_id` is `null`, the argument does not appear as a configured value. If someone uses an empty string instead, the provider may receive an empty string and reject it with a provider-specific validation error. That is a common production mistake because empty strings look harmless in variables, but many provider APIs treat them as real values.

`nullable = false` fits inputs where callers must always pass a real value:

```hcl
variable "service_name" {
  type     = string
  nullable = false
}
```

For this log group key, `null` is part of the design because development intentionally omits the setting. For a service name, `null` would hide a broken caller, so the variable should reject it.

## Creating an Optional Resource
<!-- section-summary: count can turn one optional resource on or off, but every reference to that resource must handle the zero-instance case. -->

The previous section used an existing topic ARN as an input. Now the module will create its own pager topic. The topic only exists for production because development does not page anyone. This is where a value conditional turns into a resource-shape conditional.

```hcl
resource "aws_sns_topic" "pager" {
  count = var.environment == "prod" ? 1 : 0
  name  = "billing-prod-pager"
}

resource "aws_cloudwatch_metric_alarm" "errors" {
  count = var.environment == "prod" ? 1 : 0

  alarm_name          = "billing-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "Billing/App"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_actions       = [aws_sns_topic.pager[0].arn]
}
```

`count` expects a number, so the conditional returns `1` or `0`. For production, Terraform creates one topic and one alarm. For development, Terraform creates zero topics and zero alarms.

The reference uses `[0]` because a counted resource is a list of instances. This is safe here because both resources use the same condition. Terraform never creates the alarm without also creating the topic it reads.

The development plan shows the shape clearly:

```console
Plan: 0 to add, 0 to change, 0 to destroy.
```

The production plan shows one instance at each counted address:

```console
  # aws_sns_topic.pager[0] will be created
  + resource "aws_sns_topic" "pager" {
      + name = "billing-prod-pager"
    }

  # aws_cloudwatch_metric_alarm.errors[0] will be created
  + resource "aws_cloudwatch_metric_alarm" "errors" {
      + alarm_actions = (known after apply)
    }
```

The address change is the part beginners often miss. Adding `count` changes the resource address from `aws_sns_topic.pager` to `aws_sns_topic.pager[0]`. If an existing production resource already lives in state at the uncounted address, the team should use a `moved` block or a state move during the refactor so Terraform does not plan to delete and recreate a working topic only because the address changed.

After apply, the state list uses those counted addresses too:

```bash
terraform state list
```

```console
aws_cloudwatch_metric_alarm.errors[0]
aws_sns_topic.pager[0]
```

That output is the state identity risk in plain form. A value conditional changed only `retention_in_days`. A resource conditional changed the address shape Terraform stores.

For a single optional output, Terraform's `one()` function can make the zero-or-one shape clearer:

```hcl
output "pager_topic_arn" {
  value = one(aws_sns_topic.pager[*].arn)
}
```

If the topic exists, the output is the ARN. If the topic has zero instances, the output is `null`. That gives callers a clean optional value instead of asking them to guess whether index zero exists.

One common mistake is to reference `aws_sns_topic.pager[0].arn` from an output or another resource that still exists for the disabled case. Terraform then has no instance at index zero. The reference should stay inside a resource that uses the same condition, or the zero-or-one list can be converted with `one()` so the caller handles `null`.

## Validating the Inputs
<!-- section-summary: Validation keeps conditionals small by rejecting impossible combinations before the plan reaches provider calls. -->

The billing module has a small problem now. Production needs a KMS key, but the variable default is `null`. Without validation, someone can run a production plan with no key and only discover the mistake during review or after a provider error.

Terraform variable validation lets the module reject that combination early:

```hcl
variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "kms_key_id" {
  type    = string
  default = null

  validation {
    condition     = var.environment != "prod" || var.kms_key_id != null
    error_message = "prod requires kms_key_id so logs are encrypted with the production key."
  }
}
```

The second condition reads as a rule for the module. Non-production environments may omit the key. Production must pass it. The important part is that the rule lives beside the input, so a caller gets a direct error before Terraform builds a surprising plan.

Validation also reduces tangled resource logic. Instead of checking for every bad combination inside every resource, the module rejects invalid inputs once and lets the resource blocks stay simple.

The failure is direct:

```bash
terraform plan -var='environment=prod'
```

This command deliberately omits `kms_key_id` while setting the environment to production, so validation should stop the plan before resource changes are proposed.

```console
Error: Invalid value for variable

prod requires kms_key_id so logs are encrypted with the production key.
```

The output names the variable error and prints the custom validation message. That is the useful failure: the caller learns what production requires before Terraform reaches provider APIs.

That kind of failure is useful because it names the business rule before a late provider error appears. In production modules, validation fits environment names, mutually required inputs, allowed instance sizes, retention limits, and any setting where a bad value would create a risky plan.

This example uses validation that compares two variables. It requires Terraform 1.9 or later, because earlier Terraform versions allowed variable validation to refer only to the variable being validated. This is often called cross-object validation because the rule can compare the current variable with another variable, local value, data source, or resource attribute that Terraform can evaluate at the right time.

The validation feature should match the thing you are protecting. Variable validation fits caller input rules such as "prod requires a KMS key." A resource precondition fits a rule the resource needs before Terraform sends the provider request. A postcondition fits a rule that should be true after a resource or data source is evaluated. A check block fits ongoing assertions that should report problems without necessarily blocking every plan. That choice keeps conditionals small because each rule lives beside the object it protects.

If you maintain older Terraform projects, put the related settings inside one object variable, use a resource precondition, or enforce the combination in Terraform tests or policy-as-code. The important teaching point is the same: reject unsafe input combinations before provider calls create a confusing plan.

## Filtering a Collection
<!-- section-summary: for_each filtering handles collection items that need an extra resource without many separate booleans. -->

The billing service grows from one team to three teams. Only the production owners should receive the pager topic policy. A boolean `count` works for one optional object, but it gets awkward for the question "which people in this map need the extra thing?"

```hcl
variable "team_members" {
  type = map(object({
    email      = string
    pages_prod = bool
  }))
}

resource "aws_iam_user" "member" {
  for_each = var.team_members
  name     = each.key
}

resource "aws_iam_user_policy_attachment" "pager_publish" {
  for_each = {
    for name, member in var.team_members : name => member
    if member.pages_prod
  }

  user       = aws_iam_user.member[each.key].name
  policy_arn = aws_iam_policy.publish_to_pager.arn
}
```

The `for` expression builds a smaller map containing only members where `pages_prod` is true. `for_each` then creates one attachment for each selected member. The stable map keys keep Terraform's state addresses readable, such as `aws_iam_user_policy_attachment.pager_publish["alice"]`.

This is a conditional too, but it works at the collection level. The rule lives next to the resource that needs it, and Terraform still has stable identities for every selected item.

A plan for two selected members produces addresses that show the selected keys:

```console
  # aws_iam_user_policy_attachment.pager_publish["alice"] will be created
  # aws_iam_user_policy_attachment.pager_publish["mira"] will be created
```

If `mira` turns `pages_prod` off later, Terraform removes only `aws_iam_user_policy_attachment.pager_publish["mira"]`. Alice's address stays the same. That is why `for_each` filtering usually fits optional resources attached to named items.

The same identity rule still applies. If the key changes from `mira` to `miriam`, Terraform treats that as one address removed and one address added unless the refactor includes a `moved` block. Stable keys should hold identity, while display names, email addresses, and team labels belong in the value object.

## Keeping Logic Untangled
<!-- section-summary: Large conditional expressions should usually move into locals, maps, or validation rules so resource blocks stay readable. -->

Small conditionals are useful. Deep nested conditionals are hard to review because the reader has to track several branches at once. Production modules usually stay clearer with branching logic moved into named locals.

Instead of stacking environment checks inside the resource:

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.environment == "prod" ? "t3.large" : var.environment == "staging" ? "t3.small" : "t3.micro"
}
```

A map can name the allowed choices:

```hcl
locals {
  instance_type_by_environment = {
    dev     = "t3.micro"
    staging = "t3.small"
    prod    = "t3.large"
  }
}

resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = local.instance_type_by_environment[var.environment]
}
```

The validation from the previous section makes this lookup safe because unknown environment names are rejected before the lookup happens. The resource block now shows the real infrastructure setting, while the environment table shows the business decision.

There is another boundary to respect. `count` and `for_each` keys must be known during planning because Terraform needs to know how many graph nodes to create. Conditions based on variables are fine. Conditions based on values that only exist after apply, such as a generated private IP or newly assigned ARN, cannot decide resource count or keys.

For example, this shape will fail because the key depends on an ID that AWS returns after creation:

```hcl
resource "aws_cloudwatch_metric_alarm" "by_instance" {
  for_each = toset(aws_instance.app[*].id)

  alarm_name = "cpu-${each.key}"
}
```

Terraform needs the `for_each` keys before it can create the alarm instances, but the instance IDs are unknown until apply. Caller-provided keys, such as a map of instance names, define the graph shape; provider-assigned IDs can still be read inside the resource body after that shape is already known.

## Putting It All Together
<!-- section-summary: Good Terraform conditionals start small, validate inputs, use null for omission, and keep resource identity predictable. -->

The billing example started with one optional setting: production keeps logs longer than development. Then the same idea grew naturally. A boolean expression chose values, `null` omitted an optional argument, `count` created a production-only alarm, validation rejected bad input combinations, and `for_each` filtered a collection of people.

![Conditionals Summary](/content-assets/articles/article-iac-terraform-advanced-conditionals/conditionals-summary.png)

*The summary board collects the safe uses of conditionals: small choices, stable types, clear defaults, and reviewable plans.*

That is the usual path for production Terraform. The smallest condition should solve the real difference. Validation protects modules from bad caller combinations. Stable keys protect collection resources. Repeated business decisions belong in locals so the resource blocks remain readable during code review.

A practical review runbook for conditional-heavy modules is short:

```bash
terraform fmt -check
terraform validate
terraform plan -var-file=dev.tfvars
terraform plan -var-file=prod.tfvars
```

`fmt -check` reports files that need formatting, which makes formatting drift visible in CI without rewriting files. `validate` checks Terraform syntax and provider schema shape before any plan review. Each `-var-file` loads one environment's inputs, so the reviewer can compare development and production behavior without guessing which values Terraform used.

The two plans deserve comparison across resource addresses, action counts, omitted `null` arguments, and any replacement marker. The condition should explain a real environment difference. If the plan changes resource identity, either make that address change intentional with a `moved` block or simplify the expression before the module reaches production.

---

**References**

- [Terraform conditional expressions](https://developer.hashicorp.com/terraform/language/expressions/conditionals)
- [Terraform input variables, validation, and nullable inputs](https://developer.hashicorp.com/terraform/language/block/variable)
- [Terraform custom conditions and validation choices](https://developer.hashicorp.com/terraform/language/validate)
- [Terraform type constraints and optional attributes](https://developer.hashicorp.com/terraform/language/expressions/type-constraints)
- [Terraform count meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/count)
- [Terraform for_each meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [Terraform one function](https://developer.hashicorp.com/terraform/language/functions/one)
- [Terraform moved blocks for refactoring](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)

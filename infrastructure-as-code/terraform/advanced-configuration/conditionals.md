---
title: "Conditionals"
description: "Conditional expressions decide which values and collections Terraform sees based on boolean conditions."
overview: "Terraform conditionals are value-producing expressions rather than imperative if statements. This article follows that model through typed choices, null omission, optional resources, validation, filtered collections, and readable policy design."
tags: ["conditionals", "count", "for_each", "ternary", "terraform"]
order: 3
id: article-iac-terraform-advanced-conditionals
---

## Table of Contents

1. [What Does a Terraform Conditional Actually Do?](#what-does-a-terraform-conditional-actually-do)
2. [How Do Conditions Choose Compatible Values?](#how-do-conditions-choose-compatible-values)
3. [How Does null Omit an Optional Value?](#how-does-null-omit-an-optional-value)
4. [How Does a Condition Control Resource Existence?](#how-does-a-condition-control-resource-existence)
5. [How Do Conditions Validate Requirements?](#how-do-conditions-validate-requirements)
6. [How Does Filtering Choose Named Resources?](#how-does-filtering-choose-named-resources)
7. [How Do You Keep Conditional Logic Readable?](#how-do-you-keep-conditional-logic-readable)
8. [How Do the Conditional Patterns Fit Together?](#how-do-the-conditional-patterns-fit-together)
9. [Check Your Answers](#check-your-answers)

Terraform conditionals are easier to understand when you stop treating them as procedural `if` statements. They do not decide which lines run. They produce values that arguments, `count`, `for_each`, or validation rules consume.

Terraform resource arguments already receive values from expressions:

```hcl
resource "aws_instance" "web" {
  instance_type = "t3.micro"
}
```

The literal expression produces one string. A variable reference, function call, or conditional can produce the same argument value:

```hcl
instance_type = var.instance_type
instance_type = lookup(var.instance_types, var.environment)
instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"
```

In every case Terraform asks, “what value should `instance_type` have?” The conditional syntax is:

```hcl
condition ? value_if_true : value_if_false
```

For production, `var.environment == "prod"` is true and the complete expression becomes `"t3.large"`. For development it becomes `"t3.micro"`. Terraform then places the selected string into the resource graph.

Keep these questions in view as you work through the lesson:

1. **What Does a Terraform Conditional Actually Do?**
2. **How Do Conditions Choose Compatible Values?**
3. **How Does `null` Omit an Optional Value?**
4. **How Does a Condition Control Resource Existence?**
5. **How Do Conditions Validate Requirements?**
6. **How Does Filtering Choose Named Resources?**
7. **How Do You Keep Conditional Logic Readable?**
8. **How Do the Conditional Patterns Fit Together?**

## What Does a Terraform Conditional Actually Do?
<!-- section-summary: A conditional evaluates one boolean and produces one of two values; another Terraform construct determines what that result means. -->

The condition itself must produce a boolean. Typical forms include:

```hcl
var.environment == "prod"
var.instance_count > 0
var.region != ""
var.enable_monitoring

var.environment == "prod" && var.enable_monitoring
var.environment == "dev" || var.environment == "staging"
!var.enable_monitoring
```

`&&`, `||`, and `!` combine or negate boolean values. The ternary still has only one job: select one result after evaluating that boolean.

This distinction prevents duplicated resources when only one setting varies:

```hcl
resource "aws_instance" "web" {
  ami = var.ami

  instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"
}
```

The instance always exists at `aws_instance.web`. Only its selected type changes. Keep the resource unconditional when the real choice concerns one of its values.

The plan shows the evaluated result rather than preserving both branches as future runtime choices. A production plan contains `instance_type = "t3.large"`; a development plan contains `"t3.micro"`. This is why the condition and all values needed to choose graph shape must be available at the appropriate planning phase.

The resource example also illustrates the smallest safe change. Duplicating one instance block per environment creates separate addresses and repeated settings. Keeping one address and selecting the one differing argument preserves identity while expressing the actual policy.

## How Do Conditions Choose Compatible Values?
<!-- section-summary: The true and false branches should answer the same kind of question so the conditional has one predictable result type. -->

Terraform needs a single type for the whole expression. These choices are clear:

```hcl
var.production ? "t3.large" : "t3.micro"
var.production ? 5 : 1
var.production ? ["a", "b"] : []
```

Both branches answer the same question with compatible strings, numbers, or collections. This is confusing:

```hcl
var.enabled ? 12 : "disabled"
```

Terraform may sometimes convert values to a common type, but implicit conversion can make later behavior surprising. Prefer branches with an obvious shared meaning and shape.

![Conditional Evaluation](/content-assets/articles/article-iac-terraform-advanced-conditionals/conditional-evaluation.png)

A boolean does not need to be converted back into itself. Use:

```hcl
condition = var.enabled
condition = !var.enabled
```

instead of:

```hcl
condition = var.enabled ? true : false
condition = var.enabled == false
```

Ask whether two possible values genuinely need selection. If the expression is already the desired boolean, use it directly.

Condition and results are separate concepts. In `var.environment == "prod" ? "t3.large" : "t3.micro"`, the comparison produces a boolean, while both result expressions produce strings. Keeping those roles visible makes more complex logic easier to debug.

## How Does `null` Omit an Optional Value?
<!-- section-summary: null represents absence, which lets a conditional omit an optional argument instead of sending an empty or invented value. -->

Terraform's `null` value means absence. For an optional resource argument, assigning `null` generally behaves as though the argument were not specified, allowing provider or argument defaults to apply where supported.

Suppose production needs a custom timeout while other environments should use default behavior:

```hcl
resource "something" "example" {
  timeout = var.environment == "prod" ? 60 : null
}
```

Production sends `60`; non-production omits the argument. This differs from `0`, which is an actual numeric value.

![Null Vs Omitted Boundary](/content-assets/articles/article-iac-terraform-advanced-conditionals/null-vs-omitted-boundary.png)

Keep absence separate from empty values:

```text
null ≠ ""
null ≠ []
null ≠ {}
null ≠ 0
null ≠ false
```

An empty string is still a supplied string. An empty list is still a supplied collection. `false` is still a boolean decision. Providers can interpret each differently from omission.

This pattern is useful for an optional description:

```hcl
description = var.add_description ? "Production server" : null
```

The question is whether the argument should participate. If yes, produce a value; if no, produce absence. `null` cannot make a required provider argument valid, and a redundant expression such as `var.custom_timeout != null ? var.custom_timeout : null` can simply be `var.custom_timeout`.

## How Does a Condition Control Resource Existence?
<!-- section-summary: A conditional still produces a value; count or for_each interprets that value as the number or identities of resource instances. -->

Making one argument `null` does not remove a resource block. To create zero or one instances, convert the boolean into a number for `count`:

```hcl
resource "aws_instance" "bastion" {
  count = var.create_bastion ? 1 : 0

  ami           = var.ami
  instance_type = "t3.micro"
}
```

When true, the conditional produces `1`, and `count` creates one instance. When false, it produces `0`, and Terraform manages none. The conditional never becomes an imperative `if`; `count` assigns infrastructure meaning to the numeric result.

Adding `count` changes address shape. The possible instance is `aws_instance.bastion[0]`, so an optional output must account for the zero case:

```hcl
output "bastion_ip" {
  value = var.create_bastion ? aws_instance.bastion[0].public_ip : null
}
```

The index exists because `count` creates a collection of instances. Refactoring an existing uncounted resource to `count` changes its address and may require a `moved` block to preserve state identity.

Every reference must handle the optional shape. A resource that exists only under the same condition can safely read `[0]`. An unconditional consumer cannot assume index zero exists when the feature is disabled. It needs its own matching condition or an optional value that becomes `null` in the zero-instance case.

`for_each` expresses the same zero-or-one idea with named identity:

```hcl
resource "aws_instance" "bastion" {
  for_each = var.create_bastion ? { bastion = {} } : {}

  ami           = var.ami
  instance_type = "t3.micro"
}
```

The enabled collection contains one key, producing `aws_instance.bastion["bastion"]`. The disabled collection is empty. Use this form when named identity fits better than positional identity.

Both designs turn a boolean into data. `count` asks how many interchangeable instances exist. `for_each` asks which named identities exist. The conditional does not directly create or skip anything; it chooses the number or collection that the meta-argument interprets.

## How Do Conditions Validate Requirements?
<!-- section-summary: Validation consumes a boolean as an acceptance rule, including requirements that apply only when another feature is enabled. -->

Conditions can reject invalid configuration instead of selecting a value. Variable validation needs one boolean condition that must be true:

```hcl
variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

There is no ternary because validation does not need two result values. It asks only whether the input is acceptable.

Conditional requirements often use this logical form:

```text
feature does not apply OR its requirement holds
```

For backups:

```hcl
variable "enable_backup" {
  type = bool
}

variable "backup_bucket" {
  type    = string
  default = null

  validation {
    condition     = !var.enable_backup || var.backup_bucket != null
    error_message = "backup_bucket must be provided when backups are enabled."
  }
}
```

If backups are disabled, the left side is true and no bucket is required. If enabled, the left side is false, so the bucket must be present. Only “enabled and missing” fails.

The truth table makes the rule explicit:

| Backups enabled | Bucket supplied | Valid |
|---|---|---|
| false | no | yes |
| false | yes | yes |
| true | yes | yes |
| true | no | no |

Translating a sentence into boolean logic before writing HCL is often easier than building a nested conditional. “Either the feature is off, or the requirement holds” is a reusable pattern.

Validation keeps resource blocks simpler by rejecting impossible caller combinations at the boundary. It also produces an error message that explains the rule before a provider API sees incomplete configuration.

The underlying pattern remains boolean evaluation. A ternary uses a boolean to choose a value. `validation.condition` uses a boolean to accept or reject an operation. Choose the consuming construct based on the outcome you need.

## How Does Filtering Choose Named Resources?
<!-- section-summary: A for expression can filter a map, and for_each then creates one stable resource instance for every retained key. -->

Suppose input describes several servers and marks which ones are enabled:

```hcl
variable "servers" {
  type = map(object({
    instance_type = string
    enabled       = bool
  }))

  default = {
    web = {
      instance_type = "t3.micro"
      enabled       = true
    }

    worker = {
      instance_type = "t3.micro"
      enabled       = false
    }

    api = {
      instance_type = "t3.small"
      enabled       = true
    }
  }
}
```

A `for` expression can derive a smaller map:

```hcl
locals {
  enabled_servers = {
    for name, server in var.servers :
    name => server
    if server.enabled
  }
}
```

The worker is excluded, while the `web` and `api` keys remain. `for_each` consumes that result:

```hcl
resource "aws_instance" "server" {
  for_each = local.enabled_servers

  ami           = var.ami
  instance_type = each.value.instance_type

  tags = {
    Name = each.key
  }
}
```

Terraform creates `aws_instance.server["web"]` and `aws_instance.server["api"]`. Disabling `api` removes only that key's instance; `web` keeps its identity. Filtering plus `for_each` is a data transformation followed by named resource expansion.

The plan therefore explains the selection through addresses. Stable keys such as `"web"` and `"api"` make it obvious which item is added or removed. If a key is renamed, Terraform sees a different identity even when the object value looks similar, so key design belongs in the conditional review.

The shape must be known early enough for planning. Caller-provided map keys work. Provider-assigned IDs that are unknown until apply cannot decide `for_each` keys, because Terraform needs the resource instance addresses before it performs provider operations.

The broader lesson is to transform input data until it describes exactly which infrastructure instances should exist. Terraform does not need an imperative loop or branch when a filtered collection already expresses the desired graph.

## How Do You Keep Conditional Logic Readable?
<!-- section-summary: Derive policy in named locals, use maps for multi-way lookup, and reserve ternaries for genuine two-way choices. -->

Nested ternaries can mix environment policy with resource mechanics:

```hcl
resource "aws_instance" "web" {
  instance_type = var.environment == "prod" && var.high_traffic
    ? "m7i.large"
    : var.environment == "prod"
      ? "m7i.medium"
      : var.environment == "staging"
        ? "t3.small"
        : "t3.micro"
}
```

Move a genuine choice into a named local so the resource focuses on infrastructure:

```hcl
locals {
  instance_type = (
    var.environment == "prod"
    ? (var.high_traffic ? "m7i.large" : "m7i.medium")
    : var.environment == "staging"
      ? "t3.small"
      : "t3.micro"
  )
}

resource "aws_instance" "web" {
  ami           = var.ami
  instance_type = local.instance_type
}
```

When the logic is really a lookup, model it as data:

```hcl
locals {
  instance_types = {
    dev     = "t3.micro"
    staging = "t3.small"
    prod    = "m7i.medium"
  }

  instance_type = local.instance_types[var.environment]
}
```

Use a conditional for a true two-way choice and a map for a multi-way mapping. Validation can ensure the lookup key is one of the supported environments.

Keep booleans direct, keep branch types compatible, and check address consequences whenever `count` or `for_each` changes graph shape. A concise expression is useful only when reviewers can explain both outcomes and the identity of every resulting resource.

Separate policy derivation from resource mechanics. Locals give a complex decision one name and one review location. Validation rejects unsupported environment names before a map lookup. Resources then consume already-shaped values rather than reimplementing the same branching rule in several places.

Do not abstract repetition merely to make every expression clever. Two clear compatible values can stay in one ternary. A named lookup can replace repeated environment branches. A filtered map is appropriate when it directly represents the desired named instances. Choose the smallest expression that describes the decision honestly.

## How Do the Conditional Patterns Fit Together?
<!-- section-summary: Terraform conditionals shape values and collections, while arguments, meta-arguments, and validation determine the operational effect. -->

A complete module can combine the patterns. It validates the environment, chooses a production instance type, requires an email only when monitoring is enabled, filters enabled applications, and creates monitors only for those applications when the feature is on.

```hcl
variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "enable_monitoring" {
  type    = bool
  default = false
}

variable "alert_email" {
  type    = string
  default = null

  validation {
    condition     = !var.enable_monitoring || var.alert_email != null
    error_message = "alert_email is required when monitoring is enabled."
  }
}

variable "applications" {
  type = map(object({
    enabled = bool
  }))
}
```

Derive the policy:

```hcl
locals {
  instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"

  enabled_applications = {
    for name, app in var.applications : name => app
    if app.enabled
  }
}
```

Create named application instances and optional monitors:

```hcl
resource "aws_instance" "application" {
  for_each = local.enabled_applications

  ami           = var.ami
  instance_type = local.instance_type

  tags = {
    Name = each.key
  }
}

resource "some_monitor" "application" {
  for_each = var.enable_monitoring ? local.enabled_applications : {}

  instance_id = aws_instance.application[each.key].id
  alert_email = var.alert_email
}
```

![Conditionals Summary](/content-assets/articles/article-iac-terraform-advanced-conditionals/conditionals-summary.png)

The pipeline is inputs, boolean rules, derived values and collections, then resource instances. Most problems reduce to choosing one value, choosing a value or `null`, choosing zero or one with `count`, choosing named objects through filtered `for_each`, or accepting configuration through validation.

The first-principles question is never “where can I put an `if`?” Ask what value or collection Terraform should see in each case, then choose the argument or construct that consumes it.

Review conditional-heavy configuration in two layers. First evaluate the data: which boolean is true, which branch wins, which values become `null`, and which keys survive a filter? Then evaluate the consumer: does an argument receive a setting, does `count` create zero or one indexed instances, does `for_each` create named instances, or does validation stop the operation? This separates expression correctness from lifecycle consequences.

Compare plans for representative inputs rather than reasoning from syntax alone. Development and production plans should reveal the selected instance types, omitted arguments, instance addresses, and action counts. A change that was expected to alter one value but instead changes addresses or destroys resources signals that the condition is controlling graph shape or identity more broadly than intended.

Finally, remember that conditions cannot make unknown provider results decide resource addresses after planning has begun. Terraform must know `count` and `for_each` shape before apply. Use stable caller-supplied keys to decide which nodes exist, then use provider-generated values inside those already-declared nodes. This keeps the configuration declarative and the plan complete enough to review.

These habits scale from one optional argument to an entire shared production module. The syntax remains the same, but the operational cost of unclear types, unstable keys, or hidden requirements grows with every caller, environment, plan, and state boundary. Keep each condition close to the decision it represents, name repeated policy once, and let Terraform's derived values describe the desired graph directly and predictably.

That is the practical discipline behind every safe Terraform conditional in reviewed production infrastructure code.

Conditional branches must produce compatible types because Terraform needs one expression type even when only one branch is selected. Use conditionals to choose values or collections from explicit inputs, not to hide broad environment-specific architectures inside one unreadable expression. For optional resources, consider how switching the condition changes addresses, outputs, and dependencies, and review both enabled and disabled plans. A false branch can destroy a previously managed instance when the desired graph no longer contains it, so toggles deserve the same lifecycle review as any resource removal.

## Check Your Answers

:::expand[What Does a Terraform Conditional Actually Do?]{kind="recap"}
It evaluates a boolean and produces one of two values. Terraform arguments and meta-arguments give that result its infrastructure meaning.
:::

:::expand[How Do Conditions Choose Compatible Values?]{kind="recap"}
The branches should answer the same question with compatible types. Use existing booleans directly instead of wrapping them in redundant ternaries.
:::

:::expand[How Does `null` Omit an Optional Value?]{kind="recap"}
`null` represents absence and can omit an optional argument. Empty strings, collections, zero, and false are real values, not absence.
:::

:::expand[How Does a Condition Control Resource Existence?]{kind="recap"}
The condition produces `1` or `0` for `count`, or a non-empty or empty collection for `for_each`. Those meta-arguments control instance shape and addresses.
:::

:::expand[How Do Conditions Validate Requirements?]{kind="recap"}
Validation consumes a boolean and rejects false conditions. `!feature || requirement` expresses a requirement that applies only when the feature is enabled.
:::

:::expand[How Does Filtering Choose Named Resources?]{kind="recap"}
A `for` expression filters an input map, and `for_each` creates one stable instance for each retained key.
:::

:::expand[How Do You Keep Conditional Logic Readable?]{kind="recap"}
Move policy into named locals, use maps for multi-way lookups, and keep ternaries for genuine two-way choices with reviewable types and identities.
:::

:::expand[How Do the Conditional Patterns Fit Together?]{kind="recap"}
Conditionals shape values and collections; arguments change settings, `count` and `for_each` change graph shape, and validation accepts or rejects inputs.
:::

### References

- [Expressions](https://developer.hashicorp.com/terraform/language/expressions)
- [Configuration syntax](https://developer.hashicorp.com/terraform/language/syntax/configuration)
- [Conditional expressions](https://developer.hashicorp.com/terraform/language/expressions/conditionals)
- [Types and values](https://developer.hashicorp.com/terraform/language/expressions/types)
- [`count` reference](https://developer.hashicorp.com/terraform/language/meta-arguments/count)
- [`variable` validation](https://developer.hashicorp.com/terraform/language/block/variable)
- [`for` expressions](https://developer.hashicorp.com/terraform/language/expressions/for)

---
title: "Expressions and Functions"
description: "Learn how Terraform's built-in expressions and functions compute, transform, and query values inside your configurations."
overview: "Expressions are the calculations inside Terraform arguments. This article shows how variables, locals, functions, for expressions, conditionals, and resource references combine into values that show up in plan output."
tags: ["expressions", "functions", "hcl", "for", "terraform"]
order: 10
id: article-iac-terraform-values-expressions
aliases:
  - infrastructure-as-code/terraform/values/expressions-and-functions.md
---

## Table of Contents

1. [How Do Expressions Connect Terraform Values to Infrastructure?](#how-do-expressions-connect-terraform-values-to-infrastructure)
2. [How Do References, Operators, and Functions Produce Values?](#how-do-references-operators-and-functions-produce-values)
3. [How Do Functions Shape Strings and Collections?](#how-do-functions-shape-strings-and-collections)
4. [How Do for Expressions Transform and Filter Collections?](#how-do-for-expressions-transform-and-filter-collections)
5. [How Do Conditionals, null, and Unknown Values Differ?](#how-do-conditionals-null-and-unknown-values-differ)
6. [How Should Locals Normalize Values for Resources?](#how-should-locals-normalize-values-for-resources)
7. [How Do You Test and Review Expressions?](#how-do-you-test-and-review-expressions)
8. [How Does a Complete Expression Pipeline Work?](#how-does-a-complete-expression-pipeline-work)
9. [Check Your Answers](#check-your-answers)

Consider one bucket argument:

```hcl
resource "aws_s3_bucket" "website" {
  bucket = "${var.project_name}-${var.environment}"
}
```

The resource block declares an S3 bucket. The `bucket` argument requires a name. The string template is an expression that calculates that name. The hierarchy is:

```text
block
└── argument
    └── expression
        └── value
```

Terraform values include primitive strings, numbers, and booleans:

```hcl
"production"
42
true
```

and collections or structural values:

```hcl
["web", "api", "worker"]

{
  Environment = "production"
  Owner       = "platform"
}
```

Lists or tuples, sets, maps or objects, and `null` all participate in the same expression system. An expression is anything that evaluates to one of these values.

The simplest expression is a literal:

```hcl
region  = "eu-west-2"
enabled = true
count   = 3
```

The right-hand sides already produce a string, boolean, and number. An expression does not need a function or operator to qualify. The fundamental rule is:

```text
expression --evaluate--> value
```

Keep these questions in view as you work through the lesson:

1. **How Do Expressions Connect Terraform Values to Infrastructure?**
2. **How Do References, Operators, and Functions Produce Values?**
3. **How Do Functions Shape Strings and Collections?**
4. **How Do `for` Expressions Transform and Filter Collections?**
5. **How Do Conditionals, `null`, and Unknown Values Differ?**
6. **How Should Locals Normalize Values for Resources?**
7. **How Do You Test and Review Expressions?**
8. **How Does a Complete Expression Pipeline Work?**

## How Do Expressions Connect Terraform Values to Infrastructure?

Variables can replace those literal values:

```hcl
variable "project_name" {
  type    = string
  default = "store"
}

variable "environment" {
  type    = string
  default = "dev"
}
```

The template:

```hcl
"${var.project_name}-${var.environment}"
```

reads two values and produces `store-dev`. Neither input is mutated. Terraform calculates a new value and supplies it to the bucket argument.

![Expressions evaluate inputs into values that resource arguments consume](/content-assets/articles/article-iac-terraform-values-expressions/expression-evaluation.png)

This gives the central pipeline:

```text
inputs and references
        │
        ▼
expressions and transformations
        │
        ▼
calculated values
        │
        ▼
resource arguments
        │
        ▼
desired infrastructure
```

Expressions themselves do not create cloud objects. They form Terraform's data-processing layer between configuration inputs and the provider-facing description of infrastructure.

The distinction between value and expression helps when reading HCL. In `bucket = local.bucket_name`, `bucket` is the argument name and `local.bucket_name` is an expression. Its evaluated string is the value assigned to the argument. In `count = var.enabled ? 3 : 0`, the full conditional is one expression and its result is one number. Terraform cares about the result's type because the receiving argument defines what kinds of values it accepts.

Collections are single values even when they contain many elements. A list of three zones can be passed to a module, transformed with a `for` expression, or assigned to an argument that expects multiple zones. A map of tags is likewise one map value. This perspective prevents confusing “many items inside a value” with “many independently managed resources.” Only constructs such as `count` or `for_each` turn an appropriate value into repeated resource instances.

String templates are expressions nested inside a string expression. With:

```hcl
"${var.project_name}-${var.environment}"
```

Terraform reads both references, converts their values into the template result, and records any dependencies those references carry. The result is still just one string. If one referenced value is unknown, the final string can remain unknown until that input becomes available.

The mathematical analogy is useful because expressions describe relationships rather than mutation. If `x` is `store` and `y` is `dev`, the template behaves like a function `f(x, y) = x + "-" + y`. Change either input and Terraform reevaluates the result. Nothing “runs” the string as an instruction.

## How Do References, Operators, and Functions Produce Values?

A reference is an expression whose value comes from another named node:

```hcl
var.project_name
local.bucket_name
aws_s3_bucket.website.id
data.aws_vpc.shared.id
module.network.vpc_id
```

Their origins differ—caller input, local calculation, managed resource, external lookup, or child output—but each reference eventually resolves to a Terraform value.

A resource reference also carries dependency information:

```hcl
resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.website.id
}
```

`aws_s3_bucket.website.id` supplies the bucket ID and tells Terraform that the website configuration depends on the bucket producing that attribute.

Operators perform small calculations. Arithmetic:

```hcl
2 + 3
```

produces `5`. Comparison:

```hcl
var.environment == "production"
```

produces a boolean. Boolean logic composes conditions:

```hcl
var.environment == "production" && var.enable_monitoring
!var.enabled
```

A local can name the result:

```hcl
locals {
  is_production = var.environment == "prod"
}
```

Functions are named transformations with argument values and a return value:

```hcl
lower(var.project_name)
```

For `MY STORE`, `lower` produces `my store`. Most built-in functions behave as pure transformations: they return a new value rather than mutating their inputs.

Functions compose because one result can become the next argument:

```hcl
replace(
  lower(trimspace(var.project_name)),
  " ",
  "-"
)
```

For `  MY STORE  `, evaluation proceeds through `trimspace` to `MY STORE`, through `lower` to `my store`, and through `replace` to `my-store`.

![Functions form a transformation path from raw input to normalized output](/content-assets/articles/article-iac-terraform-values-expressions/function-transform-path.png)

Terraform includes built-in functions and can also expose provider-defined functions in modern configurations. The provider or Terraform documentation defines the accepted argument types and result. The general mental model stays the same:

```text
input values -> function -> returned value
```

Operator precedence matters when several calculations appear together, just as it does in ordinary arithmetic and boolean logic. Parentheses can make intent explicit:

```hcl
(var.environment == "prod") && var.enable_monitoring
```

The equality comparison returns a boolean, which the AND operator combines with another boolean. Terraform then supplies the final result wherever a boolean is expected.

Negation returns a new boolean:

```hcl
!var.enabled
```

Arithmetic and comparison follow the same value-in, value-out model:

```hcl
var.base_count + var.extra_count
var.instance_count >= 2
```

The first returns a number; the second returns a boolean. Expressions can nest because every inner calculation supplies a value to the surrounding one.

References differ from plain strings that happen to contain identifiers. `aws_s3_bucket.website.id` connects to the managed resource attribute; `"aws_s3_bucket.website.id"` is only literal text and creates no dependency. Correct references are therefore essential for both final values and graph construction.

Function composition should be read from the innermost call outward. For `replace(lower(trimspace(var.project_name)), " ", "-")`, first evaluate the variable, then remove surrounding space, normalize case, and replace internal spaces. Writing the stages vertically or naming them with locals makes this order visible without implying procedural mutation.

The source input remains unchanged throughout. `lower` does not rewrite `var.project_name`; it returns another string. `merge` does not add keys to an existing map in place; it returns a new map. This functional behavior supports Terraform's declarative evaluation and makes the same expression reproducible from the same known inputs.

## How Do Functions Shape Strings and Collections?

String functions commonly normalize user-facing input into provider-compatible names:

```hcl
lower("PRODUCTION")
upper("dev")
trimspace("  hello  ")
replace("my web app", " ", "-")
```

These produce `production`, `DEV`, `hello`, and `my-web-app`. `format` can make a multi-part name explicit:

```hcl
format(
  "%s-%s-%s",
  var.project_name,
  var.environment,
  var.aws_region,
)
```

For `store`, `prod`, and `eu-west-2`, the result is `store-prod-eu-west-2`.

Collections are values too. Given:

```hcl
variable "availability_zones" {
  type = list(string)

  default = [
    "eu-west-2a",
    "eu-west-2b",
    "eu-west-2c",
  ]
}
```

`var.availability_zones[0]` produces the first string, while `length(var.availability_zones)` produces `3`. Functions can accept and return complete collections.

For two lists:

```hcl
locals {
  frontend_ports = [80, 443]
  admin_ports    = [22]
}
```

this expression:

```hcl
concat(local.frontend_ports, local.admin_ports)
```

returns `[80, 443, 22]`. Other collection functions can flatten nested values, remove duplicates, convert collection types, or otherwise reshape data. The important pattern is input collection or collections, transformation, then a new collection value.

Maps are especially useful for configuration such as tags:

```hcl
locals {
  standard_tags = {
    ManagedBy = "Terraform"
    Project   = var.project_name
  }

  website_tags = {
    Component = "website"
  }
}
```

`merge(local.standard_tags, local.website_tags)` produces one map containing all three entries. A resource can consume it directly:

```hcl
resource "aws_s3_bucket" "website" {
  tags = merge(
    local.standard_tags,
    local.website_tags,
  )
}
```

The original maps are not modified. `merge` returns a new value. This immutable style makes declarative calculations easier to trace: an expression receives values and produces another value rather than changing memory in place.

Function choice should describe one transformation, not hide a program. Compose small functions when the dataflow remains readable. If a deeply nested call is difficult to explain, name intermediate results with locals or reconsider the input structure.

Function results can feed one another across value types. `length(var.availability_zones)` converts a collection into a number. Comparing that number with `2` produces a boolean. A conditional can then choose an availability policy value. The expression tree may contain different intermediate types even though the root returns one final type.

Map merge order also matters. When two maps contain the same key, the later value determines the result. A module can merge caller tags first and required tags second to prevent callers from overriding policy, or reverse the order to allow customization deliberately. The expression is not only mechanical combination; its argument order can encode ownership.

List and set semantics affect which function or consumer fits. A list preserves order and can contain duplicates. A set represents unique unordered elements. Converting with `toset` can make a value suitable for `for_each`, but callers should not then rely on position. `concat` returns a sequence; a separate normalization may be needed when uniqueness matters. Always examine both returned contents and returned type.

Functions also make data-source and resource values easier to use. A provider may return a list that needs filtering, a hostname that needs formatting into a URL, or a map that needs merging with module defaults. The function still performs no remote action. It transforms the value while retaining dependencies on the nodes that produced it.

## How Do `for` Expressions Transform and Filter Collections?

A `for` expression evaluates one transformation for every input element. Given:

```hcl
variable "environments" {
  default = [
    "dev",
    "staging",
    "prod",
  ]
}
```

this list-producing expression:

```hcl
[
  for env in var.environments :
  "${var.project_name}-${env}"
]
```

can produce:

```hcl
[
  "store-dev",
  "store-staging",
  "store-prod",
]
```

Read the syntax as: bind each source element temporarily to `env`, evaluate the expression after the colon, and collect the results. Square brackets create a tuple-style result that Terraform can often convert to a list when required.

Curly braces plus `=>` build a map or object:

```hcl
{
  for env in var.environments :
  env => "${var.project_name}-${env}"
}
```

which yields:

```hcl
{
  dev     = "store-dev"
  staging = "store-staging"
  prod    = "store-prod"
}
```

For a map input, bind both key and value:

```hcl
variable "instances" {
  default = {
    web = "t3.micro"
    api = "t3.small"
    db  = "t3.medium"
  }
}

locals {
  descriptions = [
    for name, instance_type in var.instances :
    "${name} uses ${instance_type}"
  ]
}
```

For lists or tuples, a two-symbol form can use the numeric index and value.

Add an `if` clause to filter elements:

```hcl
variable "servers" {
  default = {
    frontend = true
    backend  = true
    legacy   = false
  }
}

locals {
  enabled_servers = [
    for name, enabled in var.servers :
    name
    if enabled
  ]
}
```

Only enabled names remain. Transformation and filtering can compose:

```hcl
[
  for env in ["dev", "test", "staging", "prod"] :
  upper(env)
  if env != "test"
]
```

returns `DEV`, `STAGING`, and `PROD`.

Do not confuse a `for` expression with the `for_each` meta-argument. A `for` expression produces one collection value. `for_each` consumes a map or set to create multiple addressed resource instances. They often connect:

```hcl
locals {
  buckets = {
    for env in var.environments :
    env => "${var.project_name}-${env}"
  }
}

resource "aws_s3_bucket" "environment" {
  for_each = local.buckets

  bucket = each.value
}
```

The expression produces a map; `for_each` creates instances such as `aws_s3_bucket.environment["dev"]` and `aws_s3_bucket.environment["prod"]`.

A mathematical mapping is a good reading model:

```hcl
[
  for env in var.environments :
  upper(env)
]
```

binds one input element, applies `upper`, and collects each returned value. The temporary symbol exists only inside the expression. It is not a mutable loop variable and the expression does not append to a list step by step in configuration order.

Filtering occurs after binding and alongside transformation. In:

```hcl
[
  for env in var.environments :
  upper(env)
  if env != "test"
]
```

each input is tested. `test` is omitted; the other values are transformed. The final collection contains only produced results. No resource is created or destroyed by the `for` expression itself.

Map-producing expressions must create keys as well as values. Stable semantic keys are valuable when the result feeds `for_each` because the key becomes part of each resource address. An environment map creates addresses keyed by `dev`, `staging`, and `prod`, which are usually clearer and more stable than numeric positions.

Key and value iteration lets a transformation retain or change identity:

```hcl
{
  for name, instance_type in var.instances :
  name => {
    instance_type = instance_type
    display_name  = upper(name)
  }
}
```

The result is one richer map. A resource can later use `each.key` and fields from `each.value`. This separates shaping the internal data model from declaring repeated infrastructure.

Use `for` when the same calculation applies across a collection. Use a normal function when one whole value needs a transformation. Use a conditional when one of two results should be selected. Nest them only when the combined expression remains understandable; otherwise give intermediate results names.

## How Do Conditionals, `null`, and Unknown Values Differ?

A conditional chooses one of two values:

```hcl
var.environment == "prod" ? "t3.large" : "t3.micro"
```

Read it as condition, question mark, value if true, colon, value if false. With `environment = "prod"`, the comparison returns true and the whole expression returns `t3.large`.

This is not an imperative `if` statement that runs one operation branch. It is one value-producing expression:

```hcl
resource "aws_instance" "web" {
  count = var.environment == "prod" ? 3 : 1
}
```

The conditional computes the number supplied to `count`. Both possible results should normally have the same conceptual type. A string on one side and number on the other may trigger automatic conversion in some contexts, but it makes the intended contract harder to understand.

Conditionals compose with functions and collection expressions:

```hcl
length(var.extra_tags) > 0 ? var.extra_tags : {}
```

first calls `length`, compares the result with zero, and selects either the original map or an empty map.

Inside a `for` expression:

```hcl
{
  for env in var.environments :
  env => env == "prod" ? "large" : "small"
}
```

one expression produces a complete map of environment sizes.

`null` represents intentional absence:

```hcl
profile = var.use_profile ? var.aws_profile : null
```

When the profile is disabled, the expression deliberately supplies no concrete value. Unknown means something different: a value will exist, but Terraform cannot determine it yet.

```text
null
= intentionally absent

unknown
= expected later, not available now
```

A provider-created endpoint may be unknown during planning:

```hcl
output "website_url" {
  value = "http://${aws_s3_bucket_website_configuration.website.website_endpoint}/"
}
```

The expression is valid and the dependency is understood, but the resource has not produced `website_endpoint`. Terraform propagates `(known after apply)` through the template until the provider supplies the attribute.

`try` and `can` address expressions over legitimately irregular shapes. `can(var.config.optional_setting)` returns whether that access succeeds. `try` evaluates alternatives until one succeeds. They are useful for normalizing external or variable data with optional structure, but should not replace clear input types when the module can define a stable contract.

Conditional type consistency matters because the result must be one value with a usable type regardless of which branch wins. These are straightforward:

```hcl
var.production ? "large" : "small"
var.production ? 3 : 1
```

The first always returns a string, the second always a number. This expression mixes concepts:

```hcl
var.production ? 3 : "one"
```

Terraform may be able to convert in some contexts, but readers must guess whether the intended contract is numeric or textual. Make conversions explicit or redesign the branches to return the same conceptual type.

Conditionals are often clearer when named as policy:

```hcl
locals {
  instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"
}
```

The resource reads `local.instance_type`, while the local explains that environment policy determines sizing. The conditional still returns one string; naming it does not create a procedural branch.

Unknown propagation follows every nested expression. If `aws_instance.web.public_ip` is unknown, then `format("http://%s:8080", aws_instance.web.public_ip)` is also unknown. Terraform can know the function, result type, and dependency while postponing the concrete string. This is different from `null`, which is already a known intentional absence.

Use `can` for validation or normalization when testing whether a potentially invalid access can succeed. Use `try` to select the first successful expression from alternatives. If every caller is supposed to provide one stable object shape, a precise variable type is clearer than scattering `try` throughout resource arguments.

## How Should Locals Normalize Values for Resources?

Long expressions inside resource arguments are hard to review:

```hcl
resource "aws_s3_bucket" "website" {
  bucket = "${replace(lower(trimspace(var.project_name)), " ", "-")}-${lower(var.environment)}"
}
```

Name the intermediate calculations:

```hcl
locals {
  normalized_project = replace(
    lower(trimspace(var.project_name)),
    " ",
    "-",
  )

  normalized_environment = lower(var.environment)

  bucket_name = "${local.normalized_project}-${local.normalized_environment}"
}

resource "aws_s3_bucket" "website" {
  bucket = local.bucket_name
}
```

Locals are named expression nodes, not sequential variables. This ordering remains dependency-driven:

```hcl
locals {
  final_name = "${local.base_name}-bucket"
  base_name  = lower(var.project_name)
}
```

Terraform follows `var.project_name -> local.base_name -> local.final_name`, regardless of line order.

Normalize complexity near the module boundary:

```text
raw caller input
      │
      ▼
validation and normalization
      │
      ▼
clean internal values
      │
      ▼
resource arguments
```

Resources do not need to know whether a valid map came from a variable, local, function, `for` expression, data source, or resource attribute. They consume the final value and its dependency relationships.

For tags:

```hcl
locals {
  final_tags = merge(
    var.default_tags,
    {
      Environment = lower(var.environment)
      Name        = "${var.project}-${var.environment}"
    },
  )
}

resource "aws_s3_bucket" "website" {
  tags = local.final_tags
}
```

The expression tree reads inputs, transforms the environment, builds a map, merges maps, and supplies one final argument.

Do not turn Terraform into a general-purpose programming language. Deeply nested comprehensions, `flatten` calls, conditionals, and merges can be legal but unreadable. When expression complexity keeps growing, simplify the data model, split meaningful stages into locals, or move general computation outside Terraform. Expressions should make desired infrastructure clearer, not recreate an imperative application inside HCL.

The normalization layer also creates consistency. If two buckets and an IAM policy all require the same project slug, calculate it once. Repeating `lower(replace(trimspace(...)))` invites one consumer to drift or apply the operations in a different order. A named local makes the rule reviewable and reusable.

Locals can depend on other locals without creating a top-to-bottom sequence. Terraform builds edges among the named expressions and rejects cycles. This lets a configuration express stages such as normalized project, base name, bucket map, and common tags as a readable graph.

Keep the stages meaningful. `local.project_slug` communicates a normalized naming concept. A chain such as `local.value_a -> local.value_b -> local.value_c` with no additional meaning only hides the expression. The goal is a small internal vocabulary for the module's decisions, not a variable assignment program.

Resource arguments receive evaluated values along with any dependency information. If `local.final_tags` includes a resource-generated value, consumers remain downstream of that resource. If all inputs are literals and variables, Terraform can normally calculate the map during planning. Local normalization changes readability, not knowledge timing.

Complexity can also signal that the caller's input is shaped poorly. A deeply nested collection may require flattening, re-keying, filtering, merging, and conditional fallbacks before any resource can use it. A simpler typed input or a preparatory tool outside Terraform may produce a clearer infrastructure module. Use HCL's expression language for declarative configuration calculations, not arbitrary business computation.

## How Do You Test and Review Expressions?

`terraform console` is an interactive expression evaluator. It lets you learn and debug the value language without involving a cloud resource:

```text
> 2 + 3
5

> upper("production")
"PRODUCTION"

> [for x in ["dev", "prod"] : upper(x)]
[
  "DEV",
  "PROD",
]

> {for x in ["dev", "prod"] : x => upper(x)}
{
  "dev" = "DEV"
  "prod" = "PROD"
}
```

Use it as a small experiment. Form a hypothesis about one expression, paste the smallest representative input, inspect the value, and only then place the tested expression into the larger configuration.

For example:

```text
> [for x in ["a", "b", "c"] : upper(x) if x != "b"]
[
  "A",
  "C",
]
```

This confirms both filtering and transformation without waiting for a provider operation.

Check type as well as printed content. These look related:

```hcl
["a", "b"]
toset(["a", "b"])
```

but a list or tuple is ordered and allows positional access, while a set is unordered and contains unique elements. A map or object has keyed structure. The destination argument, `for_each`, or function may require particular type semantics even when values look similar in terminal output.

Temporary outputs can reveal a calculated value in configuration context:

```hcl
locals {
  bucket_names = {
    for env in var.environments :
    env => "${var.project_name}-${env}"
  }
}

output "debug_bucket_names" {
  value = local.bucket_names
}
```

A plan or apply shows the result. Remove the debug output once it is no longer part of the intended public module interface.

The standard tools answer different questions:

```text
terraform fmt
└── Is source formatting canonical?

terraform validate
└── Is configuration syntax and structure acceptable?

terraform console
└── Does this isolated expression produce the expected value and type?

terraform plan
└── Do the calculated values produce the intended infrastructure changes?
```

Validation does not replace plan review. A type-correct expression can calculate an unintended bucket name, choose the wrong resource count, or change a `for_each` key. The plan connects expression results to lifecycle effects.

The console can also inspect values from the current configuration and state, so results may depend on initialized providers or available state when references are involved. For pure function learning, use literal test values to isolate the language behavior. Then test the real reference in a plan to include dependency and provider context.

When debugging, reduce the expression one layer at a time. Evaluate the innermost function, then the next transformation, then the collection or conditional around it. Check both the displayed result and the type semantics at each step. This turns a dense expression into a sequence of falsifiable small expectations.

Temporary outputs are useful because they operate inside the real module graph, but they are not merely print statements. A root output is stored in state after apply and can become a public interface. Use it briefly and remove it when no consumer should rely on the debug value. Avoid exposing sensitive intermediate calculations.

Plan review must pay special attention to collection keys. A transformation that changes a `for_each` key can make Terraform see an old resource instance disappear and a new one appear. The calculated values may look correct while the address change causes replacement. Inspect both arguments and instance addresses.

Formatting is the first and least semantic check. Validation proves the expression can fit Terraform's configuration rules. The console proves a representative calculation. The plan combines current state, provider schemas, unknown values, and resource lifecycle semantics. A safe workflow uses each tool for its own question.

## How Does a Complete Expression Pipeline Work?

Build a configuration from four inputs:

```hcl
variable "project_name" {
  type    = string
  default = "My Store"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "components" {
  type = set(string)

  default = [
    "assets",
    "logs",
    "uploads",
  ]
}

variable "default_tags" {
  type = map(string)

  default = {
    ManagedBy = "Terraform"
    Team      = "Platform"
  }
}
```

Normalize the strings:

```hcl
locals {
  project_slug = replace(
    lower(trimspace(var.project_name)),
    " ",
    "-",
  )

  environment = lower(var.environment)
}
```

Derive a base name, per-component bucket map, common tags, and an environment policy:

```hcl
locals {
  base_name = "${local.project_slug}-${local.environment}"

  bucket_names = {
    for component in var.components :
    component => "${local.base_name}-${component}"
  }

  common_tags = merge(
    var.default_tags,
    {
      Project     = local.project_slug
      Environment = local.environment
    },
  )

  lifecycle_enabled = local.environment == "prod"
}
```

Resources consume the calculated map and tags:

```hcl
resource "aws_s3_bucket" "component" {
  for_each = local.bucket_names

  bucket = each.value

  tags = merge(
    local.common_tags,
    {
      Component = each.key
    },
  )
}
```

Follow `project_name = "My Store"` through every transformation. `trimspace` leaves `My Store`; `lower` produces `my store`; `replace` produces `my-store`. With environment `prod`, `local.base_name` becomes `my-store-prod`.

The `for` expression transforms the component set into:

```hcl
{
  assets  = "my-store-prod-assets"
  logs    = "my-store-prod-logs"
  uploads = "my-store-prod-uploads"
}
```

`for_each` then creates stable keyed addresses:

```text
aws_s3_bucket.component["assets"]
aws_s3_bucket.component["logs"]
aws_s3_bucket.component["uploads"]
```

Each resource receives its bucket name, the common tag map, and a component-specific tag. The complete dataflow is:

```text
var.project_name
      │ trimspace -> lower -> replace
      ▼
local.project_slug ──────────┐
                             ├──► local.base_name
var.environment -> lower ────┘          │
                                        │
var.components ─────────────────────────┤
                                        ▼
                               for expression
                                        │
                                        ▼
                               local.bucket_names
                                        │
                                        ▼
                                     for_each
                              ┌─────────┼─────────┐
                              ▼         ▼         ▼
                           assets      logs    uploads
```

The language hierarchy behind the example is:

```text
blocks describe or configure things
        │
arguments assign names to values
        │
expressions produce those values
        │
values are strings, numbers, booleans,
collections, objects, sets, or null
```

Use a function for one value transformation, a `for` expression for a repeated collection transformation, and a conditional when one of two values should win. Because all three return values, they can compose.

![Expressions are the data-processing layer between raw inputs and desired infrastructure](/content-assets/articles/article-iac-terraform-values-expressions/expressions-summary.png)

The deepest model is simple: an expression is a machine that produces a value. References find inputs, operators and functions transform them, `for` expressions map and filter collections, conditionals choose results, locals name intermediate nodes, and resource arguments consume the final values. Terraform evaluates that graph as far as current information allows and carries provider-dependent unknowns until apply.

The example also shows the difference between transforming data and repeating infrastructure. `local.bucket_names` is one map value even though it contains three entries. Only when `for_each` consumes that map does Terraform create three addressed resource instances. Keeping those stages separate makes it easier to test the map before it has lifecycle consequences.

Common tags demonstrate composition from different ownership sources. `var.default_tags` belongs to the caller's input contract. The module derives normalized project and environment fields. `merge` creates the provider-facing result. A later component tag uses `each.key`, adding the identity of the current repeated resource. Every layer contributes a value without mutating the earlier ones.

If one bucket attribute were provider-generated and fed into another expression, that downstream result could become unknown until apply. The same pipeline still works: Terraform evaluates known normalization and collection work now, preserves the resource dependency, and completes the remaining expression when the provider returns the missing attribute.

The hierarchy helps locate mistakes. If syntax is wrong around braces, inspect the block or collection expression. If an argument receives the wrong type, inspect the expression's return type. If a value is surprising, trace references and transformations. If a resource operation is surprising, see how the final value and instance keys changed in the plan.

Terraform's declarative character comes from this separation. Authors state relationships among values and objects. They do not manually run `lower`, loop, branch, then invoke an API in sequence. Terraform builds one graph, evaluates the expression nodes it can know, and schedules provider operations for the resource nodes that consume them.

A compact decision rule keeps everyday expressions readable. Use a literal when the value is an invariant. Use a reference when another named node owns the value. Use an operator for a small arithmetic or boolean calculation. Use a function for a defined transformation of one or more complete values. Use `for` when that transformation repeats across a collection. Use a conditional when exactly one of two compatible results should be selected. Use a local when the resulting concept deserves a name or reuse.

Then ask where the result goes. It might configure a resource argument, select a data-source query, become a module input, feed `for_each`, or cross a boundary through an output. The consumer determines the required type and the operational consequence. A string calculation used only in an output has different effects from a map whose keys control resource instance identity.

Finally, keep unknown and sensitive characteristics in the flow. A valid expression cannot make a provider-generated value arrive earlier, and a transformation cannot make secret-derived information public. Terraform carries these properties through the graph along with ordinary type and dependency information. Reviewing expressions therefore means reviewing not only their visible result, but also origin, type, timing, sensitivity, and lifecycle consumer.

That complete review is what turns expression fluency into safe infrastructure design. The syntax may range from one literal to a composed collection pipeline, but the same question always applies: what value does this produce, from which dependencies, and what part of desired infrastructure will consume it? Answering that question keeps calculations explainable from raw input through the final plan.

It also keeps collection identity and provider timing visible.

Those details determine whether a calculation stays local, changes resource arguments, or changes the addresses of managed instances.

They belong in every plan review, not only in syntax exercises.

Expression results ultimately become infrastructure decisions.

Review their meaning before applying those decisions.

Clear values produce clearer plans.

That is the goal.

Always.

Make that reasoning explicit.

Expression types and unknown values are part of planning. Terraform can often construct a graph while some provider-computed attributes remain known only after apply, but functions or collection keys that require concrete values may fail earlier. Keep instance identity based on stable configuration inputs, use conversions deliberately, and let the console or small outputs inspect complicated transformations. A concise expression is not automatically clearer; named locals can expose intermediate meaning when nested conditionals, comprehensions, and functions would otherwise hide how one input changes resource arguments.

Collection shape matters as much as element type. A nested list produced by a `for` expression may need `flatten(...)` before a resource can consume one flat sequence. That transformation should be visible and deliberate: inspect it in `terraform console`, verify that keys or ordering still express stable identity, and then review the resulting resource addresses before apply.

## Check Your Answers

:::expand[How Do Expressions Connect Terraform Values to Infrastructure?]{kind="recap"}
Blocks contain arguments, arguments accept expressions, and expressions evaluate to typed values. Resource arguments use those results to describe desired infrastructure.
:::

:::expand[How Do References, Operators, and Functions Produce Values?]{kind="recap"}
References read named values, operators perform small calculations, and functions return transformed values. Resource references also preserve dependency information.
:::

:::expand[How Do Functions Shape Strings and Collections?]{kind="recap"}
String and collection functions normalize, combine, and reshape values without mutating their inputs. Compose them only while the transformation path remains readable.
:::

:::expand[How Do `for` Expressions Transform and Filter Collections?]{kind="recap"}
A `for` expression returns one transformed or filtered collection. It differs from `for_each`, which consumes a map or set to create multiple resource instances.
:::

:::expand[How Do Conditionals, `null`, and Unknown Values Differ?]{kind="recap"}
A conditional chooses one value, `null` represents intentional absence, and unknown means a future value is not yet available. `try` and `can` help normalize legitimately irregular shapes.
:::

:::expand[How Should Locals Normalize Values for Resources?]{kind="recap"}
Locals name meaningful intermediate calculations so resources consume clean values. Normalize complexity early, but redesign data that requires unreadably clever expression programs.
:::

:::expand[How Do You Test and Review Expressions?]{kind="recap"}
Use the console for isolated value and type experiments, validation for structure, temporary outputs for inspection, and plans for real infrastructure consequences.
:::

:::expand[How Does a Complete Expression Pipeline Work?]{kind="recap"}
Raw inputs flow through functions, locals, collection expressions, and choices into resource arguments. Expressions are Terraform's data-processing layer within the dependency graph.
:::

### References

- [Expressions](https://developer.hashicorp.com/terraform/language/expressions)
- [Types and values](https://developer.hashicorp.com/terraform/language/expressions/types)
- [Strings and templates](https://developer.hashicorp.com/terraform/language/expressions/strings)
- [Operators](https://developer.hashicorp.com/terraform/language/expressions/operators)
- [Functions](https://developer.hashicorp.com/terraform/language/functions)
- [Function calls](https://developer.hashicorp.com/terraform/language/expressions/function-calls)
- [`for` expressions](https://developer.hashicorp.com/terraform/language/expressions/for)
- [Conditional expressions](https://developer.hashicorp.com/terraform/language/expressions/conditionals)
- [Terraform language overview](https://developer.hashicorp.com/terraform/language)

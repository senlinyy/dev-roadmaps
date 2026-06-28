---
title: "Local Values"
description: "Name and reuse computed expressions inside a Terraform configuration, removing repetition and making complex logic readable."
overview: "Local values are named expressions inside a module. This article shows how locals shape variable inputs into names, tags, policy fragments, and resource arguments that appear clearly in Terraform plans."
tags: ["locals", "local values", "expressions", "terraform", "hcl"]
order: 5
id: article-iac-terraform-values-locals
aliases:
  - infrastructure-as-code/terraform/values/local-values.md
---

## Table of Contents

1. [The Repetition That Locals Remove](#the-repetition-that-locals-remove)
2. [Declaring Local Values](#declaring-local-values)
3. [Consuming Locals in Resources](#consuming-locals-in-resources)
4. [Locals for Policy Documents and Lists](#locals-for-policy-documents-and-lists)
5. [Reading Locals in the Plan](#reading-locals-in-the-plan)
6. [Helpful Locals and Hidden Indirection](#helpful-locals-and-hidden-indirection)
7. [Putting It All Together](#putting-it-all-together)

## The Repetition That Locals Remove
<!-- section-summary: Local values give repeated or computed expressions one readable name inside a module. -->

After variables arrive, the orders module has values like `var.service_name`, `var.environment`, and `var.extra_tags`. Several resources need the same name prefix and the same tag map. Repeating those expressions in every resource creates review risk.

A **local value** is a named expression inside one Terraform module. Terraform's [local values documentation](https://developer.hashicorp.com/terraform/language/values/locals) covers the block syntax, and the daily pattern is to declare it in a `locals` block and read it as `local.<name>`. The module calculates a local from values already available inside the module, while callers supply variables.

Locals are useful for naming a value path that would otherwise repeat or distract from the resource. A shared name prefix, a common tag map, a generated IAM policy document, or a filtered subnet list can all be good locals. A local for one tiny literal used once usually adds noise.

Think about the review experience. If a reviewer needs to check every tag map by hand, repetition is hurting the module. If they can inspect `local.common_tags` once and then see resources consume it, they can trust one named path.

Locals also mark the boundary between caller choice and module calculation. A caller supplies `service_name` and `environment`. The module calculates `name_prefix`, `common_tags`, bucket names, policy documents, and filtered lists. That keeps the public variable interface small while keeping important derived values visible in code.

Under the hood, locals are expression-only values inside the module. Terraform evaluates them while building the plan, and their results appear through resources, outputs, module arguments, and other expressions that consume them. State records the managed resources and outputs, while locals stay as calculated configuration values.

## Declaring Local Values
<!-- section-summary: A locals block can turn input variables into reusable names, tags, and derived settings. -->

The orders module starts with variables in `variables.tf`:

![Locals Normalization](/content-assets/articles/article-iac-terraform-values-locals/locals-normalization.png)

*The normalization view shows locals turning raw inputs into consistent names and tags before resources consume them.*

```hcl
variable "service_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
```

The module then declares the first local value in `locals.tf`:

```hcl
locals {
  name_prefix = "devpolaris-${var.service_name}-${var.environment}"
}
```

`local.name_prefix` gives the naming rule one readable name. The module can now reuse the same prefix for buckets, policies, and tags.

The next piece is the common tag map:

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

`merge` combines the standard tags with caller-supplied tags. The module owns `managed_by = "terraform"`, while the caller can still add team-specific tags such as owner or cost center.

The bucket names can build on the same prefix:

```hcl
locals {
  name_prefix = "devpolaris-${var.service_name}-${var.environment}"

  exports_bucket_name = "${local.name_prefix}-exports"
  reports_bucket_name = "${local.name_prefix}-reports"
}
```

The local values consume variables and other locals. `local.exports_bucket_name` uses `local.name_prefix`, and `local.name_prefix` uses two variables. Terraform evaluates the expression graph, so the order inside the file is for readability.

Multiple `locals` blocks are allowed in the same module. Many teams still keep most locals in `locals.tf` so naming and tagging rules have one obvious place.

A local can depend on a resource attribute too:

```hcl
locals {
  exports_object_arn = "${aws_s3_bucket.orders_exports.arn}/*"
}
```

That local is unknown until the bucket ARN is known. Terraform still tracks the dependency through the reference. Any resource or output that consumes `local.exports_object_arn` also depends on the bucket.

## Consuming Locals in Resources
<!-- section-summary: Resources consume locals through local.name references, which keeps repeated expressions out of resource bodies. -->

The resources in `main.tf` can now stay short:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = local.exports_bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket" "orders_reports" {
  bucket = local.reports_bucket_name
  tags   = local.common_tags
}
```

The value path is still visible. `prod.tfvars` supplies `service_name = "orders-api"` and `environment = "prod"`. `locals.tf` turns those inputs into `devpolaris-orders-api-prod`. The resources consume bucket names derived from that prefix.

This pattern helps real teams keep naming consistent. If the organization changes its prefix from `devpolaris` to `dp`, the module can update one local expression and show a plan for the affected resource names.

Name changes need care. Many cloud resources cannot rename in place, so a name local update may cause replacements. The plan should be reviewed before apply, with migration steps for data or production traffic.

Locals can feed any block that needs the calculated value. Later, module calls can receive locals too. That later module pattern uses the same value path: raw inputs come in through variables, locals shape those values, and the receiving block consumes the clear final value.

## Locals for Policy Documents and Lists
<!-- section-summary: Locals can make larger expressions readable for resources that need structured JSON, lists, or maps. -->

Locals can also hold structured values. Suppose the orders app needs a policy statement that reads from both buckets. The resource needs JSON, but the source values are Terraform expressions.

![Derived Values Map](/content-assets/articles/article-iac-terraform-values-locals/derived-values-map.png)

*The map shows how locals can name a larger expression so policies, lists, and maps stay readable.*

```hcl
locals {
  export_bucket_arns = [
    aws_s3_bucket.orders_exports.arn,
    "${aws_s3_bucket.orders_exports.arn}/*",
    aws_s3_bucket.orders_reports.arn,
    "${aws_s3_bucket.orders_reports.arn}/*"
  ]

  read_buckets_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = local.export_bucket_arns
      }
    ]
  })
}
```

The IAM policy resource then consumes the local:

```hcl
resource "aws_iam_policy" "read_order_buckets" {
  name   = "${local.name_prefix}-read-buckets"
  policy = local.read_buckets_policy
}
```

This keeps the resource body readable. The policy structure has a name, and the ARN list has a name. Reviewers can inspect the local values without reading a long nested expression inside the resource.

Locals can also prepare values for scripts through outputs. The next article covers outputs in detail; for now, an output is a named value Terraform publishes for a human or script:

```hcl
locals {
  export_upload_prefix = "s3://${aws_s3_bucket.orders_exports.bucket}/daily/"
}

output "export_upload_prefix" {
  description = "S3 prefix used by the daily export upload job."
  value       = local.export_upload_prefix
}
```

After apply, a deployment job can read the output instead of reimplementing the string:

```bash
upload_prefix="$(terraform output -raw export_upload_prefix)"
aws s3 cp ./exports "${upload_prefix}" --recursive
```

`-raw` returns the output as a plain string, `upload_prefix` stores the applied S3 destination, and `--recursive` uploads every file under `./exports` to that prefix. If the output is `s3://devpolaris-orders-api-prod-exports/daily/`, the resolved command uploads local export files under that S3 prefix.

The AWS CLI output for one uploaded file would look similar to this:

```console
upload: exports/orders-2026-06-28.csv to s3://devpolaris-orders-api-prod-exports/daily/orders-2026-06-28.csv
```

The local holds the naming rule, the output publishes the result, and the script consumes the applied value.

## Reading Locals in the Plan
<!-- section-summary: Locals appear in plans through the resources and outputs that consume their evaluated values. -->

Locals are expressions inside the module. Terraform shows their evaluated results through the arguments that consume them. The plan shows the final bucket name or tag map through the resource, with no separate local object.

A plan might show:

```console
  + resource "aws_s3_bucket" "orders_exports" {
      + bucket = "devpolaris-orders-api-prod-exports"
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "service"     = "orders-api"
        }
    }
```

The bucket name came from `local.exports_bucket_name`. The tags came from `local.common_tags`. If the output is wrong, trace backward from the resource argument to the local expression and then to the variable values.

`terraform console` can help during expression testing. In a working directory, it lets you evaluate expressions such as `local.common_tags` or `merge(local.common_tags, { owner = "orders-team" })`. It works as a scratchpad for understanding values before you put them into a resource.

The console uses the current configuration and available state. If a local depends on a resource that has not been applied yet, the value may be unknown or unavailable in the way you expect. For pure input-based locals, the console is especially useful:

```bash
terraform console -var-file=dev.tfvars
```

The command opens Terraform's expression console with the same values from `dev.tfvars`. That lets you test pure locals with realistic dev inputs before running a full plan.

The console prompt can evaluate both locals:

```hcl
local.name_prefix
local.common_tags
```

```console
"devpolaris-orders-api-dev"
{
  "environment" = "dev"
  "managed_by" = "terraform"
  "service" = "orders-api"
}
```

The console output proves what the local values evaluate to before you place them in a resource. If the prefix or tags look wrong here, fix the local expression or input values before checking the full plan.

The plan remains the final review surface because it shows where those local values land in resource arguments.

## Helpful Locals and Hidden Indirection
<!-- section-summary: Locals help by naming real reusable logic, but too many locals can hide simple resource settings. -->

Locals work well for values that repeat, values that explain a rule, or expressions that are too large to read comfortably inside a resource. Naming and tags are common examples. JSON policy documents and filtered collections are also good candidates.

A single obvious setting used once usually belongs directly in the resource. A local named `bucket_acl = "private"` and used in one resource makes the reader jump to another file for no benefit.

Also avoid long chains of locals where each local only passes through another local. The reviewer should be able to trace a value in a few steps. If they have to open five expressions to understand a bucket name, the module needs simpler value flow.

Good locals make a module direct to review. Weak locals force the reader through extra indirection. The plan is the final check: can a reviewer connect the planned value back to the expression that created it?

A useful local usually has at least one of these jobs: it removes repeated logic, gives a meaningful name to a calculation, prepares a structured value for a resource, or creates a clean value for an output or module call. If a local does none of those jobs, the value probably belongs inline so reviewers have fewer places to open.

Local names should stay close to the domain. `common_tags`, `exports_bucket_name`, and `read_buckets_policy` tell the reader what the value means. Names such as `map1`, `computed`, or `final_value` force extra review work in every later resource.

## Putting It All Together
<!-- section-summary: Local values are internal names for expressions that keep repeated Terraform logic clear and consistent. -->

Local values sit between inputs and resources. Variables bring values into the module. Locals shape those values into names, tags, policies, lists, and maps. Resources and outputs consume the local values.

![Locals Summary](/content-assets/articles/article-iac-terraform-values-locals/locals-summary.png)

*The summary board keeps locals focused on clarity: one derived value, one clear name, and plan output that shows the result.*

The orders example used locals for a name prefix, common tags, bucket names, and an IAM policy document. Each local had a real job, and each was consumed by a resource. That is the standard you want.

Variables fit values supplied from outside. Locals fit values calculated and reused inside the module. Next, we will look at outputs, which publish useful values after Terraform has planned or applied the infrastructure.

---

**References**

- [Terraform local values](https://developer.hashicorp.com/terraform/language/values/locals) - HashiCorp explains `locals` blocks, `local.<name>` references, and cases where locals help avoid repetition.
- [Terraform expressions](https://developer.hashicorp.com/terraform/language/expressions) - HashiCorp describes how Terraform evaluates references, functions, and calculated values.
- [References to values](https://developer.hashicorp.com/terraform/language/expressions/references) - HashiCorp documents how references to variables, locals, resources, and outputs create value paths.
- [merge function](https://developer.hashicorp.com/terraform/language/functions/merge) - HashiCorp documents combining maps and objects, which is the tag-map pattern used in this article.
- [jsonencode function](https://developer.hashicorp.com/terraform/language/functions/jsonencode) - HashiCorp documents converting Terraform values into JSON strings for policy documents.
- [terraform console](https://developer.hashicorp.com/terraform/cli/commands/console) - HashiCorp documents the expression console used to test local values.
- [terraform output](https://developer.hashicorp.com/terraform/cli/commands/output) - HashiCorp documents `-raw` and `-json` output forms used by scripts.

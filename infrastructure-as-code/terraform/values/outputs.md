---
title: "Output Values"
description: "Expose important information from your Terraform configuration so operators and other modules can use it."
overview: "Output values are the data a Terraform module publishes after planning and applying. This article shows where outputs are declared, how they consume resource attributes, how parent modules read them, and how output changes appear in plans."
tags: ["outputs", "output values", "modules", "terraform", "hcl"]
order: 3
id: article-iac-terraform-values-outputs
---

## Table of Contents

1. [What Outputs Are For](#what-outputs-are-for)
2. [Declaring Outputs](#declaring-outputs)
3. [Outputs Consuming Resource Attributes](#outputs-consuming-resource-attributes)
4. [Parent Modules and Automation Consuming Outputs](#parent-modules-and-automation-consuming-outputs)
5. [Outputs in Plan and Apply Output](#outputs-in-plan-and-apply-output)
6. [Sensitive Outputs and State](#sensitive-outputs-and-state)
7. [Putting It All Together](#putting-it-all-together)

## What Outputs Are For
<!-- section-summary: Outputs publish useful module results so humans, parent modules, and automation do not need to guess resource names or IDs. -->

An **output value** is a named value a Terraform module publishes. Outputs often expose IDs, ARNs, URLs, bucket names, subnet lists, role names, and other values that another module or tool needs after apply.

For a root module, outputs appear in CLI output and can be read with `terraform output`. For a child module, outputs are available as attributes on the module object. If a network module outputs `private_subnet_ids`, an app module can consume `module.network.private_subnet_ids`.

Outputs matter because provider-generated values are often unavailable until apply. A database endpoint, load balancer DNS name, or bucket ARN should come from Terraform's state instead of a copied note in a wiki.

## Declaring Outputs
<!-- section-summary: An output block gives a result a name, description, value expression, and optional flags. -->

Outputs usually live in `outputs.tf`:

```hcl
output "bucket_name" {
  description = "Name of the S3 bucket that stores service logs."
  value       = aws_s3_bucket.logs.bucket
}

output "bucket_arn" {
  description = "ARN of the S3 bucket for IAM policy wiring."
  value       = aws_s3_bucket.logs.arn
}

output "log_group_name" {
  description = "CloudWatch log group used by the application."
  value       = aws_cloudwatch_log_group.app.name
}
```

The output name is the public name. The value expression can read resource attributes, local values, variables, functions, and module outputs. The description should explain who uses the value or why it is exposed.

## Outputs Consuming Resource Attributes
<!-- section-summary: Outputs usually consume resource attributes, so they create a visible path from managed infrastructure to downstream users. -->

Here is the resource file that feeds those outputs:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.log_bucket_name
  tags   = local.common_tags
}

resource "aws_cloudwatch_log_group" "app" {
  name              = local.app_log_group
  retention_in_days = var.retention_days
  tags              = local.common_tags
}
```

The output value path is direct:

```hcl
output "bucket_arn" {
  value = aws_s3_bucket.logs.arn
}
```

That output consumes the S3 bucket's `arn` attribute. Terraform records the final ARN in state after apply, then makes it available to the root module, parent modules, and `terraform output`.

When an output exposes a collection, keep the shape useful for callers:

```hcl
output "bucket_summary" {
  description = "Bucket identifiers used by deployment and IAM modules."
  value = {
    name = aws_s3_bucket.logs.bucket
    arn  = aws_s3_bucket.logs.arn
  }
}
```

This can be cleaner than publishing many tiny outputs when the values travel together.

## Parent Modules and Automation Consuming Outputs
<!-- section-summary: Child module outputs are consumed through module.name.output_name references, while root outputs can be consumed by CI and operators. -->

A parent module can read child outputs:

```hcl
module "logs" {
  source = "./modules/log-bucket"

  environment  = var.environment
  service_name = "billing"
}

resource "aws_iam_policy" "log_reader" {
  name = "billing-log-reader"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          module.logs.bucket_arn,
          "${module.logs.bucket_arn}/*"
        ]
      }
    ]
  })
}
```

The IAM policy consumes `module.logs.bucket_arn`. That creates a dependency from the policy to the bucket output. The output did not create a new cloud resource, but it carried a resource attribute across the module boundary.

Automation can read root outputs after apply:

```bash
terraform output -raw bucket_name
```

A deployment job can use that value to upload static files to the right bucket. That is safer than hardcoding the bucket name in the pipeline.

## Outputs in Plan and Apply Output
<!-- section-summary: Terraform plans show output additions and changes so reviewers can see what downstream consumers will receive. -->

When the bucket is new, the plan shows output values that are known and unknown:

```hcl
Changes to Outputs:
  + bucket_arn      = (known after apply)
  + bucket_name     = "dp-billing-prod-logs"
  + bucket_summary  = {
      + arn  = (known after apply)
      + name = "dp-billing-prod-logs"
    }
  + log_group_name  = "/aws/app/dp-billing-prod"
```

The bucket name is known because it came from variables and locals. The ARN is known after apply because AWS returns the final ARN through the provider after the bucket exists.

After apply, `terraform output` shows the stored values:

```hcl
bucket_arn = "arn:aws:s3:::dp-billing-prod-logs"
bucket_name = "dp-billing-prod-logs"
bucket_summary = {
  "arn" = "arn:aws:s3:::dp-billing-prod-logs"
  "name" = "dp-billing-prod-logs"
}
log_group_name = "/aws/app/dp-billing-prod"
```

Output changes deserve review because they may break downstream modules, CI jobs, dashboards, or documentation that reads those names.

## Sensitive Outputs and State
<!-- section-summary: Sensitive outputs hide CLI display but still require careful state protection. -->

You can mark an output as sensitive:

```hcl
variable "database_password" {
  type      = string
  sensitive = true
}

output "database_password" {
  description = "Bootstrap database password for a temporary training environment."
  value       = var.database_password
  sensitive   = true
}
```

Terraform hides the value in normal CLI output. That helps avoid accidental terminal and CI log exposure. The value can still live in state if Terraform needs it for an output or resource argument, so the state backend must be protected with strong access control and encryption.

:::expand[Output contracts are module APIs]{kind="pattern"}
Changing an output name is like changing a function return field. Every parent module, pipeline, and script that reads it may fail. That is why shared modules should treat output names as stable contracts.

When you need to replace an output, publish the new output first and leave the old one in place for a release or two. Update callers. Then remove the old output intentionally. This mirrors normal API deprecation work, but the users are Terraform modules and automation jobs.

The same idea applies to output shape. Changing a string output into an object can be useful, but it is a breaking change for callers that expect a string.
:::

## Putting It All Together
<!-- section-summary: Outputs complete the value path by publishing selected resource attributes and derived values to callers. -->

Outputs are the exit points of a module. Variables bring values in. Locals and resources use those values. Outputs publish the results that humans, parent modules, and automation need.

Good outputs have clear names, useful descriptions, stable shapes, and direct value expressions. During review, trace the output back to the resource attribute it consumes and forward to the module or job that will read it.

For official reference, use Terraform's docs for [output values](https://developer.hashicorp.com/terraform/language/values/outputs), [references to values](https://developer.hashicorp.com/terraform/language/expressions/references), and [sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data).

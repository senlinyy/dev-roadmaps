---
title: "Resources"
description: "Understand how resource blocks work in Terraform, how they map to real cloud infrastructure, how their lifecycle works, and how Terraform decides what to do with them."
overview: "A resource block is the Terraform configuration for one managed infrastructure object. This article shows resource syntax, where variables and locals are consumed, how resource attributes feed other resources and outputs, and how those values appear in plan output."
tags: ["resources", "lifecycle", "configuration", "terraform", "hcl"]
order: 2
id: article-iac-terraform-config-resources
---

## Table of Contents

1. [What a Resource Is](#what-a-resource-is)
2. [The Resource Block Shape](#the-resource-block-shape)
3. [Variables and Locals Feeding Resources](#variables-and-locals-feeding-resources)
4. [Resource Attributes Feeding Other Resources](#resource-attributes-feeding-other-resources)
5. [Plan Output for Create, Update, and Replace](#plan-output-for-create-update-and-replace)
6. [Resources and State](#resources-and-state)
7. [Putting It All Together](#putting-it-all-together)

## What a Resource Is
<!-- section-summary: A Terraform resource is a managed object declaration that Terraform binds to a real infrastructure object through state. -->

A **resource** is Terraform's declaration for a real infrastructure object it manages. An S3 bucket, EC2 instance, VPC subnet, IAM role, database, DNS record, and Kubernetes namespace can all be resources when a provider supports them.

The resource block has two identities. Terraform has a local address such as `aws_s3_bucket.logs`. The provider has a real object ID such as the bucket name `dp-billing-prod-logs` or an ARN. Terraform state connects those two identities after apply.

This is the big difference between resources and data sources. A resource is lifecycle ownership. Terraform can create it, update it, replace it, destroy it, and store its attributes in state. A data source is a read-only lookup.

## The Resource Block Shape
<!-- section-summary: A resource block names the provider resource type, local Terraform name, and arguments that configure the real object. -->

Here is a basic resource in `main.tf`:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "dp-billing-prod-logs"

  tags = {
    service     = "billing"
    environment = "prod"
    managed_by  = "terraform"
  }
}
```

`resource` is the block type. `"aws_s3_bucket"` is the provider resource type. `"logs"` is the local Terraform name. Together they form the address:

```hcl
aws_s3_bucket.logs
```

The arguments inside the block configure the real bucket. The provider decides which arguments exist, which ones are required, which ones are optional, and which ones force replacement when they change.

Real modules usually avoid hardcoded values in resources. They use variables and locals so the same module can serve multiple environments.

## Variables and Locals Feeding Resources
<!-- section-summary: Resource arguments often consume variables and locals so names, tags, sizes, and settings stay consistent across environments. -->

In `variables.tf`, the module declares caller inputs:

```hcl
variable "environment" {
  type = string
}

variable "service_name" {
  type = string
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
```

In `locals.tf`, it shapes those inputs:

```hcl
locals {
  bucket_name = "dp-${var.service_name}-${var.environment}-logs"

  tags = merge(
    {
      service     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )
}
```

In `main.tf`, the resource consumes the local values:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name
  tags   = local.tags
}
```

The path is clear. Variables feed locals. Locals feed resource arguments. The plan shows the final evaluated values.

```hcl
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }
```

## Resource Attributes Feeding Other Resources
<!-- section-summary: Resource attributes can be consumed by other resources, which gives Terraform both a value and a dependency. -->

Resources also produce attributes. Some come from configuration, such as the bucket name. Some come from the provider after creation, such as the final ARN or ID.

Another resource can consume those attributes:

```hcl
resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "log_bucket_arn" {
  description = "ARN used by IAM policies that read billing logs."
  value       = aws_s3_bucket.logs.arn
}
```

`aws_s3_bucket_public_access_block.logs.bucket` consumes `aws_s3_bucket.logs.id`. The output consumes `aws_s3_bucket.logs.arn`. Terraform reads those references as dependencies, so the access block and output wait for the bucket values.

The plan shows which values are already known:

```hcl
  # aws_s3_bucket_public_access_block.logs will be created
  + resource "aws_s3_bucket_public_access_block" "logs" {
      + bucket                  = (known after apply)
      + block_public_acls       = true
      + block_public_policy     = true
      + ignore_public_acls      = true
      + restrict_public_buckets = true
    }

Changes to Outputs:
  + log_bucket_arn = (known after apply)
```

`bucket` and `log_bucket_arn` are known after apply because they depend on provider-returned attributes from the bucket.

## Plan Output for Create, Update, and Replace
<!-- section-summary: The plan tells you whether Terraform will create, update in place, replace, or destroy a resource. -->

Terraform uses symbols to show actions. A `+` means create. A `~` means update in place. A `-/+` means replace. A `-` means destroy.

If a tag changes, the bucket can usually update in place:

```hcl
  # aws_s3_bucket.logs will be updated in-place
  ~ resource "aws_s3_bucket" "logs" {
      ~ tags = {
          + "cost_center" = "finops-42"
            "environment" = "prod"
            "managed_by"  = "terraform"
            "service"     = "billing"
        }
    }
```

If an argument cannot be changed in place, Terraform plans a replacement:

```hcl
  # aws_instance.app must be replaced
-/+ resource "aws_instance" "app" {
      ~ availability_zone = "us-east-1a" -> "us-east-1b"
    }
```

Replacement deserves careful review because it can mean downtime, data movement, new names, or dependency changes. Some replacements are safe when the system has load balancer health checks and `create_before_destroy`. Others need a migration plan.

:::expand[Provider schemas decide update or replace]{kind="design"}
Terraform Core compares configuration, state, and refreshed provider data. The provider schema tells Terraform which attributes can update in place and which changes require replacement. Cloud APIs create this constraint. Some APIs let you patch a field. Other fields are fixed at creation time.

This is why the same kind of change can behave differently across resources. A tag update is often in-place. A storage engine change for a database may require replacement. A subnet change for a server may require replacement because the provider cannot move the object between subnets directly.

The plan is the source of truth for the proposed action. Always check action symbols and replacement notes before apply.
:::

## Resources and State
<!-- section-summary: After apply, state records the provider object attributes that belong to each Terraform resource address. -->

After apply, Terraform stores resource attributes in state. That state record lets the next plan know that `aws_s3_bucket.logs` already manages `dp-billing-prod-logs`.

If someone deletes the bucket outside Terraform, the next refreshed plan can detect that the state record points to a missing object and propose recreation. If someone changes tags in the console, the next plan can detect drift and propose an update unless lifecycle rules ignore that attribute.

State also explains why resource address changes matter. Renaming `aws_s3_bucket.logs` to `aws_s3_bucket.service_logs` changes Terraform's address. Use a `moved` block when the real object should keep being managed under the new address.

## Putting It All Together
<!-- section-summary: Resource review means tracing input values into resource arguments, resource attributes into dependencies, and plan actions into state changes. -->

A resource block is where Terraform takes ownership. Variables and locals feed resource arguments. Resource attributes feed other resources and outputs. The plan shows whether Terraform will create, update, replace, or destroy the managed object.

For official reference, use Terraform's docs for [resources](https://developer.hashicorp.com/terraform/language/resources), [resource block syntax](https://developer.hashicorp.com/terraform/language/resources/syntax), [references to values](https://developer.hashicorp.com/terraform/language/expressions/references), and [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan).

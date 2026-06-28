---
title: "Resources"
description: "Understand how resource blocks work in Terraform, how they map to real cloud infrastructure, how their lifecycle works, and how Terraform decides what to do with them."
overview: "A resource block is the Terraform configuration for one managed infrastructure object. This article shows resource syntax, resource addresses, references between resources, and how resource changes appear in plan output."
tags: ["resources", "lifecycle", "configuration", "terraform", "hcl"]
order: 3
id: article-iac-terraform-config-resources
aliases:
  - infrastructure-as-code/terraform/configuration/resources.md
---

## Table of Contents

1. [The First Managed Object](#the-first-managed-object)
2. [Resource Addresses and Real IDs](#resource-addresses-and-real-ids)
3. [Resource Values Before Reuse](#resource-values-before-reuse)
4. [Resource Attributes Feeding Other Blocks](#resource-attributes-feeding-other-blocks)
5. [Create, Update, Replace, and Destroy in Plans](#create-update-replace-and-destroy-in-plans)
6. [State and Ownership](#state-and-ownership)
7. [Putting It All Together](#putting-it-all-together)

## The First Managed Object
<!-- section-summary: A Terraform resource block declares one infrastructure object that Terraform should manage through a provider. -->

A **resource** is Terraform's declaration for one managed infrastructure object. It might be an S3 bucket, VPC subnet, IAM role, database, DNS record, Kubernetes namespace, GitHub repository environment, or another provider-supported object.

![Resource Lifecycle](/content-assets/articles/article-iac-terraform-config-resources/resource-lifecycle.png)

*The lifecycle view shows a resource moving through creation, refresh, update, replacement, and destroy actions.*

The first example is one bucket for `devpolaris-orders-api` exports. The smallest useful resource block looks like this:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-dev-exports"
}
```

The block type is `resource`. The provider resource type is `aws_s3_bucket`. The local Terraform name is `orders_exports`. The `bucket` argument configures the real bucket name through the AWS provider.

The tag map adds ownership, environment, and automation context for real teams:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-dev-exports"

  tags = {
    service     = "orders-api"
    environment = "dev"
    managed_by  = "terraform"
  }
}
```

This is a complete first resource block. The `tags` map closes first, and then the resource block closes. That small detail matters because many beginner Terraform errors come from losing track of where a nested map or nested block ends.

This resource gives Terraform lifecycle ownership. Terraform can plan to create it, update it, replace it, or destroy it. That ownership is the main difference from a read-only lookup block, which only reads existing information from a provider.

The official [Terraform resources documentation](https://developer.hashicorp.com/terraform/language/resources) describes resources as infrastructure objects Terraform manages. The provider decides the actual object type. Terraform Core tracks the address, dependency graph, and state. The provider knows the API calls and the schema for the object.

That split shows up as a resource grows. An S3 bucket might need separate resource blocks for versioning, lifecycle configuration, public access blocks, encryption, or bucket policy depending on the AWS provider schema. Each block has its own address and plan actions, even though all of them affect one real bucket area in AWS.

## Resource Addresses and Real IDs
<!-- section-summary: Terraform uses a resource address in code and state, while the provider uses a real platform ID. -->

Every resource has a Terraform address. The bucket address is:

```hcl
aws_s3_bucket.orders_exports
```

The real AWS object has provider-specific identifiers. For S3, the bucket name is globally visible, and AWS also exposes an ARN such as `arn:aws:s3:::devpolaris-orders-api-dev-exports`. Terraform state connects the Terraform address to the real object and its provider-returned attributes.

That connection matters during the next plan. Terraform can tell that `aws_s3_bucket.orders_exports` already maps to a real bucket. If the tag map changes, Terraform plans an update to that same bucket instead of trying to create a second one.

Stable local names help resource review. A local name such as `orders_exports` tells reviewers what role the resource plays inside the module. A vague name such as `bucket1` hides meaning in later references and plans.

Renaming the local Terraform name changes the resource address. If you rename `aws_s3_bucket.orders_exports` to `aws_s3_bucket.exports`, Terraform may plan to destroy the old address and create a new one unless you tell Terraform the address moved. Modern Terraform supports `moved` blocks for this kind of refactor:

```hcl
moved {
  from = aws_s3_bucket.orders_exports
  to   = aws_s3_bucket.exports
}
```

That block lets the code read more clearly while preserving ownership of the same remote object. Address changes deserve review because state uses addresses as the map between code and real infrastructure.

## Resource Values Before Reuse
<!-- section-summary: A first resource can use direct values, then later articles show how variables and locals reduce repetition. -->

A first resource can use direct values in the block. That keeps the shape easy to read while the main concept is still new:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-dev-exports"

  tags = {
    service     = "orders-api"
    environment = "dev"
    managed_by  = "terraform"
  }
}
```

Those direct values are fine for learning because the reader can see the complete object in one place. The limit appears as soon as the same pattern needs development, staging, and production. Copying this block three times and changing strings by hand creates review noise and mistakes.

The next articles introduce **input variables**, **local values**, and **outputs** to solve that reuse problem. For this article, the resource idea stays simple: arguments inside the block turn into settings for the real object, and reviewers should be able to read those settings before approving the plan.

Production conventions still matter at this level. Tags can carry cost center, owner, data classification, environment, and automation ownership. Names can include stable service and environment parts. Even before variables arrive, a resource block should show the real intent clearly enough for another engineer to review it.

## Resource Attributes Feeding Other Blocks
<!-- section-summary: Other resources and outputs can consume attributes returned by a managed resource. -->

Resources often produce values that other blocks need. The bucket has an ID that another S3 resource can use. Terraform exposes that value as `aws_s3_bucket.orders_exports.id` after the provider knows it.

```hcl
resource "aws_s3_bucket_versioning" "orders_exports" {
  bucket = aws_s3_bucket.orders_exports.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

The versioning resource references the bucket ID. Terraform uses that reference in two ways. It sends the correct bucket identifier into the AWS provider, and it sees that versioning depends on the bucket.

An **output** is a named value Terraform publishes after planning or applying. Outputs can publish resource attributes too:

```hcl
output "exports_bucket_name" {
  value = aws_s3_bucket.orders_exports.bucket
}
```

This output lets a deployment job or operator use the final bucket name without copying it into a separate note.

Resource attributes can be configured values, provider-computed values, or a mix of both. A bucket name is usually known from configuration. A load balancer DNS name, database endpoint, generated password ARN, or server private IP may be known only after the provider creates or reads the object. Terraform marks those values in the plan so reviewers understand which downstream values will appear later.

Copying provider IDs into other resources by hand creates avoidable drift. If an IAM policy needs a bucket ARN, the policy should reference the bucket ARN. If a service needs an existing subnet ID from a read-only lookup, the service should reference that lookup. The reference keeps the configuration reviewable and gives Terraform the dependency information it needs.

## Create, Update, Replace, and Destroy in Plans
<!-- section-summary: Terraform plans show whether a resource will be created, updated, replaced, or destroyed before apply. -->

The plan is where resource lifecycle shows up. A first run may show a create:

![Update Replace Decision](/content-assets/articles/article-iac-terraform-config-resources/update-replace-decision.png)

*The decision view shows why provider rules decide whether Terraform can update in place or must replace an object.*

```console
  # aws_s3_bucket.orders_exports will be created
  + resource "aws_s3_bucket" "orders_exports" {
      + bucket = "devpolaris-orders-api-dev-exports"
    }
```

The `+` action means Terraform plans to create the bucket, and the `bucket` line shows the exact evaluated name the provider will receive.

A tag change may show an update:

```console
  # aws_s3_bucket.orders_exports will be updated in-place
  ~ resource "aws_s3_bucket" "orders_exports" {
      ~ tags = {
          + "cost_center" = "platform"
        }
    }
```

Some argument changes require replacement because the provider or platform cannot modify that setting in place. Terraform marks replacement clearly in the plan. Replacements and destroys are review points, especially for data stores, network resources, and identities.

The official [resource block reference](https://developer.hashicorp.com/terraform/language/block/resource) explains resource syntax and supported meta-arguments. The provider documentation explains which arguments exist and which changes require replacement for each resource type.

The provider schema decides whether a change is in place or replacement. Terraform Core compares configuration, refreshed state, and provider rules. A tag update often stays in place. A database engine change, subnet change, or immutable name change may require replacement because the platform API cannot patch that field on the existing object.

A good review reads both action symbols and important attribute lines. A `+` create can still be risky if it creates broad IAM permissions. A `~` update can still affect production behavior if it changes a security rule. A `-/+` replacement deserves special attention because it can involve downtime, a new identity, data migration, or dependent resource changes.

The plan can verify the whole resource path:

```bash
terraform plan -out=tfplan
terraform show tfplan
```

`plan -out=tfplan` saves the exact plan reviewers approved, and `terraform show tfplan` displays that saved plan later. A first saved plan usually includes output like this:

```console
Saved the plan to: tfplan

Plan: 1 to add, 0 to change, 0 to destroy.
```

`terraform show tfplan` should show the same resource actions from that saved plan file:

```console
  # aws_s3_bucket.orders_exports will be created
  + resource "aws_s3_bucket" "orders_exports" {
      + bucket = "devpolaris-orders-api-dev-exports"
    }
```

Reviewers should scan action symbols before approval: `+` creates, `~` updates in place, `-/+` replaces, and `-` destroys. The saved plan helps the apply step use the same actions that were reviewed.

For automation, `terraform show -json tfplan` can feed policy checks or plan summarizers. Real projects protect plan artifacts because they can include sensitive values.

## State and Ownership
<!-- section-summary: State records Terraform’s ownership of resources, so teams should manage state carefully and avoid duplicate ownership. -->

After apply, Terraform records managed resources in state. State is how Terraform remembers that `aws_s3_bucket.orders_exports` belongs to this configuration. It also stores attributes the provider returned.

For a lab, the state record can be inspected by address:

```bash
terraform state show aws_s3_bucket.orders_exports
```

An excerpt of the output should point back to the managed bucket:

```console
# aws_s3_bucket.orders_exports:
resource "aws_s3_bucket" "orders_exports" {
    bucket = "devpolaris-orders-api-dev-exports"
    id     = "devpolaris-orders-api-dev-exports"
    tags   = {
        "environment" = "dev"
        "managed_by"  = "terraform"
        "service"     = "orders-api"
    }
}
```

That output is Terraform showing the state entry for the address. It helps the team confirm which real provider object Terraform thinks it owns.

Ownership should stay clear. If one Terraform stack owns the bucket, another stack should usually read it through a read-only lookup or a published output instead of declaring the same bucket as a second resource. Two stacks trying to manage the same object can fight each other.

Sometimes teams adopt an existing manually created resource into Terraform. That uses import, followed by careful configuration that matches the real object. This article only needs the beginner idea: declaring a resource means Terraform is taking responsibility for one real object. The later state articles slow down on state files, remote backends, locking, import, and direct state commands.

Provider verification still matters after apply. A team may check the cloud console, CLI, audit log, or application behavior to confirm the resource works as intended. State tells Terraform what it owns; verification tells the team whether the managed object works for the service.

## Putting It All Together
<!-- section-summary: Resources are the managed-object layer where Terraform code, provider APIs, state, and plans meet. -->

A resource block gives Terraform ownership of one real object. The local address identifies it in code and state. The provider type tells Terraform which provider handles it. Arguments send settings to the provider. Attributes return values that other blocks can consume.

![Resources Summary](/content-assets/articles/article-iac-terraform-config-resources/resources-summary.png)

*The summary board ties resource syntax, addresses, references, plan actions, and ownership together.*

The beginner practice is to trace the whole lifecycle. A resource change leads to a plan, the plan shows whether Terraform will create or update it, apply follows only after the plan matches the intent, and outputs plus provider verification explain what changed.

Resource blocks are where Terraform file changes reach real infrastructure. Every resource block can change a real object, so every resource deserves readable values and careful plan review.

---

**References**

- [Terraform resources](https://developer.hashicorp.com/terraform/language/resources) - Official overview of resources as managed infrastructure objects.
- [Resource block reference](https://developer.hashicorp.com/terraform/language/block/resource) - Documents resource block syntax, labels, arguments, and meta-arguments.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains how Terraform maps resource addresses to real infrastructure objects.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan), [terraform show](https://developer.hashicorp.com/terraform/cli/commands/show), and [terraform state show](https://developer.hashicorp.com/terraform/cli/commands/state/show) - CLI references for reviewing planned resource actions and inspecting state.
- [AWS provider aws_s3_bucket](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) and [aws_s3_bucket_versioning](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning) - Provider resource references for the S3 examples used here.

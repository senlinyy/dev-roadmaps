---
title: "Providers, Resources, and Data Sources"
description: "Use providers, resources, and data sources to tell which APIs Terraform uses, which objects it owns, and which existing facts it only reads."
overview: "A Terraform directory becomes much easier to review when you can separate three jobs: the provider talks to an API, resources describe objects Terraform manages, and data sources read existing information without taking ownership."
tags: ["terraform", "opentofu", "providers", "resources", "data-sources"]
order: 2
id: article-infrastructure-as-code-terraform-providers-resources-data-sources
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Providers](#providers)
3. [Provider Configuration](#provider-configuration)
4. [Resources](#resources)
5. [References](#references)
6. [Data Sources](#data-sources)
7. [Ownership](#ownership)
8. [Sample Directory](#sample-directory)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The orders team has a Terraform workflow now. They can initialize a directory, validate it, and read a plan. The next problem is reading the configuration itself.

A beginner opens the first Terraform directory and sees several block types:

- A `terraform` block names `hashicorp/aws`.
- A `provider` block sets `eu-west-2`.
- A `resource` block creates an invoice bucket.
- A `data` block reads the current AWS account.
- One resource references another value with a long dotted name.

All of those blocks use the same language, but they do different jobs. If a reviewer cannot tell which block owns infrastructure and which block only reads information, a small change becomes hard to judge.

The useful Terraform mental model is three nouns: providers are API bridges, resources are managed objects, and data sources are read-only lookups.

## Providers

A provider is the plugin Terraform uses to talk to a remote system. Terraform itself does not know every AWS, Azure, GCP, GitHub, Cloudflare, or Kubernetes API. Providers add that knowledge.

The provider requirement says which plugin the module needs:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

The local name is `aws`. The source is `hashicorp/aws`. The version constraint tells Terraform which provider versions are compatible with this configuration. During `terraform init`, Terraform installs the provider and records the selected version in the dependency lock file.

This is the first place where review matters. A provider upgrade can change behavior, add arguments, deprecate arguments, or alter defaults. Provider changes deserve the same attention as application dependency changes.

OpenTofu uses providers too. The registry source and provider ecosystem can differ depending on the project setup, but the mental model is the same: the core tool loads provider plugins to reach real APIs.

## Provider Configuration

The provider requirement installs the plugin. The provider configuration tells that plugin how to talk to the target system.

For AWS, a simple provider block might set the region:

```hcl
provider "aws" {
  region = "eu-west-2"

  default_tags {
    tags = {
      project    = "devpolaris-orders"
      managed_by = "terraform"
    }
  }
}
```

This block does not create a bucket. It configures the AWS provider instance used by resources and data sources. The region matters because a plan against the wrong region is not a harmless typo. It can create resources in the wrong place or fail to find existing ones.

Credentials usually should not be written directly into provider blocks. Provider documentation commonly supports environment variables, profiles, workload identity, or other external credential mechanisms. Hardcoded access keys in `.tf` files create review and leak risk.

Some systems need multiple provider configurations. For example, a production root module might use one AWS provider configuration for application resources and another aliased provider for a shared networking account. That can be valid, but it raises the review bar because each resource must be clearly attached to the right provider configuration.

## Resources

A resource is an object Terraform manages. If a resource appears in configuration and state, Terraform may create it, update it, replace it, or destroy it to match the files.

Here is the invoice bucket:

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-orders-invoices-prod"

  tags = {
    service     = "orders-api"
    environment = "prod"
    owner       = "platform"
  }
}
```

The resource type is `aws_s3_bucket`. The local name is `orders_invoices`. Together they form the resource address `aws_s3_bucket.orders_invoices`. That address appears in plans, state, references, and imports.

The address is Terraform's name for the managed object. The bucket name is the provider's name for the real object. Those are related, but not the same. Renaming the local resource address can look like removing one managed object and adding another unless you also handle the state relationship.

That is one of the first non-obvious Terraform truths: names in Terraform files become part of Terraform memory. Choose resource names that describe the object's role, not temporary implementation details.

## References

Terraform configurations become useful when one block can refer to values from another block. References also help Terraform understand dependency order.

If an IAM policy needs the bucket ARN, do not rebuild the ARN string by hand:

```hcl
resource "aws_iam_policy" "invoice_writer" {
  name = "orders-api-invoice-writer"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.orders_invoices.arn}/*"
      }
    ]
  })
}
```

The important detail is `aws_s3_bucket.orders_invoices.arn`. That reference points to the bucket resource and a value the provider returns for it. Terraform can see that the policy depends on the bucket ARN.

References are safer than string guessing. They keep relationships visible in the graph Terraform plans from. They also reduce mistakes when a name changes in one place but not another.

## Data Sources

A data source reads information from a provider without making this configuration own the object's lifecycle.

The orders team might need the current AWS account ID and region for names, policies, or tags:

```hcl
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}
```

Those data sources do not create the account or region. They read facts from the configured provider. That makes the configuration less brittle than hardcoding `123456789012` or `eu-west-2` in many places.

Data sources are also useful when another team owns a shared object. If the platform team owns a DNS zone, the orders service may read the zone and create its own record. Reading the zone as data is different from importing the whole zone as a managed resource.

The gotcha is that data sources still depend on provider credentials and provider configuration. A data source against the wrong account can return the wrong object or no object at all. Read-only does not mean risk-free.

## Ownership

The distinction between resource and data source is really an ownership question.

| Terraform block | Job | Ownership meaning |
| --- | --- | --- |
| `provider` | Talk to an API | Configures where and how Terraform operates |
| `resource` | Manage an object | This configuration owns the object's lifecycle |
| `data` | Read an existing fact | This configuration needs information but does not own the object |

For the orders service, the invoice bucket belongs in a resource because the service owns its lifecycle. The current account ID belongs in a data source because the service needs the value but does not create the AWS account. A shared DNS hosted zone may also be a data source if another team owns it.

Ownership should be decided before syntax. A wrong resource block can give Terraform permission to destroy something this repository should only reference. A wrong data source can hide the fact that nobody is managing a required object. The block type is an operating decision.

## Sample Directory

Put the three jobs together in a small root module:

```text
infra/orders/prod/
  providers.tf
  data.tf
  s3.tf
  outputs.tf
```

`providers.tf` declares and configures the provider:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

`data.tf` reads context:

```hcl
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
```

`s3.tf` manages the bucket:

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-orders-invoices-prod"
}
```

The files are small, but the jobs are clear. The provider talks to AWS. The data sources read account and region facts. The resource manages the bucket.

## Putting It All Together

The orders team opened a Terraform directory and separated the blocks by job.

- Providers are the API bridge.
- Provider configuration sets target details such as region and sometimes aliases.
- Resources are objects Terraform owns and may change later.
- References connect managed objects without fragile string guessing.
- Data sources read existing facts without claiming lifecycle ownership.
- Ownership decisions come before block syntax.

Once those jobs are clear, a plan is easier to review. A resource addition means Terraform may create something. A data source addition means Terraform will read something. A provider change means the API target itself may have changed.

## What's Next

The next article follows values through a Terraform module. Variables bring outside choices in, locals name decisions inside the module, and outputs expose selected results after Terraform finishes.

---

**References**

- [Terraform provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements)
- [Terraform provider configuration](https://developer.hashicorp.com/terraform/language/providers/configuration)
- [Terraform resources](https://developer.hashicorp.com/terraform/language/resources)
- [Terraform data sources](https://developer.hashicorp.com/terraform/language/data-sources)

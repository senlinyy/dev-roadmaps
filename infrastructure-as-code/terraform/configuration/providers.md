---
title: "Providers"
description: "Configure Terraform providers so a module knows which AWS plugin to install, which account and region to use, and when provider aliases are needed."
overview: "Providers are the bridge between Terraform configuration and real APIs. This article follows the AWS provider from requirement, to configuration, to resource selection in a small orders environment."
tags: ["terraform", "aws", "providers", "configuration"]
order: 2
id: article-infrastructure-as-code-terraform-providers
---

## Table of Contents

1. [Why Providers Matter](#why-providers-matter)
2. [Provider Requirements](#provider-requirements)
3. [Provider Configuration](#provider-configuration)
4. [Credentials and Context](#credentials-and-context)
5. [Provider Aliases](#provider-aliases)
6. [How Resources Choose a Provider](#how-resources-choose-a-provider)
7. [Common First Mistakes](#common-first-mistakes)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Providers Matter

The orders team has written a Terraform file for a small AWS environment: one S3 bucket for uploads, one VPC, one public subnet, one security group, and one EC2 instance for a demo web service. The file looks harmless in review. The risky question is quieter: which AWS APIs will Terraform call, and which account and region will those calls use?

A provider answers that question. Terraform itself knows how to read configuration, compare desired objects with state, and build a plan. It does not contain the AWS API schema inside the core binary. The AWS provider plugin teaches Terraform about AWS resource types such as `aws_s3_bucket`, `aws_vpc`, `aws_security_group`, and `aws_instance`. It also holds the configuration Terraform needs before it can call AWS, such as the region and, indirectly, the credentials available to the run.

That makes provider configuration part of infrastructure design. A VPC block means something different when the provider points at `us-east-1` instead of `eu-west-1`. The same S3 bucket name might be available in one account and already taken in another. A plan can look syntactically correct while still targeting the wrong environment.

This article keeps the focus on the provider layer: how Terraform installs the AWS provider, how the module configures it, how credentials stay outside the files, and how aliases let one module talk to more than one AWS provider configuration.

## Provider Requirements

The provider requirement belongs in the top-level `terraform` block. It tells Terraform which provider source address the module depends on and which version range is acceptable.

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

The local name is `aws`. That name is how this module refers to the provider after installation. The source address is `hashicorp/aws`, which tells Terraform to install the AWS provider published under HashiCorp's namespace in the public Terraform Registry. The version constraint says this module expects a compatible version in the `6.x` line.

Those three fields show up during `terraform init`. Init reads the provider requirement, downloads a matching provider package, and records the selected version in the dependency lock file. The lock file matters because provider behavior can change across versions. A pull request that changes provider constraints or the lock file deserves the same careful review as a pull request that changes infrastructure blocks.

For AWS, the preferred local provider name is `aws` because AWS resource types start with that prefix. A resource type such as `aws_vpc` can then use the default AWS provider configuration without extra wiring. If you choose an unusual local name, reviewers have to work harder and some resources need an explicit provider selection.

## Provider Configuration

The requirement says which plugin this module needs. The provider block says how this module should use that plugin.

```hcl
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "orders"
      Environment = "dev"
    }
  }
}
```

The `region` setting affects regional AWS resources. The demo VPC, subnet, security group, and EC2 instance are regional, so this provider block points all of those resources at `us-east-1` unless a resource chooses another provider configuration. The S3 bucket is a global namespace service with regional placement rules, but the AWS provider still needs region context for API calls and bucket creation settings.

The `default_tags` block is provider-specific behavior from the AWS provider. It applies common tags to many AWS resources created through that provider configuration. This is useful for ownership and cost review because the tag policy is visible once, near the provider context, instead of repeated by hand in every resource.

Provider arguments are part of the module contract with the platform. A one-line region change can move the whole root module to another AWS region. A default tag change can affect many resources at once. A provider block should be reviewed before the resource blocks below it, because it sets the API context in which those resources operate.

## Credentials and Context

The provider block should not contain long-lived AWS access keys. Terraform files usually live in Git, and Git is the wrong place for secrets. The AWS provider can read credentials from the normal AWS credential chain available to the process that runs Terraform, such as environment variables, shared AWS config files, IAM Identity Center sessions, instance profiles, or a CI role.

That separation is important. The Terraform file can say, "use the AWS provider in `us-east-1`." The shell, developer workstation, or CI runner supplies the identity. Before running `plan` or `apply`, a team should know which identity is active.

For a local check, an operator might verify the caller outside Terraform:

```bash
aws sts get-caller-identity
```

That command does not configure Terraform by itself. It gives the person running Terraform a quick way to see which AWS account and principal their current environment can reach. Terraform will use the provider's credential search behavior during its own run.

In team workflows, this context is usually controlled by automation. A CI job assumes a deploy role for the intended account, sets the region, runs `terraform plan`, and stores the plan for review. The provider file still matters because it describes what the module expects from that runtime context.

## Provider Aliases

One provider block without an alias is the default provider configuration for that local name. Some modules need more than one configuration for the same provider. AWS examples include creating resources in two regions, reading a shared artifact from one account while creating resources in another, or managing a primary and secondary region for disaster recovery.

An aliased provider block gives a second configuration a name:

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "west"
  region = "us-west-2"
}
```

The first block is the default `aws` configuration. The second block is `aws.west`. A resource or data source can select the alias with the `provider` meta-argument:

```hcl
resource "aws_s3_bucket" "logs_west" {
  provider = aws.west

  bucket = "orders-dev-west-logs-example"
}
```

The provider selection is written without quotes because Terraform needs a direct provider configuration reference while it builds the dependency graph. Arbitrary expressions are not allowed there. This keeps provider choice visible during graph construction and plan review.

Aliases are powerful because they make multiple API contexts explicit. They also add review burden. Every aliased provider should answer a real question: which second account or region is this block using, and why does this root module need to touch it?

## How Resources Choose a Provider

Most AWS resources in a simple module do not need a `provider` line. Terraform uses the first word in the resource type as the local provider name. The type `aws_vpc` selects the default `aws` provider configuration. The same is true for `aws_subnet`, `aws_security_group`, `aws_instance`, and `aws_s3_bucket`.

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
```

This VPC uses the default `aws` provider configuration because its type starts with `aws_`. Terraform also knows that the VPC depends on the provider being configured before resource operations can happen.

When a resource chooses an alias, the selection becomes part of the resource's behavior:

```hcl
resource "aws_vpc" "west" {
  provider = aws.west

  cidr_block = "10.20.0.0/16"
}
```

Now the VPC belongs to the aliased AWS provider configuration. In plan review, the resource address still starts with `aws_vpc`, but the resource body shows it is using `aws.west`. That line changes where Terraform sends the API call.

Provider wiring becomes especially important once modules enter the design. A root module can pass provider configurations to child modules, and the child module can declare which provider names it expects. The later module article returns to that pattern. For now, read provider blocks as the context layer for the resources in the current root module.

## Common First Mistakes

**Committing credentials in provider configuration.** Keep AWS access keys out of Terraform files. Let the AWS provider read credentials from the runtime environment.

**Ignoring the lock file.** Provider version changes can change plan behavior. Review `.terraform.lock.hcl` changes when provider constraints change.

**Changing region casually.** A region change can point the same resource blocks at a different AWS region. Treat it as an environment-level change.

**Using aliases without a clear reason.** An alias should make a second account or region explicit. Extra aliases make review harder when every resource still belongs in one region.

**Forgetting which provider a resource selected.** A resource without `provider = ...` uses the default provider configuration inferred from the resource type. A resource with `provider = aws.west` uses the alias.

## Putting It All Together

The provider layer answers the first review question for the orders module: which AWS API context is Terraform using?

- The `required_providers` block tells Terraform to install the AWS provider from `hashicorp/aws` within an accepted version range.
- `terraform init` selects and installs a provider version, then records it in the dependency lock file.
- The default `provider "aws"` block sets context such as region and provider-specific defaults.
- Credentials come from the runtime environment, not from hardcoded secrets in the Terraform files.
- Aliased provider blocks create additional AWS contexts when a module needs more than one region or account.
- Resource types such as `aws_vpc` and `aws_instance` use the default AWS provider unless they explicitly select an alias.

With that model, a reviewer can read provider configuration before reading the VPC, S3 bucket, security group, or EC2 instance. The provider tells them where those later resource blocks will act.

## What's Next

The next article moves from API context to owned infrastructure. Providers let Terraform talk to AWS. Resource blocks tell Terraform which AWS objects this module is responsible for creating, changing, and deleting.

---

**References**

- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - Terraform language reference for provider source addresses, local names, version constraints, initialization, and dependency locks.
- [Provider block reference](https://developer.hashicorp.com/terraform/language/block/provider) - Terraform language reference for provider configuration blocks and aliases.
- [Provider meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/provider) - Terraform language reference for selecting a specific provider configuration from a resource or data block.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Terraform Registry documentation for the AWS provider, including authentication, region, and provider-specific settings.

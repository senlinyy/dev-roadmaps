---
title: "Configuration Blocks"
description: "Read a Terraform configuration by separating provider setup, managed AWS resources, read-only data sources, ownership, and the references between them."
overview: "This orientation article gives the configuration submodule one complete map before the deeper provider, resource, reference, data source, and meta-argument articles."
tags: ["terraform", "opentofu", "aws", "providers", "resources", "data-sources"]
order: 1
id: article-infrastructure-as-code-terraform-providers-resources-data-sources
aliases:
  - infrastructure-as-code/terraform/providers-resources-data-sources.md
---

## Table of Contents

1. [Why Block Jobs Matter](#why-block-jobs-matter)
2. [Provider Configuration](#provider-configuration)
3. [Resources](#resources)
4. [Data Sources](#data-sources)
5. [Ownership](#ownership)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## Why Block Jobs Matter

Open a Terraform file for a small AWS web environment and the blocks can look similar at first. They all use braces, labels, and arguments. But they do different jobs. One block chooses the AWS provider. Another block creates a VPC. Another reads the current AWS account. Another exposes an instance ID after apply.

Reading Terraform starts with naming each block's job. If a reviewer cannot tell which blocks own infrastructure and which blocks read existing facts, plan review becomes guesswork. The same line of HCL can mean a create operation, a provider setting, a value reference, or a read-only lookup depending on the block around it.

This article gives the map before the deeper configuration articles. Providers explain how Terraform talks to AWS. Resources explain what Terraform owns. Data sources explain what Terraform reads. Ownership ties those choices together.

## Provider Configuration

Terraform itself does not know how to call AWS APIs. The AWS provider supplies that knowledge. A root module declares the provider it needs:

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

The provider block configures how this module uses AWS:

```hcl
provider "aws" {
  region = "us-east-1"
}
```

The provider requirement answers where the plugin comes from and which version range is acceptable. The provider configuration answers which AWS context this module will use. Credentials should come from the runtime, such as a profile, role, instance profile, IAM Identity Center, or CI identity.

Review provider changes carefully. A region, alias, or credential-context change can move the same resource blocks toward a different AWS target.

## Resources

A resource block declares an object Terraform manages.

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "orders-dev-vpc"
  }
}
```

The type `aws_vpc` comes from the AWS provider. The local name `main` gives the object an address inside this module:

```text
aws_vpc.main
```

Terraform uses that address in plans and state. The address is not the AWS name. The real AWS VPC has an ID such as `vpc-0abc1234`, and the tag is what humans see in the AWS console.

Resources are lifecycle decisions. If this root module owns the VPC, a resource is appropriate. Terraform can create it, update it, replace it, or destroy it according to the configuration and state.

## Data Sources

A data source reads existing information without making Terraform the owner of that object.

```hcl
data "aws_caller_identity" "current" {}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
}
```

The caller identity data source reads the active AWS account. The AMI data source searches for an existing image. The module can use those values without claiming ownership of the AWS account or Amazon's AMI.

Data sources are useful when the module needs a fact owned somewhere else. A shared VPC owned by a platform team may be read through a data source. An application bucket owned by this root module should usually be a resource.

## Ownership

The most important review question is ownership.

| Block | Job | Review question |
| --- | --- | --- |
| `provider` | Talk to AWS | Is Terraform pointed at the intended account and region? |
| `resource` | Manage an AWS object | Should this root module own the object's lifecycle? |
| `data` | Read an existing fact | Is the object owned somewhere else? |
| `output` | Expose a selected value | Should another person, tool, or module depend on this value? |

The VPC belongs in a resource if this module owns the environment network. The latest Amazon Linux AMI belongs in a data source because Amazon publishes it and this module only needs the ID. The current AWS account ID belongs in a data source because the module reads context but does not create the account.

Wrong ownership creates long-term problems. A resource can give Terraform authority over something another team owns. A data source can hide a missing owner by treating unmanaged infrastructure as normal input.

## Putting It All Together

The configuration map is simple once each block has a job.

- Provider requirements choose the AWS provider and version range.
- Provider configuration points Terraform at the intended AWS region and credential context.
- Resources manage infrastructure lifecycle.
- Data sources read existing facts.
- Outputs expose selected values.
- References connect blocks and give Terraform dependency information.

The next articles go deeper into each part. Keep this map in mind: provider, resource, data source, ownership, and references.

## What's Next

The next article focuses on providers. It explains how Terraform installs the AWS provider, how provider versions affect repeatability, how credentials reach the provider, and how aliases let one module talk to more than one AWS context.

---

**References**

- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - Terraform language reference for provider source addresses, local names, and version constraints.
- [Provider configuration](https://developer.hashicorp.com/terraform/language/providers/configuration) - Terraform language reference for configuring providers and provider aliases.
- [Create and manage resources](https://developer.hashicorp.com/terraform/language/resources) - Terraform overview of resource blocks and managed infrastructure objects.
- [Query infrastructure data](https://developer.hashicorp.com/terraform/language/data-sources) - Terraform overview of data sources and read-only infrastructure queries.

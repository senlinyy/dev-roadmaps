---
title: "Data Sources"
description: "Use Terraform data sources to read existing AWS facts, such as caller identity and Amazon Linux AMIs, without making the module own those objects."
overview: "Data sources are read-only queries inside Terraform configuration. This article follows the orders EC2 instance as it reads an AMI ID and account context from AWS while still keeping resource ownership clear."
tags: ["terraform", "aws", "data-sources", "ami"]
order: 5
id: article-infrastructure-as-code-terraform-data-sources
---

## Table of Contents

1. [Why Data Sources Matter](#why-data-sources-matter)
2. [Reading AWS Facts](#reading-aws-facts)
3. [AMI Lookup](#ami-lookup)
4. [Data Sources and Ownership](#data-sources-and-ownership)
5. [Filters](#filters)
6. [Plan Timing](#plan-timing)
7. [Common First Mistakes](#common-first-mistakes)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Data Sources Matter

The orders EC2 instance needs an Amazon Machine Image ID. The team could paste an AMI ID into the resource block, but that value is regional, easy to mistype, and likely to change over time. The team does not publish the Amazon Linux AMI. AWS does. The module only needs to read which AMI should be used.

That is the job of a data source. A `data` block asks a provider to read existing information and make the result available to expressions. It does not make Terraform the lifecycle owner of the thing it reads.

This ownership line matters. The orders module owns its VPC, subnet, security group, EC2 instance, and S3 bucket because those are resource blocks. It reads the active AWS caller identity and the selected AMI because those are facts supplied by AWS or by another owner. A plan should make that distinction easy to see.

Data sources are useful whenever configuration needs current platform information: the current account ID, the latest approved image, an existing shared VPC, an existing Route 53 zone, or a certificate created by another module. The question is always the same: does this root module own the object, or does it need to read a fact about an object owned elsewhere?

## Reading AWS Facts

A data source block looks like a resource block, but it starts with `data`:

```hcl
data "aws_caller_identity" "current" {}
```

The type is `aws_caller_identity`. The local name is `current`. Terraform can reference it as:

```hcl
data.aws_caller_identity.current.account_id
```

The caller identity data source reads the account context from the credentials Terraform is using. That makes it useful in outputs, tags, policy documents, and guardrail checks.

```hcl
output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}
```

This output does not create an AWS account. It exposes the account ID that the provider saw during the run. In review, it helps connect the Terraform run back to the account context discussed in the provider article.

## AMI Lookup

The EC2 instance needs an AMI ID. AMI IDs differ by region, and new images are published over time. A data source can query for an Amazon Linux image that matches specific filters.

```hcl
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
```

The `owners` argument narrows the search to AMIs owned by Amazon. The filters narrow the result to Amazon Linux 2023 images for the desired architecture and virtualization type. `most_recent = true` tells the data source to choose the newest matching AMI.

The instance then references the result:

```hcl
resource "aws_instance" "web" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
}
```

The instance is still the managed object. The AMI remains an existing AWS object owned outside this module. Terraform reads the AMI ID during planning and uses it as an argument when it creates or updates the EC2 instance.

## Data Sources and Ownership

Data sources are easy to overuse when a team wants to avoid ownership decisions. A data source is correct when another system owns the object and this module only needs a fact. It is wrong when the object should be created and controlled by this module.

| Need | Better block | Reason |
| --- | --- | --- |
| Create the orders development VPC | `resource "aws_vpc"` | This module owns the network lifecycle |
| Launch the orders web EC2 instance | `resource "aws_instance"` | This module owns the instance lifecycle |
| Read the current AWS account ID | `data "aws_caller_identity"` | The account exists before this module runs |
| Read an Amazon Linux AMI ID | `data "aws_ami"` | Amazon publishes the image |
| Use a shared VPC from a networking team | Data source or input variable | Another owner controls the VPC lifecycle |

The shared VPC row is the one that usually needs a team decision. If the orders module creates its own VPC, use a resource. If a platform networking module creates the VPC and publishes its ID, the orders module should receive that ID through an input or query it with a data source. A second resource block for the same shared VPC would give two Terraform states competing ownership of one object.

Clear ownership makes plans safer. A resource deletion can destroy an object. A data source deletion only removes the query from configuration.

## Filters

Data source filters should be narrow enough that the result is predictable. A broad AMI query can return something surprising, especially when `most_recent = true` is used.

This query is too loose for a team workflow:

```hcl
data "aws_ami" "linux" {
  most_recent = true
  owners      = ["amazon"]
}
```

It asks for the newest AMI owned by Amazon without saying which product line, architecture, or virtualization type the instance expects. A reviewer cannot tell whether the selected image is appropriate for the application.

A more useful query says what kind of AMI the instance needs:

```hcl
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}
```

Even a narrow query can change over time when new AMIs are published. That may be exactly what a development environment wants. Production workflows often add an image promotion process so the AMI choice is reviewed before an instance replacement appears in a plan.

The non-obvious detail is that data sources can make plans change even when your `.tf` files did not change. If a query returns a new AMI ID today, Terraform may plan to replace an instance that was stable yesterday.

## Plan Timing

Terraform reads data sources during planning when their inputs are known. The result can then feed resource arguments, outputs, locals, and other expressions.

In the orders module, the AMI data source can usually be read during plan because its filters are static and the AWS provider is configured. The plan can show the instance `ami` argument as a real AMI ID.

Some data sources depend on values created by resources. Terraform can handle that dependency, but the result may be unknown until apply. For beginner modules, prefer data source queries whose inputs are known before apply. They make plans easier to review.

Data source reads also use the selected provider configuration. If the AWS provider region changes, the AMI query runs in the new region. AMI IDs are regional, so the result can change even though the data source block looks identical.

This ties data sources back to providers. Provider context decides where the query runs. The data source decides what to read. The reference decides where the result flows.

## Common First Mistakes

**Using a data source to avoid ownership.** If the module should create and manage the VPC, use a resource. A data source only reads.

**Using a resource for a shared object.** If another Terraform state or team owns the object, read it or accept it as an input instead of creating a competing resource.

**Writing broad AMI filters.** A broad `most_recent` query can select an unexpected image. Filter by owner, name pattern, architecture, and other meaningful fields.

**Assuming data source results are stable forever.** Data source queries can return different results later, especially when they intentionally ask for the newest object.

**Forgetting provider context.** Data sources read from the account and region selected by the provider configuration, including aliases.

## Putting It All Together

Data sources give the orders module read-only access to facts it does not own.

- `data.aws_caller_identity.current.account_id` reads the AWS account context used by the run.
- `data.aws_ami.amazon_linux.id` reads an AMI ID published by Amazon.
- `aws_instance.web` uses that AMI ID while remaining the managed EC2 resource.
- Shared infrastructure can be read with data sources when another owner controls lifecycle.
- Narrow filters make data source results easier to review.
- Provider configuration decides which account and region the query uses.

The useful review question is ownership. A resource block says Terraform manages lifecycle. A data source says Terraform reads a fact. Keep that line clear and the plan becomes much easier to explain.

## What's Next

The final article in this configuration submodule covers meta-arguments. Meta-arguments change how Terraform treats a block: how many instances exist, which provider configuration is selected, when explicit dependencies are needed, and how lifecycle safeguards affect plans.

---

**References**

- [Query data from external sources](https://developer.hashicorp.com/terraform/language/data-sources) - Terraform language reference for data source behavior, syntax, and lifecycle.
- [References to named values](https://developer.hashicorp.com/terraform/language/expressions/references) - Terraform language reference for referencing data source attributes with the `data.` prefix.
- [aws_ami data source](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami) - AWS provider reference for querying Amazon Machine Images with owners and filters.
- [aws_caller_identity data source](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) - AWS provider reference for reading the active AWS account identity.

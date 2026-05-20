---
title: "Resources"
description: "Use Terraform resource blocks to describe the AWS objects a module owns, from S3 buckets to VPCs, security groups, and EC2 instances."
overview: "Resources are the blocks that give Terraform lifecycle authority over infrastructure. This article follows the orders AWS environment and shows how resource type, local name, arguments, attributes, tags, and plan actions fit together."
tags: ["terraform", "aws", "resources", "state"]
order: 3
id: article-infrastructure-as-code-terraform-resources
---

## Table of Contents

1. [Why Resources Matter](#why-resources-matter)
2. [Resource Addresses](#resource-addresses)
3. [Arguments and Attributes](#arguments-and-attributes)
4. [AWS Network Resources](#aws-network-resources)
5. [Resources and Plans](#resources-and-plans)
6. [Names and Tags](#names-and-tags)
7. [Common First Mistakes](#common-first-mistakes)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Resources Matter

The orders team has chosen the AWS provider and region. Now the team needs Terraform to create something real: an S3 bucket for upload objects, a VPC for the demo environment, a subnet inside that VPC, a security group for HTTP access, and an EC2 instance that runs the web process.

The question for review is direct: which AWS objects does this Terraform module own?

A `resource` block is the answer. When a block says `resource "aws_vpc" "main"`, the module is asking Terraform to manage one VPC through the AWS provider. Terraform will compare that desired VPC with state and with the remote AWS object. During apply, it can create the VPC, update supported settings, replace it when the provider says replacement is required, or destroy it when the block is removed from the managed configuration.

That lifecycle authority is the reason resource blocks deserve careful reading. A resource block is a claim of ownership. If this root module owns the orders development VPC, a resource block is appropriate. If a shared networking team owns the VPC somewhere else, this module should usually read it through a data source or receive its ID as an input instead.

## Resource Addresses

Every resource block has a type and a local name:

```hcl
resource "aws_s3_bucket" "uploads" {
  bucket = "orders-dev-uploads-example"
}
```

The resource type is `aws_s3_bucket`. The local name is `uploads`. Together they form the resource address:

```text
aws_s3_bucket.uploads
```

Terraform uses the address in state, plans, references, imports, moved blocks, and error messages. The address is Terraform's handle for this managed object. It is separate from the visible AWS bucket name, which is the `bucket` argument inside the block.

That distinction is one of the first resource habits to learn. Renaming the local label from `uploads` to `object_store` changes the Terraform address. It does not rename the existing S3 bucket in AWS. Without a matching state move, Terraform may plan to destroy one address and create another. Changing the `bucket` argument changes the desired AWS bucket name and can force replacement because S3 bucket names are part of the physical object identity.

The same rule applies to network resources:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
```

The address is `aws_vpc.main`. The VPC's visible name in AWS comes from tags, not from the Terraform local name.

## Arguments and Attributes

Inside a resource block, arguments describe desired configuration. The provider schema decides which arguments are required, which are optional, which can be updated in place, and which changes require replacement.

This VPC block gives AWS a CIDR range and enables DNS behavior:

```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "orders-dev-vpc"
    Environment = "dev"
  }
}
```

`cidr_block`, `enable_dns_support`, `enable_dns_hostnames`, and `tags` are arguments in this block. They are the desired settings Terraform sends through the AWS provider.

After AWS creates the VPC, the provider exposes attributes about the remote object. One common attribute is `id`. Terraform can use that attribute in another block:

```hcl
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}
```

The expression `aws_vpc.main.id` reads the VPC ID attribute from the managed VPC resource. That ID is not known before AWS creates the VPC. Terraform can still understand the relationship and show unknown values in the plan until apply returns the real ID.

Arguments are what you ask for. Attributes are what Terraform can read from a resource instance. Many names can serve as both, but the review habit is the same: ask whether the block is setting a desired value, reading a provider-computed value, or doing both.

## AWS Network Resources

A small AWS web environment becomes easier to read when each resource owns one AWS object. The VPC owns the address space. The subnet owns one slice of that address space in one Availability Zone. The security group owns instance-level traffic rules. The EC2 instance owns a compute server.

```hcl
resource "aws_security_group" "web" {
  name        = "orders-dev-web"
  description = "Allow HTTP access to the demo web server"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["203.0.113.0/24"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

This resource manages the security group itself and the inline ingress and egress rules written inside the block. The `vpc_id` argument links it to the VPC. The ingress rule allows HTTP from one example office CIDR. The egress rule allows outbound traffic.

The instance then uses the subnet and security group:

```hcl
resource "aws_instance" "web" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true

  tags = {
    Name        = "orders-dev-web"
    Environment = "dev"
  }
}
```

This block owns the EC2 instance lifecycle. It does not own the AMI because the AMI value comes from a data source. It does not own the subnet or security group because those are separate resource blocks with their own addresses. The instance depends on them by reference, and Terraform can use those references to order operations.

You could place all of these blocks in one `main.tf` file or split them into `network.tf`, `security.tf`, and `compute.tf`. Terraform reads all `.tf` files in the root module together. File names help humans. Resource addresses and references drive Terraform's model.

## Resources and Plans

Terraform builds a plan by comparing configuration, state, and provider-read remote objects. A resource block is the desired configuration. State records which remote object currently belongs to that resource address. The provider refresh step reads the current remote object so Terraform can notice drift and decide what needs to change.

For a first environment, the plan might say:

```text
Plan: 5 to add, 0 to change, 0 to destroy.
```

That summary should match the story: create a VPC, subnet, security group, EC2 instance, and S3 bucket. The body of the plan then shows each resource action.

```text
  # aws_vpc.main will be created
  + resource "aws_vpc" "main" {
      + cidr_block = "10.0.0.0/16"
      + id         = (known after apply)
    }
```

The plus sign means Terraform plans to create the resource. The `(known after apply)` marker means AWS will return the final value during apply. Reviewers should read both the action and the important arguments. A create action for a development VPC is expected in a first environment. A destroy action for a production database would require a different level of review.

Removing a resource block from configuration usually tells Terraform that the managed object should be destroyed. If the object should remain in AWS but no longer be managed by this root module, use the correct state workflow instead of simply deleting the block and applying the destroy plan.

## Names and Tags

Terraform local names, AWS names, and AWS tags have different jobs.

| Location | Example | Job |
| --- | --- | --- |
| Terraform address | `aws_instance.web` | Identifies the managed object in Terraform state and references |
| AWS argument | `name = "orders-dev-web"` | Sets a provider-specific name field when the resource type has one |
| AWS tag | `Name = "orders-dev-web"` | Labels the object for humans, billing, search, and operations |

Some AWS resources have a direct name argument. Some use tags for the visible console name. Some names must be globally unique, such as S3 bucket names. Others only need to be unique in a VPC or account context. The AWS provider documentation for each resource describes those rules.

For the orders environment, keep the Terraform address stable and make human-facing names and tags explicit:

```hcl
resource "aws_s3_bucket" "uploads" {
  bucket = "orders-dev-uploads-example"

  tags = {
    Name        = "orders-dev-uploads"
    Environment = "dev"
    Owner       = "orders"
  }
}
```

The address `aws_s3_bucket.uploads` is for Terraform. The bucket name is for AWS. The tags are for people and tooling. Treat each layer separately during review.

## Common First Mistakes

**Treating a resource label as the cloud name.** The label `web` in `aws_instance.web` is Terraform's local name. AWS sees tags and provider-specific name arguments.

**Renaming resources without moving state.** Changing a resource address can look like destroy and create. Use Terraform's state or moved-block workflow when a rename should preserve ownership.

**Managing an object in the wrong module.** A resource block means this module owns lifecycle. Shared VPCs, shared AMIs, and organization-wide buckets often belong elsewhere.

**Deleting a block to stop managing an object.** Removing a block normally plans destruction. Use the right state operation when the object should stay in AWS.

**Ignoring provider-computed attributes.** Values such as IDs, ARNs, and public IPs may be unknown until apply. Terraform can still pass them through references.

## Putting It All Together

Resources are the ownership layer in Terraform configuration.

- `resource "aws_s3_bucket" "uploads"` asks Terraform to manage one S3 bucket at the address `aws_s3_bucket.uploads`.
- `resource "aws_vpc" "main"` owns the VPC address space for the orders environment.
- `aws_subnet.public` belongs inside the VPC because it references `aws_vpc.main.id`.
- `aws_security_group.web` owns the traffic rules attached to the instance.
- `aws_instance.web` owns the EC2 instance while reading its AMI from a data source.
- Plans show what Terraform will do with each resource address: create, update, replace, or destroy.

Once you can separate Terraform addresses from AWS names and lifecycle ownership from read-only values, resource blocks become easier to review. You can ask which team owns each object before Terraform gets permission to change it.

## What's Next

The next article follows the lines between resources. References let the VPC ID flow into the subnet, the subnet ID flow into the EC2 instance, and Terraform's dependency graph emerge from the configuration itself.

---

**References**

- [Resource block reference](https://developer.hashicorp.com/terraform/language/block/resource) - Terraform language reference for resource block syntax, labels, arguments, and operation behavior.
- [Create and manage resources](https://developer.hashicorp.com/terraform/language/resources) - Terraform overview of managed resources and how resource configuration maps to remote infrastructure.
- [AWS VPC resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc) - AWS provider reference for managing VPC resources.
- [AWS S3 bucket resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) - AWS provider reference for managing S3 buckets.
- [AWS EC2 instance resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance) - AWS provider reference for managing EC2 instances.
- [AWS security group resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group) - AWS provider reference for managing security groups and rules.

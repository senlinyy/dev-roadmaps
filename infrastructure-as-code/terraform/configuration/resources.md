---
title: "Resources"
description: "Understand how resource blocks work in Terraform — how they map to real cloud infrastructure, how their lifecycle works, and how Terraform decides what to do with them."
overview: "Every piece of real infrastructure in Terraform — a server, a database, a network, a storage bucket — is declared as a resource block. This article explains the full lifecycle of a resource: how Terraform creates it, how it decides when to update it versus replace it, and what gets stored in state after it exists."
tags: ["resources", "lifecycle", "configuration", "terraform", "hcl"]
order: 2
id: article-iac-terraform-config-resources
---

## Table of Contents

1. [What a Resource Is](#what-a-resource-is)
2. [The Structure of a Resource Block](#the-structure-of-a-resource-block)
3. [How Terraform Reads a Resource Block](#how-terraform-reads-a-resource-block)
4. [Required vs Optional Attributes](#required-vs-optional-attributes)
5. [Computed Attributes: Values You Cannot Know in Advance](#computed-attributes-values-you-cannot-know-in-advance)
6. [The Resource Lifecycle](#the-resource-lifecycle)
7. [When Terraform Updates In Place vs Replaces](#when-terraform-updates-in-place-vs-replaces)
8. [Nested Blocks Inside Resources](#nested-blocks-inside-resources)
9. [Referencing One Resource From Another](#referencing-one-resource-from-another)
10. [Resources and the State File](#resources-and-the-state-file)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What a Resource Is

A resource in Terraform is the fundamental unit of infrastructure. Every real thing that will exist in your cloud account — an EC2 instance, an S3 bucket, a VPC, a database, a DNS record, a security group — is represented by a resource block in your configuration.

When Terraform applies your configuration, it looks at each resource block and asks: does this thing already exist? If not, it creates it. If it already exists, does it match what the block describes? If not, it updates it. This is the core job Terraform does, over and over, for every resource in your configuration.

The word "resource" is used deliberately. It is the same thing as a "resource" in the AWS sense — a piece of infrastructure that has a unique identifier, that costs money to run (usually), and that has a set of attributes you can configure. An EC2 instance is a resource. An IAM role is a resource. A CloudWatch alarm is a resource. Everything that you would create, configure, and eventually delete is a resource.

## The Structure of a Resource Block

A resource block starts with the keyword `resource`, followed by the resource type in quotes and the resource name in quotes, then a pair of braces containing the resource's attributes:

```hcl
resource "aws_instance" "app_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.small"
  subnet_id     = aws_subnet.web.id

  tags = {
    Name        = "app-server"
    environment = "production"
  }
}
```

The first string, `"aws_instance"`, is the resource type. It tells Terraform which provider this resource belongs to (the `aws` prefix identifies the AWS provider) and which specific resource it is (`instance`). Every resource type corresponds to a specific kind of real infrastructure that the provider knows how to create.

The second string, `"app_server"`, is the resource name. This name exists only inside your Terraform configuration — it is not the name that appears in AWS. It is how you refer to this specific resource from other places in your configuration. Two different resource blocks can never have the same combination of type and name.

Together, the type and name form the resource's address: `aws_instance.app_server`. This address is how the resource appears in plan output, in the state file, and in error messages.

## How Terraform Reads a Resource Block

When Terraform reads a resource block, it does not run any code or make any API calls. It is just building a picture.

Terraform reads all the `.tf` files in your working directory. As it reads each resource block, it records the resource's type, name, and all of its attribute values. If an attribute value is a reference to another resource — like `aws_subnet.web.id` — Terraform notes the dependency: this resource depends on `aws_subnet.web`, because it needs that resource's `id` attribute.

After reading all the files, Terraform has a complete in-memory graph: all the resources that should exist, with all their attributes and all the dependencies between them. This graph is what gets turned into a plan.

It is worth understanding that at this point, Terraform has not contacted AWS at all. Reading and parsing the configuration files is a purely local operation. The first network call happens during `terraform plan`, when Terraform contacts AWS to check what currently exists.

## Required vs Optional Attributes

Resource blocks have attributes — the settings that describe how the resource should be configured. Some attributes are required: Terraform cannot proceed without a value for them. Others are optional: if you do not specify them, the provider uses a default value.

For `aws_instance`, the `ami` (the operating system image) and `instance_type` (the hardware size) are required. You must specify both. If you omit either one, Terraform reports an error when you run `terraform plan`.

The `tags` attribute is optional. If you do not include a `tags` block, the EC2 instance is created with no tags. The provider defines a default (no tags) and uses it if you do not specify otherwise.

Optional attributes with defaults can still be important for security and compliance. An S3 bucket can be created without specifying `acl = "private"` — the provider defaults to private. But if your organization's policy requires explicit confirmation of bucket privacy, you should set it explicitly rather than relying on the default, so the intent is visible in code review.

Some attributes are only meaningful in combination with others. You might need to set `multi_az = true` on an RDS instance, which then also requires you to not set `availability_zone` (because multi-AZ means AWS chooses the zones, not you). The provider documentation lists all attributes, which ones are required, which are optional, which ones conflict, and which ones are only valid under certain conditions.

## Computed Attributes: Values You Cannot Know in Advance

Not all of a resource's attributes come from your configuration. Many are assigned by the cloud provider when the resource is created, and you cannot know them beforehand.

When you create an EC2 instance, AWS assigns it an instance ID (like `i-0a1b2c3d4e5f6789`), a private IP address, and optionally a public IP address. You did not specify any of these — AWS chose them. These are called computed attributes.

In the plan output, computed attributes appear as `(known after apply)`:

```
+ aws_instance.app_server
    + ami           = "ami-0c55b159cbfafe1f0"
    + instance_type = "t3.small"
    + id            = (known after apply)
    + private_ip    = (known after apply)
    + public_ip     = (known after apply)
```

After the apply completes, Terraform stores all of these attributes — including the computed ones — in the state file. That is how a different resource can reference `aws_instance.app_server.private_ip` later: the value was stored in state after the first apply and is available to any subsequent plan or apply.

Computed attributes create an interesting constraint: if resource B needs to know resource A's ID, and A's ID is only known after A is created, then B cannot be created at the same time as A. Terraform detects this dependency automatically and creates A first, then uses A's ID (read from the state file) when creating B.

## The Resource Lifecycle

Every resource in Terraform goes through the same lifecycle stages: Create, Read, Update, Delete. These correspond to the four basic API operations that every cloud provider supports.

![Terraform resources move through create, read, update, replace, and destroy decisions.](/content-assets/articles/article-iac-terraform-config-resources/resource-lifecycle.png)

*A resource block becomes a managed object whose lifecycle Terraform tracks through state and provider responses.*

**Create** happens when a resource exists in your configuration but does not yet exist in the cloud. Terraform calls the provider's Create function, which makes the API call to build the resource and returns all of the resource's initial attributes. Terraform stores those attributes in the state file.

**Read** happens at the start of every `terraform plan`. For each resource in the state file, Terraform calls the provider's Read function, which makes an API call to check whether the resource still exists and what its current attributes are. This is the refresh step. If the Read function returns that the resource no longer exists (someone deleted it outside of Terraform), Terraform marks it as gone and plans to recreate it.

**Update** happens when a resource exists in the cloud but its current attributes do not match what your configuration describes. If you changed the instance type from `t3.small` to `t3.medium`, the Read step sees `t3.small` in AWS, your configuration says `t3.medium`, and the plan proposes an update. Terraform calls the provider's Update function, which makes the API call to change the attribute.

**Delete** happens when a resource exists in the cloud (and in the state file) but is no longer in your configuration. If you remove a resource block from your configuration, the next plan proposes to delete it. Terraform calls the provider's Delete function to remove the real resource and removes its record from the state file.

## When Terraform Updates In Place vs Replaces

Not all attribute changes can be made by modifying an existing resource. Some attributes are set at creation time and cannot be changed afterward. These are called ForceNew attributes in the provider documentation.

![Terraform compares an attribute diff with provider rules before choosing update in place or replacement.](/content-assets/articles/article-iac-terraform-config-resources/update-replace-decision.png)

*Some changes can patch an object, while others require Terraform to create a new object and retire the old one.*

For EC2 instances, the availability zone is a ForceNew attribute. Once an instance is created in `us-east-1a`, you cannot move it to `us-east-1b`. The only way to change the availability zone is to destroy the instance and create a new one in the correct zone.

When you change a ForceNew attribute in your configuration, Terraform plans a replacement instead of an update. The plan output shows `-/+` instead of `~`, and includes a note about which attribute forced the replacement:

```
# aws_instance.app_server must be replaced
-/+ resource "aws_instance" "app_server" {
    ~ availability_zone = "us-east-1a" -> "us-east-1b" # forces replacement
  }
```

Replacements can cause downtime by default. Terraform normally destroys the old resource first, then creates the new one. During the time between destruction and creation, the resource does not exist. For a running server or database, this can be a service interruption.

The `lifecycle { create_before_destroy = true }` setting reverses the Terraform replacement order: Terraform creates the new resource first, then destroys the old one. This removes the destroy-before-create gap, but load balancer health checks and traffic handoff still need to be designed separately. This technique is covered in more depth in the lifecycle and zero-downtime articles.

The distinction between in-place update and replacement is one of the most important things to look for in a plan before confirming apply. Always check whether any `-/+` replacements are present and whether they will cause disruption.

## Nested Blocks Inside Resources

Some resource attributes are not simple values like strings or numbers — they are blocks that contain their own attributes. These are called nested blocks.

An EC2 instance's root block device configuration is a nested block:

```hcl
resource "aws_instance" "app_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.small"

  root_block_device {
    volume_size = 50
    volume_type = "gp3"
    encrypted   = true
  }
}
```

The `root_block_device` block sits inside the `aws_instance` block and has its own attributes. This represents the configuration for the EC2 instance's operating system disk — the size in gigabytes, the type of storage, and whether the disk is encrypted.

A security group uses nested blocks for its inbound and outbound rules:

```hcl
resource "aws_security_group" "web" {
  name   = "web-security-group"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

There are two separate `ingress` blocks — one for port 443 (HTTPS) and one for port 80 (HTTP). Terraform supports having multiple copies of the same nested block type inside a resource. Each copy represents a separate rule.

Understanding which parts of a resource configuration are inline attributes and which are nested blocks comes from reading the provider documentation. The documentation for each resource type lists every attribute and block, which are required, which are optional, and what each one does.

## Referencing One Resource From Another

The whole reason you give resources names is so you can reference them from other resources. When one resource needs an attribute from another — a subnet needs a VPC ID, a server needs a subnet ID, a security group needs to reference a VPC — you use a resource reference.

The syntax is `<resource_type>.<resource_name>.<attribute>`:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "web" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "app_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.small"
  subnet_id     = aws_subnet.web.id

  vpc_security_group_ids = [aws_security_group.web.id]
}
```

`aws_vpc.main.id` means: the `id` attribute of the `aws_vpc` resource named `main`. `aws_subnet.web.id` means: the `id` attribute of the `aws_subnet` resource named `web`. These references tell Terraform that these resources are related and must be created in a specific order: the VPC first, then the subnet (which needs the VPC's `id`), then the server (which needs the subnet's `id`).

Terraform detects these dependencies automatically by scanning for resource references in attribute values. You do not need to tell Terraform "create the VPC before the subnet." Terraform figures it out from the reference. This is one of the most convenient aspects of the declarative approach.

## Resources and the State File

After `terraform apply` completes, the state file contains a record for every resource that was created. The record includes:

- The resource type and name (the address, like `aws_instance.app_server`)
- The provider that manages it
- The real cloud identifier assigned by the provider (like the EC2 instance ID `i-0a1b2c3d4e5f6789`)
- Every attribute of the resource — both the ones you specified in your configuration and the computed ones that the provider assigned

This record is what Terraform uses in subsequent plans. When you run `terraform plan` tomorrow, Terraform reads the state file, sees `aws_instance.app_server` with ID `i-0a1b2c3d4e5f6789`, and calls AWS to check whether that instance still exists and what its current attributes are. It then compares those current attributes against your configuration.

The state file's record of computed attributes is also what makes resource references work across applies. The first `terraform apply` creates the VPC and stores its `id` in state. The second time you reference `aws_vpc.main.id` in another resource, Terraform reads the `id` from state — it does not need to call AWS again to find it.

Without the state file, Terraform could not track the connection between your configuration and the real cloud resources. The state file is what gives Terraform the ability to update and delete resources it created, rather than just creating new ones every time.

## Putting It All Together

A resource block is a declaration of intent: "I want this specific piece of infrastructure to exist, configured exactly like this." Terraform reads all the resource blocks in your configuration, figures out the correct creation order from the dependencies between them, and makes reality match what you declared.

The lifecycle is straightforward: Create when a resource is new, Read to check the current state, Update when settings change, Delete when the block is removed. Whether an update happens in place or requires replacement depends on which attributes changed and whether those attributes can be modified after creation.

After every apply, the state file captures the full set of attributes for each resource — both what you configured and what the cloud provider assigned. That stored state is what enables Terraform to plan correctly on the next run, detecting changes and knowing which real cloud resources correspond to which configuration blocks.

## What's Next

Resources are the main things you create. But sometimes you need to look up information about things that already exist — a VPC managed by another team, an AMI published by a software vendor, a certificate stored in AWS Certificate Manager. Data sources are the read-only counterpart to resources, and the next article covers how they work.

![A six-part summary infographic for Terraform resources covering resource blocks, arguments, computed values, lifecycle, references, and state.](/content-assets/articles/article-iac-terraform-config-resources/resources-summary.png)

*Use this summary as the resource checklist before interpreting a plan diff.*


---

**References**

- [Resources (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/resources) — Full reference for the resource block syntax, meta-arguments, and lifecycle behavior.
- [Resource Behavior (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/resources/behavior) — Detailed explanation of how Terraform creates, reads, updates, and deletes resources.
- [AWS Provider Resource Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) — The full catalog of every AWS resource type, with attribute lists, examples, and ForceNew annotations.

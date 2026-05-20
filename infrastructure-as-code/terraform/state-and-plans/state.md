---
title: "State"
description: "Understand how Terraform uses state to remember AWS resources, compare configuration with reality, and protect infrastructure ownership."
overview: "Terraform state is the memory that connects resource addresses in code to real AWS objects. This article follows a VPC, EC2 instance, and S3 bucket so state feels like part of the system instead of a hidden file."
tags: ["terraform", "opentofu", "aws", "state"]
order: 1
id: article-infrastructure-as-code-terraform-state-backends-locking
aliases:
  - state-backends-and-locking
  - state-backends-locking
  - infrastructure-as-code/terraform/state-backends-locking.md
---

## Table of Contents

1. [The Question](#the-question)
2. [Why Terraform Needs Memory](#why-terraform-needs-memory)
3. [Configuration, State, and AWS](#configuration-state-and-aws)
4. [Resource Addresses](#resource-addresses)
5. [What State Contains](#what-state-contains)
6. [Local State](#local-state)
7. [Sensitive State](#sensitive-state)
8. [Changing State Safely](#changing-state-safely)
9. [Common First Mistakes](#common-first-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Question

You create a small AWS environment with Terraform: a VPC for the network, an EC2 instance for a demo web server, and an S3 bucket for uploaded files. The first apply succeeds. A week later, another engineer opens the same repository and changes the EC2 instance type from `t3.micro` to `t3.small`.

How does Terraform know that the line named `aws_instance.web` is the same EC2 instance that already exists in AWS?

That question is the center of state. AWS has object IDs such as `vpc-0abc1234`, `i-0123456789abcdef0`, and `dp-orders-assets-dev`. Terraform has addresses such as `aws_vpc.main`, `aws_instance.web`, and `aws_s3_bucket.assets`. State is the record that connects those two naming systems.

If Terraform lost that record, it would still have configuration, and AWS would still have resources, but Terraform would no longer know which resources it owns. It could try to create something that already exists, miss a resource that needs repair, or propose a destroy because an address moved. State is the memory that makes the next plan meaningful.

## Why Terraform Needs Memory

Terraform configuration describes the desired shape of infrastructure. A resource block says that a VPC should exist with a CIDR range, an instance should use a certain AMI and instance type, and a bucket should have a particular name and tags.

The real AWS account has a different view. AWS stores resources by provider IDs, account, region, and service-specific attributes. EC2 does not know that your file called the instance `web`. It knows an instance ID, subnet ID, security group IDs, tags, and current settings.

State joins those views:

```text
aws_vpc.main       -> vpc-0abc1234
aws_instance.web   -> i-0123456789abcdef0
aws_s3_bucket.assets -> dp-orders-assets-dev
```

That mapping lets Terraform ask better questions during a plan. It can ask the AWS provider to read `i-0123456789abcdef0`, compare the returned instance type with the `aws_instance.web` block, and decide whether the object needs an in-place update, a replacement, or no action.

State also records metadata Terraform needs for dependency ordering and provider behavior. The state file is not a cache that can be deleted casually. It is one of the inputs Terraform reads before deciding what to do.

## Configuration, State, and AWS

Every normal plan brings together three views of the same system.

| View | Where it comes from | What it answers |
| --- | --- | --- |
| Configuration | `.tf` files and variable values | What should Terraform manage? |
| State | The latest state snapshot | What does Terraform believe it owns? |
| AWS reality | Provider refresh against AWS APIs | What exists right now? |

The comparison is easiest to see with one EC2 instance.

```hcl
resource "aws_instance" "web" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.public.id

  tags = {
    Name        = "orders-dev-web"
    Environment = "dev"
  }
}
```

The resource address is `aws_instance.web`. State records the EC2 instance ID for that address. During planning, the AWS provider reads the instance from AWS and returns its current attributes. Terraform can then compare the configured `instance_type` with the remote instance type.

If AWS reports `t3.micro` and the configuration says `t3.small`, the plan can propose an update:

```text
  # aws_instance.web will be updated in-place
  ~ resource "aws_instance" "web" {
      ~ instance_type = "t3.micro" -> "t3.small"
        id            = "i-0123456789abcdef0"
    }
```

The line matters because it proves Terraform connected the code address to the existing AWS object. It is not creating a random new instance. It is changing the instance that state says belongs to `aws_instance.web`.

State is also why Terraform can detect missing objects. If state says `aws_s3_bucket.assets` maps to `dp-orders-assets-dev`, but AWS reports that the bucket no longer exists, Terraform can plan to recreate the managed bucket or report the provider error that explains why it cannot.

## Resource Addresses

A resource address is Terraform's name for one managed object inside a module.

This block:

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "dp-orders-assets-dev"
}
```

has this address:

```text
aws_s3_bucket.assets
```

When a resource lives inside a child module, the module path becomes part of the address:

```text
module.web.aws_instance.this
```

Addresses are stable identifiers inside Terraform state. A rename can therefore be a real infrastructure event. If you rename `aws_instance.web` to `aws_instance.app` and do nothing else, Terraform sees one old address missing from configuration and one new address missing from state. The plan may show a destroy and a create even though the real EC2 instance should stay.

When the object should remain the same, tell Terraform about the address change:

```hcl
moved {
  from = aws_instance.web
  to   = aws_instance.app
}
```

The `moved` block lets a refactor preserve the binding between the address and the real AWS object. Reviewers should read address changes with the same care they give argument changes. A small rename in code can decide whether Terraform preserves a server or replaces it.

## What State Contains

State contains more than the three-line mapping most people imagine. It records resource instances, provider metadata, dependency information, current attributes, outputs, and values Terraform needs to compare future changes.

A simplified state relationship might look like this:

```text
address: aws_instance.web
provider: registry.terraform.io/hashicorp/aws
id: i-0123456789abcdef0
attributes:
  instance_type: t3.micro
  subnet_id: subnet-0456def0
  tags.Environment: dev
```

The real state format is JSON, but you should rarely edit it by hand. Terraform expects the structure to remain consistent. A manual edit can break the relationship between addresses, provider data, and real objects.

State can also contain values that never appear in a plan summary. Provider-computed attributes, generated IDs, ARNs, endpoint names, and output values often live there. When you run `terraform output`, Terraform is reading values from state.

This detail explains a common surprise: marking an output or variable as sensitive changes how Terraform displays the value, but it does not mean every stored copy disappears. If Terraform needs a value to manage a resource or produce an output, the state layer may still contain it.

## Local State

The default local backend writes state into a file named `terraform.tfstate` in the working directory. For a single-person learning exercise, local state keeps the model visible. You can apply a small S3 bucket example, see the file appear, and understand that Terraform now has memory.

Local state stops fitting when the AWS environment is shared.

Imagine Mira applies a VPC change from her laptop. The latest state file is now on Mira's disk. Jamal pulls the repository on another machine and plans a security group change. If he does not have the same state snapshot, Terraform does not have the same memory. The plan can be stale, incomplete, or pointed at a different view of the environment.

Local files also create operational risk. They can be deleted, overwritten, copied into the wrong directory, or committed to Git. A state file in Git is especially dangerous because it can expose sensitive data and because Git does not coordinate Terraform operations.

The rule is simple: local state is for isolated practice and short-lived experiments. A real shared environment needs state storage that the team and automation can reach, with access control and locking.

## Sensitive State

State deserves the same care as production infrastructure.

In the AWS example, state may include instance IDs, subnet IDs, security group IDs, bucket names, ARNs, IAM policy details, output values, and provider-returned attributes. Some values are not secret by themselves, but together they describe the shape of an environment. Other values can be directly sensitive, especially when a provider stores generated passwords, connection strings, tokens, or private configuration details.

This output block hides a value from normal CLI display:

```hcl
output "admin_password" {
  value     = var.admin_password
  sensitive = true
}
```

The display rule helps prevent accidental leaks in terminals and CI logs. It does not turn the state backend into a public place. Anyone who can read state may be able to recover sensitive values depending on how the configuration and provider store them.

Protecting state usually means:

- restrict who can read and write it
- keep it out of Git
- encrypt it at rest
- keep recoverable versions
- review access changes to the backend
- avoid placing long-lived secrets directly in Terraform values

The backend article goes deeper on the shared storage design. The important point here is that state is part of the security boundary.

## Changing State Safely

Most Terraform work changes configuration, then lets `terraform plan` and `terraform apply` update state as part of normal operations. Direct state changes are reserved for cases where the relationship between Terraform addresses and real objects must change.

Common examples include:

- moving a resource address after a refactor
- importing an existing AWS object into state
- removing a state binding for an object Terraform should stop managing
- recovering after a failed migration

Prefer configuration-driven state changes when Terraform provides them. A `moved` block makes an address refactor visible in review. An `import` block makes an adoption plan visible in review. State CLI commands are still useful, but they happen closer to the state file and need stronger coordination.

Read state-changing commands as ownership changes. If `aws_s3_bucket.assets` is removed from state while the bucket still exists, Terraform has stopped managing that bucket. If an existing bucket is imported into that address, Terraform has started managing it. The AWS object may not change at that moment, but Terraform's responsibility for the object has changed.

## Common First Mistakes

**Treating state as a build artifact.** State is not disposable output. It is Terraform's memory of managed objects.

**Committing state to Git.** State can contain sensitive values and live resource bindings. Git also gives no state locking.

**Renaming resources without a move.** Address changes can produce destroy and create plans when the real object should stay.

**Assuming sensitive means absent.** Sensitive values are hidden from normal display. State and plan artifacts still need protection.

**Using local state for a shared AWS account.** The latest memory of the environment should not live on one person's laptop.

**Editing state by hand.** Use Terraform's state, moved, and import mechanisms so the structure remains valid.

## Putting It All Together

Return to the opening question: how does Terraform know that `aws_instance.web` is the EC2 instance that already exists?

State holds the answer. It records that `aws_instance.web` maps to `i-0123456789abcdef0`. During planning, Terraform reads configuration, reads state, asks AWS what the instance looks like now, and proposes the smallest action that makes the managed object match the files.

That same mechanism explains the practical rules:

- Configuration describes the desired AWS resources.
- State records which real objects Terraform owns.
- Provider refresh tells Terraform what those objects look like now.
- Resource addresses are part of the identity Terraform uses.
- Local state is a learning tool, not a team workflow.
- Sensitive state needs controlled storage.
- State changes are ownership changes and should be reviewed.

Once state feels like Terraform's memory, the next problem is where that memory should live when a team and CI system both need to use it.

## What's Next

The next article covers backends and locking. State gives Terraform memory; a backend decides where that memory is stored, and locking prevents two runs from writing it at the same time.

---

**References**

- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains state as the mapping between resource instances and real infrastructure objects.
- [Terraform state purpose](https://developer.hashicorp.com/terraform/language/state/purpose) - Describes why Terraform needs state for mappings, metadata, and performance.
- [Refactor modules](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring) - Documents `moved` blocks for preserving resource bindings during address changes.
- [Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Explains sensitive variables and how values can still be stored in state.
- [Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Explains output values, sensitivity, and how outputs relate to state.
- [OpenTofu state](https://opentofu.org/docs/language/state/) - Describes the same state model for OpenTofu users.

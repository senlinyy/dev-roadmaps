---
title: "Workspaces"
description: "Use Terraform workspaces to maintain multiple independent state files from a single configuration directory."
overview: "Workspaces let one set of Terraform configuration files maintain multiple isolated states, one for development, one for staging, one for production, without duplicating any code. This article explains how workspaces work, where they fit well, and where their limitations mean a different approach is better."
tags: ["workspaces", "state", "environments", "isolation", "terraform"]
order: 1
id: article-iac-terraform-environments-workspaces
---

## Table of Contents

1. [The Multi-Environment Problem](#the-multi-environment-problem)
2. [How Workspaces Work](#how-workspaces-work)
3. [Creating and Switching Workspaces](#creating-and-switching-workspaces)
4. [Using the Workspace Name in Configuration](#using-the-workspace-name-in-configuration)
5. [Where State Goes in Each Workspace](#where-state-goes-in-each-workspace)
6. [A Complete Workspace-Based Configuration](#a-complete-workspace-based-configuration)
7. [When Workspaces Work Well](#when-workspaces-work-well)
8. [The Limits of Workspaces](#the-limits-of-workspaces)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Multi-Environment Problem

A Terraform workspace is a named state instance for the same root configuration, useful only when the environments can safely share the same code shape.

It exists to reduce duplicated Terraform code when multiple environments are nearly the same. Example: dev, staging, and prod can use the same `.tf` files, but each workspace writes to a different state record and creates resources with different names or sizes.

Every real project needs at least two environments: somewhere to test changes before they reach users, and the live production environment where users actually connect. Most teams add a third environment, staging, that mirrors production closely enough to catch issues that development does not.

The simplest way to handle this is to copy the entire Terraform configuration into three directories: one for dev, one for staging, one for prod. Each directory has its own backend, its own variable files, and its own state. The problem is maintenance: a bug fix in the network configuration requires the same fix in three places. A new security group rule needs to be added three times. Over time, the three copies drift apart, and you are back to the same problem that Terraform was supposed to solve.

Workspaces offer a different approach. Instead of three copies of the configuration, you have one configuration that Terraform applies three times, once per workspace, each time with a separate state file.

## How Workspaces Work

A workspace is a named state within a backend. A backend is the storage location Terraform uses for state, such as an S3 bucket, Azure Storage container, or Terraform Cloud workspace.

When you run `terraform init` and `terraform apply` without selecting a workspace, you are working in the `default` workspace. Example: after you create a `dev` workspace, the same configuration directory can create dev resources while leaving the `prod` workspace state untouched.

![Workspaces let one configuration directory select separate state snapshots for different named contexts.](/content-assets/articles/article-iac-terraform-environments-workspaces/workspace-state-split.png)

When you create a new workspace, Terraform creates a separate state storage location within the same backend. For the S3 backend, the workspace state goes into a path that includes the workspace name. For a configuration with key `production/app/terraform.tfstate`, the `dev` workspace stores its state at `env:/dev/production/app/terraform.tfstate`.

Every workspace has its own completely separate state. Resources created in the `dev` workspace do not appear in the `staging` workspace's state and cannot affect them. A `terraform destroy` in the `dev` workspace destroys only the dev resources, the staging and production resources are untouched.

This separation is the core value of workspaces: one configuration directory, multiple isolated environments, each with their own independent history of what Terraform created.

## Creating and Switching Workspaces

The `terraform workspace` subcommand selects which named state Terraform should use. Selecting a workspace does not change the `.tf` files on disk, it changes the state context for the next `plan`, `apply`, or `destroy`.

Example: `terraform workspace select staging` means the next apply compares the current configuration against the staging state file, not the production state file.

To see which workspace you are currently in and what workspaces exist:

```bash
terraform workspace list
```

Output:

```
* default
  dev
  staging
  prod
```

The asterisk marks the currently active workspace.

To create a new workspace:

```bash
terraform workspace new staging
```

Creating a workspace also switches to it. You are now in the `staging` workspace.

To switch to an existing workspace:

```bash
terraform workspace select prod
```

After selecting a workspace, every Terraform command, `plan`, `apply`, `destroy`, operates against that workspace's state. The configuration files are the same; only the state context changes.

To delete a workspace you no longer need:

```bash
terraform workspace delete dev
```

You must switch to a different workspace before deleting the current one. Terraform will also refuse to delete a workspace that still has resources in its state, you need to run `terraform destroy` first to remove all resources, then delete the workspace.

## Using the Workspace Name in Configuration

The workspace name is available inside configuration as `terraform.workspace`. This value exists so one set of files can choose different names, sizes, counts, or tags for each workspace.

Example: the `prod` workspace might create four `t3.medium` instances, while the `dev` workspace creates one `t3.micro` instance from the same resource block.

The current workspace name is available as `terraform.workspace`:

```hcl
locals {
  environment    = terraform.workspace
  is_production  = terraform.workspace == "prod"
  instance_type  = terraform.workspace == "prod" ? "t3.medium" : "t3.micro"
  instance_count = terraform.workspace == "prod" ? 3 : 1
}
```

You can also use the workspace name as part of resource names to prevent collisions between environments:

```hcl
resource "aws_s3_bucket" "app_uploads" {
  bucket = "my-company-${terraform.workspace}-uploads"
}

resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = local.instance_type
  count         = local.instance_count

  tags = {
    Name        = "${terraform.workspace}-app-server"
    environment = terraform.workspace
  }
}
```

When you run `terraform apply` in the `dev` workspace, the bucket becomes `my-company-dev-uploads`. In `prod`, it becomes `my-company-prod-uploads`. Two separate S3 buckets, each in its own workspace's state, each with a unique name that prevents collisions in the AWS account.

A useful pattern is a lookup map that returns environment-specific values:

```hcl
locals {
  instance_types = {
    dev     = "t3.micro"
    staging = "t3.small"
    prod    = "t3.medium"
  }
  instance_type = lookup(local.instance_types, terraform.workspace, "t3.micro")
}
```

`lookup` retrieves the value from the map whose key matches the current workspace name. The third argument is the default if the workspace name is not found in the map, useful as a safety net when someone creates a workspace name that is not in the map.

## Where State Goes in Each Workspace

Each workspace gets its own state object inside the backend. Terraform builds the workspace-specific state path for you, so the configuration still declares one backend while the backend stores multiple named state records.

Example: with an S3 backend key of `app/terraform.tfstate`, the default workspace uses that key directly, while the `dev` workspace stores its state under a workspace-specific path.

For the S3 backend, workspace state is stored in a path that the backend constructs automatically. Given a backend key of `app/terraform.tfstate`, Terraform stores workspace states at:

- `default` workspace: `app/terraform.tfstate` (the base key, unchanged)
- `dev` workspace: `env:/dev/app/terraform.tfstate`
- `staging` workspace: `env:/staging/app/terraform.tfstate`
- `prod` workspace: `env:/prod/app/terraform.tfstate`

You do not configure these paths, Terraform handles the workspace path construction automatically.

The backend lock also uses a workspace-aware state path, so two engineers working in different workspaces do not block each other. An apply in `dev` holds a lock for the dev workspace state, while an apply in `prod` holds a separate lock for the prod workspace state. Both can run simultaneously without state-lock conflict.

## A Complete Workspace-Based Configuration

A workspace-based configuration is still one root module. The difference is that the configuration reads `terraform.workspace` and uses that name to choose environment-specific values.

Example: the following configuration chooses instance size and count from a map keyed by `dev`, `staging`, and `prod`, then writes each environment's results to its own workspace state.

```hcl
terraform {
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "web-app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  sizes = {
    dev     = { instance = "t3.micro",  count = 1 }
    staging = { instance = "t3.small",  count = 2 }
    prod    = { instance = "t3.medium", count = 4 }
  }

  size         = lookup(local.sizes, terraform.workspace, local.sizes.dev)
  name_prefix  = "web-app-${terraform.workspace}"
}

resource "aws_instance" "app" {
  count         = local.size.count
  ami           = data.aws_ami.amazon_linux.id
  instance_type = local.size.instance

  tags = {
    Name        = "${local.name_prefix}-${count.index + 1}"
    environment = terraform.workspace
  }
}

output "instance_ids" {
  value       = aws_instance.app[*].id
  description = "IDs of all application instances in the ${terraform.workspace} environment."
}
```

To use this configuration:

```bash
# Set up the dev environment
terraform workspace new dev
terraform apply

# Set up the staging environment
terraform workspace new staging
terraform apply

# Set up production
terraform workspace new prod
terraform apply
```

Each apply creates a different number of instances with different types, named appropriately for the environment, stored in separate state files. The example uses a Terraform version range that supports the S3 backend lockfile argument shown here. If your organization is pinned to older Terraform versions, check that version's backend documentation before copying backend arguments.

## When Workspaces Work Well

Workspaces work best when environments are copies of the same design. The code stays shared, and only the state, names, sizes, or counts change between environments.

Example: a temporary feature environment that needs the same web stack as dev, but with a different name prefix, is a good workspace use case.

Workspaces are the right tool when:

All environments live in the same security boundary, such as the same AWS account or Azure subscription with the same credential model. Workspaces use the same configuration directory and backend configuration. You can write provider logic that changes by workspace, but workspaces do not enforce account or subscription separation by themselves.

The differences between environments are primarily size-based. More instances in production, smaller instance types in dev, these are easy to express with workspace-conditional logic. Fundamentally different architectures (dev uses a single instance, production uses an auto-scaling group behind a load balancer) are harder to express cleanly through workspace conditionals without the configuration becoming complex.

Environments are symmetric in structure. If every environment needs the same set of resources, just with different sizes or counts, workspaces keep the code very clean. If some environments need resources that others do not, you start sprinkling `count = local.is_production ? 1 : 0` conditionals throughout the code.

Short-lived environments. Spinning up a new workspace for a feature branch, testing it, and destroying it when the branch is merged is a natural workflow for workspaces. It is much faster than maintaining separate directory structures for temporary environments.

## The Limits of Workspaces

Workspaces isolate state, but they do not isolate everything around the run. The same root directory, backend configuration, and usually the same runner setup are still involved, so workspaces are weaker than separate environment directories for strict production boundaries.

Example: selecting the `prod` workspace while using development credentials can still fail or behave unexpectedly, because the workspace name alone does not grant or restrict cloud permissions.

![Workspaces split state, but shared code, backend settings, and credentials can still limit true environment isolation.](/content-assets/articles/article-iac-terraform-environments-workspaces/workspace-risk-boundary.png)

**Credentials are not isolated by the workspace feature.** The provider configuration is shared. If your security policy requires that production runs with different IAM roles, Azure subscriptions, or stricter permissions than development, workspaces cannot enforce that separation by themselves. Any separation depends on how you configure providers and runner credentials outside the workspace mechanism.

**No workspace-level variable files.** Terraform does not automatically load different `.tfvars` files per workspace. You can pass different files manually with `-var-file`, but there is no built-in mechanism to say "load dev.tfvars when in the dev workspace." You end up managing that in your deployment scripts rather than in Terraform itself.

**Scattered workspace-specific logic.** As configurations grow, workspace-conditional logic spreads throughout every resource block that needs different settings per environment. A large configuration might have dozens of `terraform.workspace == "prod" ?` conditions scattered everywhere. This is harder to audit than separate environment directories where each environment's configuration is self-contained.

**No protection from accidental applies.** If you accidentally run `terraform apply` in the `prod` workspace when you meant to be in `dev`, there is no structural barrier, the directory is the same, the backend is the same, only the workspace name is different. Separate directories make it much harder to accidentally target the wrong environment.

## Putting It All Together

Workspaces solve the code duplication problem elegantly for symmetric, same-account environments. One configuration directory, one backend configuration, multiple isolated state files. The `terraform.workspace` value lets the configuration adapt its resource sizes, counts, and names to the current environment.

For teams just starting out, or for environments that genuinely share a cloud security boundary and have primarily size-based differences, workspaces are a clean and simple approach. For organizations with strict account or subscription isolation, complex environment-specific architectures, or large teams where accidental cross-environment operations are a real risk, the separate-directory approach (covered in the next article) provides stronger guarantees.

## What's Next

The next article covers how to organize your Terraform repository using a file-layout strategy that keeps environments cleanly separated using separate directories and separate backends, the approach that scales better as organizations grow and security requirements increase.


![Workspaces summary: one configuration can have many states, but workspaces are not full production isolation by themselves.](/content-assets/articles/article-iac-terraform-environments-workspaces/workspaces-summary.png)

---

**References**

- [Workspaces (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/workspaces), Official reference for workspace commands, state isolation, and the `terraform.workspace` expression.
- [Using Workspaces (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/workspaces), CLI reference for all `terraform workspace` subcommands.
- [S3 Backend (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/settings/backends/s3), Official S3 backend behavior for workspaces and lock files.
- [AWS AMI Data Source (Terraform Registry)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami), Reference for looking up current Amazon Machine Images instead of hardcoding AMI IDs.

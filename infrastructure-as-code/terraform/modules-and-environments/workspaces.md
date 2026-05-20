---
title: "Workspaces"
description: "Use Terraform CLI workspaces carefully by understanding how they separate state, how S3 state paths change, and why major environments often need root modules."
overview: "Workspaces let one Terraform configuration use multiple named state instances. This article explains the default workspace, S3 backend paths, `terraform.workspace`, sandbox use cases, and the tradeoffs of using workspaces for dev and prod."
tags: ["terraform", "opentofu", "workspaces", "state", "environments"]
order: 4
id: article-infrastructure-as-code-terraform-workspaces
---

## Table of Contents

1. [Why Workspaces Matter](#why-workspaces-matter)
2. [What Workspaces Change](#what-workspaces-change)
3. [The Default Workspace](#the-default-workspace)
4. [State Paths](#state-paths)
5. [`terraform.workspace`](#terraformworkspace)
6. [Where Workspaces Fit](#where-workspaces-fit)
7. [Where Workspaces Confuse Environments](#where-workspaces-confuse-environments)
8. [Common First Mistakes](#common-first-mistakes)
9. [Putting It All Together](#putting-it-all-together)

## Why Workspaces Matter

The orders team has separate root modules for dev and prod. That is clear for real environments. Then an engineer asks a reasonable question: could workspaces make this simpler?

The idea is attractive. Instead of two directories, maybe one configuration can have two named states:

```bash
$ terraform workspace new dev
$ terraform workspace new prod
```

Then the configuration can use `terraform.workspace` in names and values. The file tree looks smaller, and Terraform keeps separate state for each workspace.

The danger is that smaller can also be less visible. A workspace changes the state instance Terraform uses, but it does not automatically create separate credentials, separate backend configuration, separate review rules, or separate environment files. To use workspaces well, you need to know exactly which boundary they create and which boundaries they leave to you.

## What Workspaces Change

A Terraform workspace is a named state instance for one configuration and backend. The configuration directory stays the same. The backend stays the same. The selected workspace decides which state data Terraform reads and writes.

You can see the current workspace with:

```bash
$ terraform workspace show
dev
```

You can list known workspaces:

```bash
$ terraform workspace list
  default
* dev
  prod
```

The asterisk marks the selected workspace. When Terraform runs a plan, it compares the current configuration with the state for that selected workspace.

This is the central mechanism. Workspaces separate state instances. They do not separate the code directory. They do not separate credentials by themselves. They do not make prod safer unless the surrounding workflow makes the selected workspace obvious and hard to misuse.

## The Default Workspace

Every Terraform configuration starts in a workspace named `default`. You cannot delete the default workspace. If you have never created or selected another workspace, you are using `default`.

That matters because many teams forget that `default` is a real state instance. If a developer runs `terraform apply` before selecting `dev`, Terraform may create resources in `default` state instead of the intended workspace.

For temporary stacks, this can create confusing leftovers. For important environments, it can create a serious review problem because the plan does not map cleanly to the expected environment name.

Treat workspace selection as part of the plan evidence. A reviewer should be able to see the selected workspace before approving the change.

## State Paths

The state path depends on the backend. With the local backend, non-default workspaces are stored under a local workspace state directory. With the S3 backend, the path changes inside the bucket.

Suppose the backend is configured like this:

```hcl
terraform {
  backend "s3" {
    bucket = "dp-terraform-state"
    key    = "orders/web/terraform.tfstate"
    region = "us-east-1"
  }
}
```

In the default workspace, Terraform stores state at the configured key:

```text
orders/web/terraform.tfstate
```

In a non-default workspace, the S3 backend stores state under the workspace key prefix, workspace name, and configured key. With the default workspace key prefix, the dev workspace path becomes:

```text
env:/dev/orders/web/terraform.tfstate
```

The prod workspace path becomes:

```text
env:/prod/orders/web/terraform.tfstate
```

This is useful because each workspace gets its own state object. It is also easy to miss because the backend block still says `key = "orders/web/terraform.tfstate"`. The selected workspace changes the final path.

For major environments, explicit root module keys such as `orders/dev/terraform.tfstate` and `orders/prod/terraform.tfstate` are often easier to inspect in code review.

## `terraform.workspace`

Terraform exposes the current workspace name through `terraform.workspace`. A configuration can use it in names, tags, or simple sizing decisions.

```hcl
locals {
  environment = terraform.workspace

  common_tags = {
    Service     = "orders"
    Environment = local.environment
  }
}

module "web" {
  source = "../../modules/aws-web-server"

  name_prefix   = "orders-${local.environment}"
  ami_id        = var.web_ami_id
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.public.id
  instance_type = local.environment == "prod" ? "t3.small" : "t3.micro"
  allowed_cidrs = local.environment == "prod" ? ["10.20.0.0/16"] : ["10.0.0.0/16"]
  common_tags   = local.common_tags
}
```

This works, but it concentrates environment decisions inside expressions. In a small sandbox, that may be fine. In a production environment, it can make review harder because prod differences are no longer sitting in a prod directory or prod values file.

The expression also grows quickly. Instance size, CIDR ranges, retention days, alarms, scaling limits, and feature flags can all become conditional on the workspace. Once that happens, the single configuration is carrying several environments at once.

## Where Workspaces Fit

Workspaces fit best when the infrastructure shape is almost identical and the stakes are low.

A common example is a developer sandbox:

```bash
$ terraform workspace new devpolaris-test
$ terraform plan
$ terraform apply
```

The workspace name can flow into resource names and tags:

```hcl
resource "aws_s3_bucket" "scratch" {
  bucket = "orders-${terraform.workspace}-scratch"

  tags = {
    Environment = terraform.workspace
    Service     = "orders"
  }
}
```

This lets several engineers create separate instances of the same lightweight stack without copying directories. The tradeoff is acceptable because the stacks are temporary, similar, and low risk.

Workspaces can also be useful for preview environments where automation controls creation, selection, naming, and cleanup. In that case, humans are less likely to type the wrong workspace name by hand.

## Where Workspaces Confuse Environments

Workspaces become risky when the environments need different boundaries.

Dev and prod often differ in several ways:

| Boundary | Dev and prod usually need |
| --- | --- |
| State | Separate state paths with obvious names |
| Credentials | Different AWS accounts or roles |
| Values | Different CIDRs, sizes, retention, and access rules |
| Review | Different approval rules and blast radius |
| Operations | Different apply windows and rollback expectations |

Workspaces solve the state row. They do not solve the other rows by themselves.

You can build automation around workspaces to supply the right credentials and values. Some teams do. But once you add that automation, the design is no longer "workspaces make environments simple." The design is "a workflow system uses workspaces as one piece of a larger environment boundary."

For a team learning Terraform, separate root modules are easier to reason about. The path, backend key, values file, provider identity, and CI job can all say `dev` or `prod` directly.

## Common First Mistakes

Workspace mistakes usually come from treating the workspace name as a complete environment.

**Forgetting the selected workspace.** Terraform runs against the current workspace. Always show or log the selected workspace before plan and apply.

**Using `default` accidentally.** The default workspace is real. If the team expects `dev`, select `dev` before planning.

**Embedding too many conditionals.** A few name or size differences are manageable. A full prod architecture hidden in conditional expressions becomes hard to review.

**Expecting workspaces to separate credentials.** Workspaces separate state instances. Credentials come from provider and runtime configuration.

**Using workspaces when root modules would be clearer.** Major environments usually deserve explicit directories, values, backend keys, and approval paths.

## Putting It All Together

The opening question was whether workspaces could replace separate dev and prod directories. They can separate state instances for one configuration, but that is only one part of an environment boundary.

Use workspaces when the stacks are similar, low risk, and controlled by a clear workflow. Developer sandboxes and preview stacks can fit that shape.

Use separate root modules when the environments need visible differences in values, credentials, review, and operating risk. Dev and prod AWS roots usually fit that shape better.

The useful mental model is precise: a workspace selects state for the current configuration. Everything else, including credentials, backend intent, review policy, and production safety, still needs to be designed around it.

---

**References**

- [Workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces) - Terraform documentation for named workspace state instances, the default workspace, and workspace use cases.
- [Manage workspaces](https://developer.hashicorp.com/terraform/cli/workspaces) - Terraform CLI documentation for creating, selecting, listing, and deleting workspaces.
- [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3) - Terraform backend reference for S3 state keys, `workspace_key_prefix`, and non-default workspace state paths.
- [Files and configuration structure](https://developer.hashicorp.com/terraform/language/files) - Terraform documentation for root module directories and configuration structure.

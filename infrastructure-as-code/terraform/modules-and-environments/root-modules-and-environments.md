---
title: "Root Modules and Environments"
description: "Organize Terraform root modules so AWS dev and prod environments have clear files, state, values, credentials, and review boundaries."
overview: "A root module is the directory Terraform runs from. This article uses dev and prod AWS roots to explain environment layout, S3 state keys, tfvars, credentials, workspace limits, and review boundaries."
tags: ["terraform", "opentofu", "aws", "root-modules", "environments", "state"]
order: 3
id: article-infrastructure-as-code-terraform-root-modules-and-environments
aliases:
  - root-modules-and-environments
  - infrastructure-as-code/terraform/root-modules-and-environments.md
---

## Table of Contents

1. [Why Environment Boundaries Matter](#why-environment-boundaries-matter)
2. [Root Modules](#root-modules)
3. [Environment Layout](#environment-layout)
4. [Separate State](#separate-state)
5. [Environment Values](#environment-values)
6. [Credentials](#credentials)
7. [Workspaces](#workspaces)
8. [Review Boundaries](#review-boundaries)
9. [Common First Mistakes](#common-first-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Environment Boundaries Matter

The orders service has a reusable web server module. Dev is working. Prod is next. The module can create the same kind of EC2 instance and security group in both places, but dev and prod should not feel like two values inside one loose pile of files.

Before anyone runs `terraform apply`, the team needs clear answers:

- Which directory is Terraform reading?
- Which S3 state key will Terraform update?
- Which AWS account and region will the provider use?
- Which values are dev values, and which values are prod values?
- Which plan is safe to approve?

These questions are environment questions. A child module can package a repeated pattern, but a root module draws the operating boundary for an environment.

## Root Modules

A root module is the directory where Terraform runs. Terraform reads the `.tf` files in that directory as one configuration. That directory usually contains provider configuration, backend configuration, module calls, resources, variables, outputs, and values for one operation boundary.

For AWS environments, a root module often maps to one service in one environment:

```text
infra/live/dev
infra/live/prod
```

Both root modules can call the same child module:

```hcl
module "web" {
  source = "../../modules/aws-web-server"

  name_prefix   = "orders-dev"
  ami_id        = var.web_ami_id
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.public.id
  instance_type = var.instance_type
  allowed_cidrs = var.allowed_cidrs
  common_tags   = local.common_tags
}
```

The child module creates the repeated web server shape. The root module decides the environment-specific details. That includes provider settings, state location, account identity, network IDs, allowed CIDRs, and tags.

This is why root modules are more than folders. They are the place where Terraform's action becomes specific enough to be risky.

## Environment Layout

A clear layout separates reusable modules from live environments:

```text
infra/
  modules/
    aws-web-server/
      main.tf
      variables.tf
      outputs.tf
  live/
    dev/
      backend.tf
      providers.tf
      main.tf
      terraform.tfvars
      outputs.tf
    prod/
      backend.tf
      providers.tf
      main.tf
      terraform.tfvars
      outputs.tf
```

The `modules` directory contains child modules. The `live` directory contains root modules that represent real environments. A pull request can now show whether a change affects the reusable module, dev, prod, or more than one boundary at once.

The dev root can pass small, low-cost values:

```hcl
environment   = "dev"
aws_region    = "us-east-1"
instance_type = "t3.micro"
allowed_cidrs = ["10.0.0.0/16"]
```

The prod root can pass production values:

```hcl
environment   = "prod"
aws_region    = "us-east-1"
instance_type = "t3.small"
allowed_cidrs = ["10.20.0.0/16"]
```

The shape is similar because both roots call the same child module. The values are separate because dev and prod carry different cost, access, and reliability expectations.

## Separate State

Each environment needs its own state. State is Terraform's record of which real objects belong to which resource addresses. If dev and prod share the same state path, Terraform can mix resources that should be managed separately.

With the S3 backend, the key is the path to the state object inside the bucket. Dev might use this backend configuration:

```hcl
terraform {
  backend "s3" {
    bucket       = "dp-terraform-state"
    key          = "orders/dev/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
```

Prod should use a different key:

```hcl
terraform {
  backend "s3" {
    bucket       = "dp-terraform-state"
    key          = "orders/prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
```

The difference between `orders/dev/terraform.tfstate` and `orders/prod/terraform.tfstate` is a real boundary. Terraform reads one state object, compares it to one configuration, and proposes changes for that managed set of objects.

Separate state also helps review. If the plan says it is running from `infra/live/dev` and using the dev state key, the reviewer knows the blast radius is dev. If a prod plan points at the dev state key, the plan is unsafe even if the HCL looks correct.

## Environment Values

Environment-specific values should be easy to find and easy to compare. Common differences include network ranges, instance sizes, account IDs, allowed CIDRs, feature flags, tags, and retention settings.

| Value | Dev | Prod |
| --- | --- | --- |
| Root module | `infra/live/dev` | `infra/live/prod` |
| State key | `orders/dev/terraform.tfstate` | `orders/prod/terraform.tfstate` |
| Instance type | `t3.micro` | `t3.small` |
| Allowed CIDRs | Sandbox or internal ranges | Approved production ranges |
| Tags | `Environment = dev` | `Environment = prod` |
| AWS account | Sandbox account | Production account |

`terraform.tfvars` is a common place for root module values:

```hcl
environment   = "prod"
aws_region    = "us-east-1"
instance_type = "t3.small"
allowed_cidrs = ["10.20.0.0/16"]
```

Other teams pass values through CI variables, `*.auto.tfvars` files, HCP Terraform variables, or a higher-level wrapper. The storage mechanism matters less than visibility. A reviewer should be able to see which values differ and which environment they affect.

Avoid hiding production differences inside a child module. If prod uses a larger instance type or narrower CIDR range, that decision belongs at the root module boundary or in the root module's value source. The child module can enforce the repeated shape, but the environment should choose the values.

## Credentials

Credentials should line up with root module boundaries. Dev Terraform should use credentials that can manage dev resources. Prod Terraform should use credentials that can manage prod resources.

A provider block usually names the region and lets the runtime supply credentials:

```hcl
provider "aws" {
  region = var.aws_region
}
```

The credentials can come from environment variables, a shared AWS profile, IAM Identity Center, role assumption, instance profiles, or a CI identity. Long-lived access keys embedded in `.tf` files create a security and rotation problem, and they also make review harder because the file no longer describes only infrastructure.

The important check is alignment. The root module path, backend key, provider region, account identity, and CI job should all point at the same intended environment.

```text
root module: infra/live/prod
state key:   orders/prod/terraform.tfstate
account:     production
region:      us-east-1
```

If any one of those points somewhere else, stop before apply. A correct resource block with the wrong AWS identity can still change the wrong infrastructure.

## Workspaces

Terraform CLI workspaces let one configuration use multiple named state instances. They can be useful for small, similar stacks, such as short-lived developer sandboxes that share the same shape and credentials.

They are usually weaker for major environments. Dev and prod often need separate directories, different values, different credentials, different approval rules, and clearer state keys. A workspace name in a prompt is easier to miss than a root module path that says `prod`.

Workspaces solve a narrower problem than many beginners expect. Treat them as state instances for one configuration, not as a full environment architecture by themselves.

The next article covers workspaces in detail. For dev and prod AWS roots, start with explicit root modules unless your team has strong automation around workspace selection and a clear reason to share one configuration directory.

## Review Boundaries

Environment boundaries are review boundaries. A reviewer should be able to identify the target before reading the resource changes.

For a dev plan:

```text
root module: infra/live/dev
state key:   orders/dev/terraform.tfstate
account:     sandbox
region:      us-east-1
```

For a prod plan:

```text
root module: infra/live/prod
state key:   orders/prod/terraform.tfstate
account:     production
region:      us-east-1
```

Those lines change how the plan should be read. A security group change in dev may be a quick review. The same change in prod may need a scheduled window, a rollback plan, and an approval from the service owner.

A shared child module can affect both roots. If `modules/aws-web-server` changes, run plans for every live root that calls it. The module is reusable, but the review evidence still belongs to each environment.

## Common First Mistakes

Environment mistakes usually come from blurred boundaries.

**Using one root module for every environment.** One directory can work for tiny experiments. Dev and prod become clearer when each has its own root module and state.

**Sharing one backend key.** The S3 backend key is where Terraform stores state. Dev and prod need different keys.

**Hiding prod values in a child module.** Environment choices should be visible at the root module or value source.

**Assuming the directory proves the account.** `infra/live/prod` is only safe if credentials and backend settings also point at prod.

**Using workspaces as an access boundary.** Workspaces separate state instances. They do not create separate credentials, approvals, or directories by themselves.

## Putting It All Together

The orders team wanted to reuse the web server shape without blurring dev and prod.

The workable structure is:

- One child module for the repeated web server pattern.
- One dev root module with dev values, dev credentials, and a dev S3 state key.
- One prod root module with prod values, prod credentials, and a prod S3 state key.
- Plans reviewed in the context of the root module, state key, account, and region that will be changed.

This answers the opening questions. Before apply, the team can tell which directory Terraform is reading, which state object it will update, which AWS identity it is using, and which values are specific to the environment.

Clear root modules make Terraform less surprising. They put the operating boundary in the file tree, the backend key, the credentials, and the review process.

## What's Next

The next article looks closely at Terraform CLI workspaces. Workspaces can be useful, but they are easy to confuse with full dev and prod separation. The details matter because the state path changes while the configuration directory stays the same.

---

**References**

- [Files and configuration structure](https://developer.hashicorp.com/terraform/language/files) - Terraform documentation for root modules and configuration files in a directory.
- [Modules overview](https://developer.hashicorp.com/terraform/language/modules) - Terraform overview of root modules, child modules, and module hierarchy.
- [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3) - Terraform backend reference for S3 state storage, state keys, and lock files.
- [Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Terraform documentation for root module values, variable definition files, environment variables, and precedence.
- [Provider configuration](https://developer.hashicorp.com/terraform/language/block/provider) - Terraform language reference for provider configuration blocks.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Terraform Registry documentation for configuring and using the AWS provider.
- [Workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces) - Terraform documentation for named workspace state instances and workspace tradeoffs.

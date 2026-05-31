---
title: "File Layout and Environment Isolation"
description: "Organize your Terraform repository with a directory structure that keeps environments cleanly separated and scales with your team."
overview: "How you lay out your Terraform files matters as much as what you put in them. A well-organized repository makes it easy to find configuration, hard to accidentally affect the wrong environment, and simple to share code through modules. This article covers the standard file layout patterns and how to choose between them."
tags: ["file layout", "environments", "organization", "repository", "terraform"]
order: 2
id: article-iac-terraform-environments-file-layout
---

## Table of Contents

1. [Why File Layout Matters](#why-file-layout-matters)
2. [The Standard File Naming Convention](#the-standard-file-naming-convention)
3. [The Flat Layout: Simple Projects](#the-flat-layout-simple-projects)
4. [The Module-and-Environments Layout](#the-module-and-environments-layout)
5. [The Global-Staging-Prod Layout](#the-global-staging-prod-layout)
6. [Sharing Variable Values Across Environments](#sharing-variable-values-across-environments)
7. [What Belongs in Version Control](#what-belongs-in-version-control)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why File Layout Matters

Terraform does not force you into any particular directory structure. You can put all your resources in a single `main.tf` file if you like. For a learning exercise or a quick prototype, that is fine. For a configuration that will live for years, be touched by multiple teams, and manage dozens or hundreds of resources across several environments, a flat single-file approach becomes a maintenance nightmare.

![Environment directory boundaries keep dev, staging, and production roots tied to separate variables and state.](/content-assets/articles/article-iac-terraform-environments-file-layout/environment-directory-boundary.png)

File layout communicates intent. When you open a repository with clearly organized directories, you immediately understand what the repository manages, how it is divided, and where to look for specific resources. When you open a repository where everything is in one directory — a single `main.tf` with hundreds of lines, every environment's resources mixed together — you have to read the entire file to understand what it does.

The right layout also enforces safety. If dev, staging, and production resources each live in their own directory with their own backend configuration, running a command in the dev directory cannot possibly affect production. The backend configuration points to different state, and the Terraform command only processes the files in the directory where you run it. This structural separation is a genuine safeguard against accidental cross-environment changes.

## The Standard File Naming Convention

Terraform does not care what you name your files, but the community has settled on conventions that make configurations immediately recognizable to anyone who has worked with Terraform before.

`main.tf` contains the core resource definitions — the things the configuration actually creates. For simple projects this is where most of the code lives. For complex projects it might just hold the top-level module calls.

`variables.tf` contains all `variable` blocks — the input parameters for the configuration. Keeping these in one file means anyone who wants to understand what inputs the configuration accepts has one place to look.

`outputs.tf` contains all `output` blocks. Same logic: one file, all outputs, easy to find.

`locals.tf` or inline in `main.tf` contains `locals` blocks with computed intermediate values. For small configurations, locals can live in `main.tf`. For larger ones, a separate file keeps them organized.

`versions.tf` or the `terraform {}` block in `main.tf` contains the `required_version` and `required_providers` constraints. Some teams put this in `main.tf`, others prefer a dedicated file. The important thing is consistency.

`backend.tf` contains the backend configuration when it is specific to an environment. For configurations using partial backend configuration (where the key is passed in via `terraform init`), there may not be a separate backend file.

For modules, the same conventions apply inside the module directory: `main.tf`, `variables.tf`, `outputs.tf`.

## The Flat Layout: Simple Projects

For a project with one environment and a manageable number of resources, a flat layout works fine:

```
my-project/
  main.tf
  variables.tf
  outputs.tf
  terraform.tfvars
  .terraform.lock.hcl
```

All the resource blocks live in `main.tf`. All variables are in `variables.tf`. All outputs are in `outputs.tf`. The `terraform.tfvars` file provides concrete values for the variables. The `.terraform.lock.hcl` file is committed to version control to lock provider versions.

This layout has no room for environments. It manages exactly one environment. If you need a second environment, you need to either add workspaces (sharing the configuration but switching state) or graduate to a layout that has explicit environment directories.

## The Module-and-Environments Layout

Once you have more than one environment, the module-and-environments layout is the most scalable approach:

![A shared module can feed separate environment roots while each environment owns its own backend and variable values.](/content-assets/articles/article-iac-terraform-environments-file-layout/shared-module-layout.png)

```
my-project/
  modules/
    network/
      main.tf
      variables.tf
      outputs.tf
    database/
      main.tf
      variables.tf
      outputs.tf
    compute/
      main.tf
      variables.tf
      outputs.tf
  environments/
    dev/
      main.tf
      variables.tf
      terraform.tfvars
      backend.tf
    staging/
      main.tf
      variables.tf
      terraform.tfvars
      backend.tf
    prod/
      main.tf
      variables.tf
      terraform.tfvars
      backend.tf
```

The `modules/` directory contains reusable, parameterized modules. Each module directory is self-contained with its own variables, outputs, and resource definitions. No module knows which environment will call it.

The `environments/` directory contains one directory per environment. Each environment directory calls the shared modules with environment-specific variable values. The `backend.tf` in each environment points to that environment's specific state location.

For the `dev` environment, `main.tf` looks like:

```hcl
module "network" {
  source = "../../modules/network"

  region     = var.region
  cidr_block = var.cidr_block
}

module "database" {
  source = "../../modules/database"

  vpc_id    = module.network.vpc_id
  subnet_id = module.network.db_subnet_id
  password  = var.db_password
}

module "compute" {
  source = "../../modules/compute"

  vpc_id        = module.network.vpc_id
  subnet_id     = module.network.web_subnet_id
  instance_type = var.instance_type
  count         = var.instance_count
}
```

The `prod` environment's `main.tf` is structurally identical — the same module calls in the same order. The `terraform.tfvars` files differ:

`dev/terraform.tfvars`:
```hcl
region         = "us-east-1"
cidr_block     = "10.0.0.0/16"
instance_type  = "t3.micro"
instance_count = 1
```

`prod/terraform.tfvars`:
```hcl
region         = "us-east-1"
cidr_block     = "10.1.0.0/16"
instance_type  = "t3.medium"
instance_count = 4
```

The code is shared through modules. The environment-specific values are confined to the `terraform.tfvars` files and the `backend.tf` configuration. Deploying to dev means `cd environments/dev && terraform apply`. Deploying to prod means `cd environments/prod && terraform apply`. The directory structure makes the target explicit.

## The Global-Staging-Prod Layout

Some organizations add another dimension to the layout: the distinction between global infrastructure (resources that exist once, across all environments) and environment-specific infrastructure.

Global resources are things like DNS zones, ECR repositories for container images, shared IAM policies that all environments reference, and organization-level CloudTrail logging buckets. These resources typically exist in a single AWS account and are managed by a dedicated team.

Environment-specific resources are the compute, database, and network resources that each environment owns independently.

The layout adds a `global/` tier:

```
infrastructure/
  global/
    iam/
      main.tf
    dns/
      main.tf
  staging/
    network/
      main.tf
    services/
      main.tf
  prod/
    network/
      main.tf
    services/
      main.tf
```

Each leaf directory (like `staging/network/` or `prod/services/`) is its own independent root configuration with its own state file. This gives you fine-grained control over which pieces of infrastructure are applied together.

For example, the network configuration in production changes infrequently and should never be applied as part of a routine application deployment. Keeping it in a separate directory with a separate state file means the application team can run `terraform apply` in `prod/services/` without ever touching `prod/network/`. The network team manages `prod/network/` on its own schedule with its own approval process.

This layout is more complex to navigate, but it provides the strongest isolation. A mistake in `prod/services/` cannot affect `prod/network/` because they have separate state files, separate backends, and separate apply operations.

## Sharing Variable Values Across Environments

A common frustration with the module-and-environments layout is that some variable values are the same across all environments — the project name, the DNS zone, the GitHub organization name. When these values are in every environment's `terraform.tfvars`, you have to update them in multiple places when they change.

One approach is to use a common variables file that all environments include:

```bash
terraform apply -var-file=../../common.tfvars -var-file=terraform.tfvars
```

The `-var-file` flag is processed in order, with later files overriding earlier ones. `common.tfvars` at the repository root holds values shared by all environments. Each environment's local `terraform.tfvars` holds environment-specific overrides. This keeps repetition low without requiring complex tooling.

Another approach is to use a wrapper tool like Terragrunt, which extends Terraform with a hierarchy of configuration files and automatic common-value inheritance. Terragrunt is outside the scope of this article, but it is worth knowing it exists for large repositories where managing hundreds of `terraform.tfvars` files manually becomes impractical.

## What Belongs in Version Control

Everything related to the Terraform configuration should be in version control, with three exceptions.

Commit:
- All `.tf` configuration files
- All `.tfvars` files that do not contain secrets (region names, instance types, CIDR blocks, feature flags)
- The `.terraform.lock.hcl` provider lock file — this is critical for team consistency
- Any `backend.tf` files or backend configuration that contains only non-secret settings, such as bucket/container names, regions, and state keys

Do not commit:
- The `.terraform/` directory — this is local working state generated by `terraform init` and is too large and environment-specific to be useful in version control
- `terraform.tfstate` and `terraform.tfstate.backup` files — local state files should never be in version control; state belongs in a remote backend
- `.tfvars` files that contain secrets — database passwords, API keys, private certificate material. Use environment variables (`TF_VAR_`) or a secrets manager for these values
- Backend credential material, such as AWS access keys, Azure Storage account access keys, SAS tokens, or client secrets. Pass these through environment variables, workload identity, managed identity, Key Vault, or your CI/CD secret store instead of committing them.

On Azure, the state storage account deserves the same care as a secrets store. Prefer Microsoft Entra ID/RBAC access to Blob Storage where possible, keep storage encryption enabled, and use private endpoints or network rules when your security posture requires the state backend to stay off the public internet.

A `.gitignore` file appropriate for a Terraform project:

```
.terraform/
*.tfstate
*.tfstate.backup
*.tfvars.backup
crash.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json
```

Some teams choose to also gitignore `terraform.tfvars` if that file might contain secrets. In that case, each engineer creates their own local `terraform.tfvars` from a checked-in `terraform.tfvars.example` template.

## Putting It All Together

Good file layout turns a pile of Terraform code into a navigable repository that a new team member can understand in an hour and that makes safe deployments the path of least resistance.

The standard file naming convention — `main.tf`, `variables.tf`, `outputs.tf` — creates a consistent vocabulary that anyone familiar with Terraform recognizes immediately. The module-and-environments layout separates shared infrastructure patterns (modules) from environment-specific wiring (environment directories), so changing an instance type in production requires only editing the production `terraform.tfvars` file rather than hunting through shared code.

The `.terraform.lock.hcl` file goes in version control to freeze provider versions across the team. State files and secrets stay out of version control entirely. The directory structure itself enforces that a deploy command run in the dev directory cannot reach production.

## What's Next

The next article covers the third dimension of environment security: managing secrets. Database passwords, API keys, and private certificates inevitably appear somewhere in Terraform configurations. The next article examines the options — environment variables, Vault integration, AWS Secrets Manager data sources, and encrypted variable files — and explains which approach is appropriate in which situation.


![File layout summary: separate roots, share modules, keep state isolated, and version only safe files.](/content-assets/articles/article-iac-terraform-environments-file-layout/file-layout-summary.png)

---

**References**

- [Module Structure (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/develop/structure) — HashiCorp's recommended module directory structure.
- [.gitignore for Terraform (GitHub)](https://github.com/github/gitignore/blob/main/Terraform.gitignore) — The community-maintained Terraform `.gitignore` file.
- [Backend Configuration (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/settings/backends/configuration) — Official backend configuration guidance, including partial configuration.
- [Store Terraform State in Azure Storage (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/store-state-in-azure-storage) — Microsoft guidance for Azure Storage-backed Terraform state.
- [Authorize Azure Blob Access with Microsoft Entra ID (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory) — Microsoft guidance for RBAC-based blob access.
- [Terraform Up & Running, 3rd Edition (Yevgeniy Brikman)](https://www.terraformupandrunning.com) — Chapter 5 covers repository structure and the global/staging/prod layout pattern in detail.

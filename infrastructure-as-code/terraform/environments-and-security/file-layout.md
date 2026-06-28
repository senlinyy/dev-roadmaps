---
title: "File Layout and Environment Isolation"
description: "Directory-based environment isolation as the clear default for beginner Terraform projects and growing teams."
overview: "Terraform file layout is an operations choice. This article starts with dev and prod needing different blast radius, then shows a practical live/modules layout that keeps backend state, provider targets, variables, credentials context, and reusable modules easy to review."
tags: ["file layout", "environments", "organization", "repository", "terraform"]
order: 2
id: article-iac-terraform-environments-file-layout
---

## Table of Contents

1. [Why Layout Is a Safety Choice](#why-layout-is-a-safety-choice)
2. [A Practical live/modules Repository](#a-practical-livemodules-repository)
3. [What Lives in an Environment Folder](#what-lives-in-an-environment-folder)
4. [What Lives in a Shared Module Folder](#what-lives-in-a-shared-module-folder)
5. [How the Plan Proves the Target](#how-the-plan-proves-the-target)
6. [Layout Rules That Age Well](#layout-rules-that-age-well)
7. [Putting It All Together](#putting-it-all-together)

The previous article focused on the identity Terraform uses for a run. The next safety question is where that run starts. A person can have the right credentials and still run Terraform from the wrong folder, load the wrong variables, or point at the wrong state file.

This article uses a directory-first layout because it is the clearest default for beginners. Dev and prod get separate root folders, each folder owns its backend settings and input values, and shared modules stay in a separate `modules/` area. Workspaces come after this article because they are useful, but the directory shape gives a new team the easiest thing to review.

## Why Layout Is a Safety Choice
<!-- section-summary: File layout controls how easy it is to see the target environment, backend, variables, and reusable module boundaries. -->

The billing team has two environments: dev and prod. Dev can tolerate mistakes. Prod holds real customer-facing infrastructure, stricter approvals, tighter access, and a larger blast radius.

Terraform lets the team choose a repository layout, so choose a shape that makes the target obvious. A reviewer should be able to answer these questions quickly: which environment is changing, which state file will Terraform use, which account or subscription is targeted, and which shared modules are involved?

A directory-based layout puts those answers in visible files. `live/dev` can point at the development state backend and development provider target. `live/prod` can point at the production state backend and production provider target. The folder name, backend key, variable file, and plan output should all agree before anyone applies.

The layout also shapes permissions. A protected production folder can require stricter code owners and CI approvals. A development folder can allow faster iteration. Shared modules can require module owners because a module change may affect several environments after each one plans.

## A Practical live/modules Repository
<!-- section-summary: live folders hold deployable stacks, while modules hold reusable infrastructure code with inputs and outputs. -->

A common starting layout has two top-level ideas. `live/` contains runnable root modules. `modules/` contains reusable building blocks. The skeleton looks like this:

```
terraform/
  live/
    <environment>/
      backend.hcl
      main.tf
      providers.tf
      terraform.tfvars
      variables.tf
  modules/
    <module-name>/
      variables.tf
      main.tf
      outputs.tf
```

The concrete billing version adds `dev`, `prod`, and a reusable log bucket module:

![Environment Directory Boundary](/content-assets/articles/article-iac-terraform-environments-file-layout/environment-directory-boundary.png)

*The boundary view shows why environment folders, backend keys, credentials, and variable files need to point at the same target.*

```
terraform/
  live/
    dev/
      backend.hcl
      main.tf
      providers.tf
      terraform.tfvars
      variables.tf
    prod/
      backend.hcl
      main.tf
      providers.tf
      terraform.tfvars
      variables.tf
  modules/
    log-bucket/
      variables.tf
      locals.tf
      main.tf
      outputs.tf
```

Each folder under `live/` is a deployable root module. It has its own backend settings, provider configuration, variables, and module calls. The `modules/` folder contains reusable building blocks.

This split gives changes a clear meaning. A change under `live/prod` changes production wiring. A change under `live/dev` changes development wiring. A change under `modules/log-bucket` changes shared module code, so every environment that calls it should run a plan before applying.

As the repository grows, many teams add a second level for account, region, or stack:

```
terraform/
  live/
    prod/
      eu-west-2/
        network/
        billing/
        observability/
    dev/
      eu-west-2/
        billing/
  modules/
    log-bucket/
    service-network/
    alarms/
```

The exact names vary, but the rule stays practical. Each deployable folder should map to one backend state record and one clear operational target.

For a beginner project, the smaller shape is a safer starting point than the second tree. One `live/dev` folder, one `live/prod` folder, and one or two modules give the team enough structure without turning the repository into a maze. Deeper splits make sense only for real operational boundaries, such as a separate network stack, a separate account, or a service with a different release schedule.

## What Lives in an Environment Folder
<!-- section-summary: An environment folder chooses backend state, provider target, and module input values. -->

The production folder chooses the production state path. The backend file has one job: name the state target clearly.

```hcl
bucket       = "dp-terraform-state-prod"
key          = "infrastructure/billing/prod/terraform.tfstate"
region       = "us-east-1"
use_lockfile = true
```

`bucket` is the remote state bucket. `key` is the exact object path for the production state file, so a wrong key can make Terraform plan against the wrong history. `region` is where the backend lives. `use_lockfile = true` enables S3-native state locking, which creates a lock object next to the state path so two writers do not update the same state at the same time.

The current Terraform S3 backend documentation lists S3 locking through `use_lockfile` and marks DynamoDB-based locking as deprecated. Older examples often use a DynamoDB lock table, so new layouts should prefer `use_lockfile = true` unless a migration requires both mechanisms for a while.

Backend files should identify the state location, not contain long-lived backend credentials. Terraform stores the final merged backend configuration under `.terraform/` after `terraform init`, and saved plan files can carry backend configuration too. This means values such as `access_key`, `secret_key`, storage account keys, or tokens should come from the runner identity, cloud CLI profile, environment-based credential flow, or CI secret mechanism instead of being written into `backend.hcl`.

A safe `backend.hcl` names the state target:

```hcl
bucket       = "dp-terraform-state-prod"
key          = "infrastructure/billing/prod/terraform.tfstate"
region       = "us-east-1"
use_lockfile = true
```

A risky backend file adds secret material to the same place:

```hcl
bucket     = "dp-terraform-state-prod"
key        = "infrastructure/billing/prod/terraform.tfstate"
region     = "us-east-1"
access_key = "AKIA..."
secret_key = "..."
```

The risky version can leak through local `.terraform` metadata, shell history if passed as command-line `-backend-config` values, or saved plan artifacts. The AWS profile, OIDC-assumed role, or CI runner identity should authenticate to the backend instead.

It also chooses production values:

```hcl
environment    = "prod"
service_name   = "billing"
retention_days = 90

extra_tags = {
  owner       = "platform"
  cost_center = "finops-42"
}
```

The root module passes those values into a shared module:

```hcl
module "log_bucket" {
  source = "../../modules/log-bucket"

  environment    = var.environment
  service_name   = var.service_name
  retention_days = var.retention_days
  extra_tags     = var.extra_tags
}
```

The environment folder should make production choices visible: backend key, provider account or subscription, region, variable values, and module versions or sources. It should avoid hiding the important targeting details only inside CI scripts.

Provider configuration belongs here too:

```hcl
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      environment = var.environment
      service     = var.service_name
      managed_by  = "terraform"
    }
  }
}
```

The root module should choose the provider target. A child module can stay reusable because it receives the provider configuration from the root run.

## What Lives in a Shared Module Folder
<!-- section-summary: A shared module declares inputs, shapes locals, creates resources, and publishes outputs. -->

The shared module owns the repeated resource pattern. It receives values from the environment root and turns them into resources.

![Shared Module Layout](/content-assets/articles/article-iac-terraform-environments-file-layout/shared-module-layout.png)

*The module layout view separates reusable code from runnable environment roots, which keeps review focused on the target stack.*

`variables.tf`:

```hcl
variable "environment" {
  type        = string
  description = "Environment name, such as dev or prod."
}

variable "service_name" {
  type        = string
  description = "Service name used in bucket naming and tags."
}

variable "retention_days" {
  type        = number
  description = "Number of days to keep log objects."
}

variable "extra_tags" {
  type        = map(string)
  description = "Additional tags applied to the log bucket."
  default     = {}
}
```

`locals.tf`:

```hcl
locals {
  bucket_name = "dp-${var.service_name}-${var.environment}-logs"

  tags = merge(
    {
      service     = var.service_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.extra_tags
  )
}
```

`main.tf`:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    expiration {
      days = var.retention_days
    }
  }
}
```

`outputs.tf`:

```hcl
output "bucket_name" {
  value       = aws_s3_bucket.logs.bucket
  description = "Name of the log bucket."
}
```

The value path is clear. `live/prod/terraform.tfvars` supplies `environment` and `service_name`. `live/prod/main.tf` passes them into the module. The module locals build names and tags. The resources consume those locals. The output returns the bucket name.

Shared modules should avoid hardcoding backend names, provider credentials, workspace names, or production-only values. Those decisions belong in the root. The module should describe the resource pattern and accept the environment facts it needs through variables.

## How the Plan Proves the Target
<!-- section-summary: A plan should show environment-specific names, tags, backend context, and module addresses that match the folder you intended to run. -->

From `live/prod`, the basic commands should be boring:

```bash
terraform init -backend-config=backend.hcl
terraform plan -var-file=terraform.tfvars
```

`-backend-config=backend.hcl` points `init` at this environment's backend file. `-var-file=terraform.tfvars` loads the production input values for the plan. Together, those two flags say which state history Terraform reads and which environment values it evaluates.

During `init`, Terraform should confirm the backend it configured:

```console
Initializing the backend...

Successfully configured the backend "s3"! Terraform will automatically
use this backend unless the backend configuration changes.
```

The success message only proves that the backend type initialized. The folder and backend key still need review because a valid backend can still be the wrong backend.

The plan should show production names, tags, and module addresses:

```console
  # module.log_bucket.aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "cost_center" = "finops-42"
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }
```

If a production plan shows development names, the variable file needs review. If it shows a large create plan for existing resources, the backend key needs review. If it uses a surprising module source path, the module call needs review before applying.

Many CI jobs print context before the plan:

```bash
pwd
echo "backend_key=infrastructure/billing/prod/terraform.tfstate"
terraform workspace show
terraform plan -var-file=terraform.tfvars
```

The output should help reviewers connect the folder, state target, workspace, and planned resources:

```console
/home/runner/work/devpolaris/terraform/live/prod
backend_key=infrastructure/billing/prod/terraform.tfstate
default
```

`pwd` should end in `live/prod`, the printed backend key should include `prod`, and the plan should show production names and tags. In a directory-first layout, many teams keep the workspace as `default` because the directory and backend key already provide the environment separation. The next article explains the cases where named workspaces add value.

A strong plan review checks the whole chain:

1. The working directory matches the intended environment.
2. The backend key contains the same environment name.
3. The provider account and region match the environment.
4. The variable file values match the environment.
5. The planned resource names, tags, and module addresses match the same target.

## Layout Rules That Age Well
<!-- section-summary: Good layouts make environment context explicit, keep modules reusable, and avoid hiding backend or provider choices in scripts. -->

Root modules should stay deployable. A person should be able to enter `live/prod`, initialize the backend, run a plan, and understand the target without reverse engineering a wrapper script.

Modules should stay reusable. A module should declare inputs and outputs clearly, avoid hardcoded environment names, and let root modules choose provider configuration, backend state, and environment values.

Backend config should stay visible. Hidden backend flags in CI make state targeting hard to review. A checked-in backend file or backend template gives reviewers something concrete to inspect.

A stack split helps after one plan has too much blast radius. If one root manages networking, databases, clusters, monitoring, and application deploy roles together, small changes can produce slow plans and nervous reviews. Separate roots can help for parts with different owners, apply schedules, state access, or recovery procedures.

File count alone is a weak reason to split a stack. The stronger reason is an operational boundary. Networking may have a rare apply schedule and tight permissions. Application buckets may change weekly. Observability dashboards may be owned by another team. Separate roots let each area have its own state, lock, approvals, and recovery runbook.

## Putting It All Together
<!-- section-summary: Terraform layout should make the environment, backend, provider target, module source, and plan impact visible. -->

File layout is part of Terraform safety. Dev and prod need different blast radius, so their state, variables, provider targets, and approvals should be easy to see. Shared modules still remove repetition, but environment roots decide where the change lands.

![File Layout Summary](/content-assets/articles/article-iac-terraform-environments-file-layout/file-layout-summary.png)

*The summary board collects the layout rules that make Terraform repositories safer as teams and environments grow.*

The directory-first layout also prepares the next topic. Once the team understands environment folders and state keys, workspaces are clearer to judge as one state-separation tool among several.

---

**References**

- [Terraform: Modules](https://developer.hashicorp.com/terraform/language/modules) - Explains root modules, child modules, module sources, inputs, and outputs.
- [Terraform: Backend configuration](https://developer.hashicorp.com/terraform/language/backend) - Documents backend blocks and partial backend configuration.
- [Terraform: S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3) - Documents S3 backend settings, `use_lockfile`, S3 state locking, permissions, and DynamoDB locking deprecation.
- [Terraform: Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Covers variable declarations, value assignment, and validation.
- [Terraform: Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Documents module outputs and how values move between modules.

---
title: "Remote Backends"
description: "Store Terraform state in a shared, remote location so your whole team works from the same state record."
overview: "A remote backend stores Terraform state outside your laptop. This article shows backend configuration, partial backend config, environment-specific state keys, initialization, and the way backends affect team workflows without appearing as normal plan resources."
tags: ["state", "backend", "s3", "remote", "terraform"]
order: 2
id: article-iac-terraform-state-remote-backends
---

## Table of Contents

1. [What a Remote Backend Does](#what-a-remote-backend-does)
2. [Backend Configuration in .tf Files](#backend-configuration-in-tf-files)
3. [Supplying Backend Values Safely](#supplying-backend-values-safely)
4. [Initializing and Migrating State](#initializing-and-migrating-state)
5. [How Backends Affect Plans](#how-backends-affect-plans)
6. [Operational Checks for Teams](#operational-checks-for-teams)
7. [Putting It All Together](#putting-it-all-together)

## What a Remote Backend Does
<!-- section-summary: A remote backend gives a team one shared state location instead of many local state files on laptops. -->

A **backend** tells Terraform where to store state. The default backend is local, which writes `terraform.tfstate` in the working directory. A **remote backend** stores state in a remote service such as HCP Terraform, S3, Azure Storage, Google Cloud Storage, or another supported backend.

Remote state matters as soon as more than one person or pipeline touches the same stack. If Alice applies from her laptop and Bob applies from his laptop with separate local state files, each person has only part of the truth. A remote backend gives everyone one shared record.

Remote backends also support production controls: access control, encryption, audit logs, state versioning, and in many cases locking. Those controls protect the state file and make automation safer.

## Backend Configuration in .tf Files
<!-- section-summary: Backend configuration lives inside the terraform block and is used during init, not managed like a normal resource. -->

Backend configuration usually lives in `backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket       = "dp-terraform-state-prod"
    key          = "infrastructure/billing/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

This block does not create the S3 bucket or the lock file setup. It tells Terraform where to store the state for this working directory. The backend infrastructure usually gets bootstrapped separately by a platform team, a one-time Terraform stack, or a controlled manual process.

Backend blocks have an important limit: they cannot use variables, locals, data sources, or resource attributes. Terraform needs the backend before it can load the rest of the configuration and state, so the backend values must be known during `terraform init`.

:::expand[Why backend blocks cannot use variables]{kind="design"}
Terraform has to know where state lives before it can evaluate normal Terraform expressions. Variables, locals, data sources, and resources are all part of the configuration graph that Terraform builds after backend initialization.

If backend configuration could depend on `var.environment`, Terraform would need state to evaluate the variable context, but it would need the backend to find state. That creates a startup problem. Terraform avoids it by making backend configuration a special initialization-time setting.

Teams handle this with separate directories, generated backend config files, or `terraform init -backend-config=...` arguments supplied by automation.
:::

## Supplying Backend Values Safely
<!-- section-summary: Partial backend configuration keeps stable settings in code and lets CI supply environment-specific values during init. -->

Many teams use partial backend configuration. The `.tf` file declares the backend type and empty keys:

```hcl
terraform {
  backend "s3" {
    bucket       = ""
    key          = ""
    region       = ""
    encrypt      = true
    use_lockfile = true
  }
}
```

Then each environment has a backend config file outside the main module:

```hcl
bucket       = "dp-terraform-state-prod"
key          = "infrastructure/billing/prod/terraform.tfstate"
region       = "us-east-1"
use_lockfile = true
```

The pipeline supplies it during initialization:

```bash
terraform init -backend-config=backend/prod.s3.hcl
```

Avoid placing credentials in backend config files. Use the normal credential path for the backend platform, such as workload identity, OIDC, environment variables, or a secure runner identity. Backend configuration can be copied into `.terraform/` metadata and saved plan files, so secrets in backend settings can leak.

## Initializing and Migrating State
<!-- section-summary: terraform init configures the backend locally and can migrate existing state when the backend location changes. -->

`terraform init` configures the backend for the current working directory. If you add or change a backend block, Terraform asks you to reinitialize. If local state already exists, Terraform can offer to migrate it to the new backend.

A typical first setup looks like this:

```bash
terraform init -backend-config=backend/prod.s3.hcl
terraform plan -var-file=env/prod.tfvars
```

The backend affects where Terraform reads and writes state. The variable file affects the values consumed by resources. Keep those two ideas separate: backend config chooses the state location, while variables choose infrastructure settings.

Before migrating a real production state file, make a backup through the backend's versioning feature or a controlled state pull. State migration is a small command with a large blast radius, so teams usually run it during a quiet window and save the exact command in the change record.

## How Backends Affect Plans
<!-- section-summary: Backends do not appear as normal resources in plan output, but they control which state record Terraform compares against the configuration. -->

Backend configuration does not show up like a resource in `terraform plan`. You will not see `aws_s3_bucket.dp-terraform-state-prod` created just because the backend block mentions a bucket.

What changes is the state record Terraform uses. If the backend key is `infrastructure/billing/prod/terraform.tfstate`, Terraform compares the current `.tf` files against the production billing state. If the backend key is accidentally set to `infrastructure/billing/dev/terraform.tfstate`, Terraform compares the same `.tf` files against development state.

That mistake can produce a terrifying plan:

```hcl
Plan: 34 to add, 0 to change, 0 to destroy.
```

The code may be fine. The backend key may be wrong. This is why CI jobs should print the selected workspace, backend key, account, and variable file before running a plan.

## Operational Checks for Teams
<!-- section-summary: A backend setup is healthy when access, locking, versioning, and environment keys are deliberate and visible. -->

A production backend needs more than a bucket name. Check that the backend store has encryption enabled, versioning or backups, restricted access, audit logs, and locking where the backend supports it. The automation identity should have the minimum permissions needed to read, write, lock, and unlock that specific state path.

State keys should be boring and explicit:

```hcl
infrastructure/<service>/<environment>/terraform.tfstate
```

That path makes it harder to mix environments by accident. It also helps incident response because the state object path tells you which stack it belongs to.

## Putting It All Together
<!-- section-summary: Remote backends make Terraform collaborative by putting state in one protected, shared location. -->

A remote backend is part of the Terraform safety system. It gives the team one state record, protects that record with platform controls, and lets CI/CD run plans against the same data humans use.

Review backend changes carefully. Check the backend type, state key, environment, account, locking setup, and credential path. The backend may not appear in the plan, but it decides which infrastructure the plan is comparing against.

For official reference, use Terraform's docs for [backend configuration](https://developer.hashicorp.com/terraform/language/backend), [the S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3), [state](https://developer.hashicorp.com/terraform/language/state), and [`terraform init`](https://developer.hashicorp.com/terraform/cli/commands/init).

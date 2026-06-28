---
title: "Workspaces"
description: "Where Terraform workspaces help, where they add risk, and how directory isolation can give a clearer environment boundary."
overview: "Terraform workspaces let one configuration directory use multiple state instances. This article builds on directory-based environment isolation, then shows workspace commands, runtime context, plan checks, preview-environment use cases, and the review case for separate directories."
tags: ["workspaces", "state", "environments", "isolation", "terraform"]
order: 3
id: article-iac-terraform-environments-workspaces
---

## Table of Contents

1. [Why Workspaces Exist](#why-workspaces-exist)
2. [Creating and Selecting Workspaces](#creating-and-selecting-workspaces)
3. [Using terraform.workspace in Configuration](#using-terraformworkspace-in-configuration)
4. [How Workspace Values Appear in Plans](#how-workspace-values-appear-in-plans)
5. [Where Workspaces Fit](#where-workspaces-fit)
6. [Where Directories Are Clearer](#where-directories-are-clearer)
7. [Putting It All Together](#putting-it-all-together)

The previous article used separate folders for dev and prod because that layout makes the target visible before Terraform runs. Workspaces solve a different problem. They let the same configuration directory keep multiple state records, which can be handy for environments with the same shape and low risk.

The beginner trap is treating a workspace name as the whole environment boundary. A workspace selects state. The provider account, credentials, backend, variables, approvals, and resource names still need their own checks. This article keeps those checks visible while showing where workspaces are useful.

## Why Workspaces Exist
<!-- section-summary: A workspace is a named state instance for the same Terraform configuration directory. -->

A small training project creates one log bucket. The team wants a dev copy and a prod copy from the same `.tf` files. The resource shape is the same, but each environment needs its own state record.

A **Terraform workspace** is a named state instance for one configuration directory. The selected workspace decides which state record Terraform reads and writes. The default workspace always exists, and you can create more names such as `dev`, `stage`, `prod`, or `pr-142`.

Workspaces are useful for repeated low-risk stacks and preview environments. They are also easy to misuse because the selected workspace is runtime context. The `.tf` files may look the same while the shell is pointing at a different state instance.

That is the main safety rule for beginners: make the selected workspace visible before every plan, then check the rest of the target context. The workspace name selects a Terraform state instance. Cloud account, Git branch, deployment approval, backend, provider credentials, and variables still need their own checks around the selected workspace.

## Creating and Selecting Workspaces
<!-- section-summary: Workspace commands choose the state instance before Terraform plans or applies. -->

Workspace listing starts with one command:

![Workspace State Split](/content-assets/articles/article-iac-terraform-environments-workspaces/workspace-state-split.png)

*The split-state view shows how one configuration can point at separate workspace state records.*

```bash
terraform workspace list
```

This command prints the workspace names available in the current backend.

```console
  default
* dev
```

The star marks the active workspace. This small output matters because it tells the operator which state instance Terraform will read and write.

Workspace creation uses `terraform workspace new`:

```bash
terraform workspace new dev
```

Terraform creates a new state instance named `dev` and selects it. The command should appear in setup notes, while routine plans should usually use `terraform workspace select` so the target is deliberate.

```console
Created and switched to workspace "dev"!

You're now on a new, empty workspace. Workspaces isolate their state,
so if you run "terraform plan" Terraform will not see any existing state
for this configuration.
```

The phrase "new, empty workspace" deserves attention. If you created `prod` by mistake, Terraform may plan to create resources that already exist in the real production environment because this state instance has no history yet.

Later selection uses `terraform workspace select`:

```bash
terraform workspace select dev
```

This command switches the active workspace to the existing `dev` state instance.

```console
Switched to workspace "dev".
```

Selection changes the active workspace for the current working directory. Another workspace print before planning helps after a terminal has been open for a while or after the same repo has been used for several environments.

The active workspace display uses `terraform workspace show`:

```bash
terraform workspace show
```

```console
dev
```

After selecting `dev`, `terraform plan` reads and writes the `dev` workspace state. CI should print the workspace and variable file before planning:

```bash
echo "workspace=$(terraform workspace show)"
echo "var_file=env/dev.tfvars"
terraform plan -var-file=env/dev.tfvars
```

The workspace and variable file should agree. A `prod` variable file with the `dev` workspace is a warning sign because the values and state target point at different environments.

In current Terraform, automation can create or select the workspace in one command:

```bash
terraform workspace select -or-create dev
echo "workspace=$(terraform workspace show)"
terraform plan -var-file=env/dev.tfvars
```

`terraform workspace select -or-create dev` selects an existing `dev` workspace. If the workspace is missing, Terraform creates it and then selects it. The echoed workspace line should print `workspace=dev` before the plan runs.

```console
Created and switched to workspace "dev"!

You're now on a new, empty workspace. Workspaces isolate their state,
so if you run "terraform plan" Terraform will not see any existing state
for this configuration.

workspace=dev
```

If your runner does not support `-or-create`, the fallback pattern should be deliberate:

```bash
terraform workspace select dev || terraform workspace new dev
```

The `||` operator means "run the command on the right only if the command on the left fails." That fallback is common for preview and development stacks. For production, many teams prefer a job that fails if the workspace is missing, because creating a brand-new production state instance by accident can hide a targeting mistake.

For production, the stricter version is:

```bash
terraform workspace select prod
echo "workspace=$(terraform workspace show)"
terraform plan -var-file=env/prod.tfvars
```

This job stops if `prod` is missing. That failure is useful because a missing production workspace should trigger a human check before any empty-state plan runs.

## Using terraform.workspace in Configuration
<!-- section-summary: terraform.workspace can feed names and tags, but it should be used carefully because it hides environment choice in runtime context. -->

Terraform exposes the selected workspace through `terraform.workspace`. A simple configuration can use it for names and tags:

```hcl
locals {
  environment = terraform.workspace
  name_prefix = "dp-billing-${local.environment}"

  tags = {
    service     = "billing"
    environment = local.environment
    managed_by  = "terraform"
  }
}
```

Resources consume those locals:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "${local.name_prefix}-logs"
  tags   = local.tags
}

output "log_bucket_name" {
  description = "Bucket name for the selected workspace."
  value       = aws_s3_bucket.logs.bucket
}
```

This can be clean for preview environments where every workspace has the same shape. For production, many teams prefer `var.environment` from an environment file because it is visible in code review and CI configuration.

Workspace-driven logic should stay small. Names, tags, and short-lived preview identifiers are reasonable uses. Large conditional blocks based on `terraform.workspace` hide many review branches because the selected workspace controls them.

A safer pattern is to let the workspace provide a simple label while the variable file carries explicit sizing and operational choices:

```hcl
locals {
  environment = terraform.workspace
}

variable "instance_size" {
  type = string
}
```

```hcl
instance_size = "small"
```

The plan then shows both the workspace-derived environment name and the variable-driven size. Reviewers can see whether the runtime context and checked-in values agree.

## How Workspace Values Appear in Plans
<!-- section-summary: The plan shows evaluated workspace-derived names and tags, so reviewers should check that those values match the selected workspace. -->

If the active workspace is `dev`, the plan should show development names:

```console
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-dev-logs"
      + tags   = {
          + "environment" = "dev"
          + "managed_by"  = "terraform"
          + "service"     = "billing"
        }
    }

Changes to Outputs:
  + log_bucket_name = "dp-billing-dev-logs"
```

A production expectation with this dev plan means the context is wrong. The next review should check `terraform workspace show`, backend config, provider account, and variable file.

The plan shows only part of the runtime context by itself. Context printed before planning and a CI job name that includes the target environment make the review clearer. Fresh working directories in automation also reduce stale workspace surprises.

If a plan shows resources for the wrong workspace, the apply should pause while four values are checked in order: workspace, backend key, provider account, and variable file. Those four values explain most workspace targeting mistakes.

## Where Workspaces Fit
<!-- section-summary: Workspaces fit repeated low-risk environments, while long-lived production environments often need more explicit separation. -->

Workspaces fit repeated environments with the same shape. Training labs, short-lived demo stacks, and pull request previews are common examples. One folder can create many state instances without duplicating files.

![Workspace Risk Boundary](/content-assets/articles/article-iac-terraform-environments-workspaces/workspace-risk-boundary.png)

*The risk boundary shows why workspaces need visible target checks before plan and apply.*

Workspaces can also fit a small internal tool where dev and staging truly differ only by names and sizes. The team still needs guardrails: print the workspace, keep variable files aligned, and use CI concurrency so two applies target the same state one at a time.

The workspace name can feed resource names, but the logic should stay simple. If the configuration starts filling with `terraform.workspace == "prod" ? ... : ...`, the environments probably deserve clearer separation.

Preview environments are a good example. A pull request workspace named `pr-142` can create a temporary bucket, load balancer, or namespace with the same resource shape as other previews. The team can destroy that workspace state after the pull request closes.

The workflow might look like this:

```bash
terraform workspace select -or-create pr-142
echo "workspace=$(terraform workspace show)"
terraform plan -var-file=env/preview.tfvars -out=tfplan
terraform apply tfplan
```

The preview variable file keeps the resource sizes small. `-out=tfplan` saves the exact preview plan for review, and `terraform apply tfplan` applies that saved plan without asking for a second interactive approval. A successful preview apply should show the temporary resources created for the pull request, such as a bucket, load balancer, or namespace with `pr-142` in the name.

```console
workspace=pr-142

Plan: 3 to add, 0 to change, 0 to destroy.

Apply complete! Resources: 3 added, 0 changed, 0 destroyed.
```

After the pull request closes, the cleanup job selects `pr-142`, runs a destroy plan for that workspace, applies the reviewed destroy plan, and then deletes the workspace after the state is empty. The cleanup should print the selected workspace before destroy so the job cannot silently target `dev` or `prod`.

```bash
terraform workspace select pr-142
echo "workspace=$(terraform workspace show)"
terraform plan -destroy -var-file=env/preview.tfvars -out=destroy.tfplan
terraform apply destroy.tfplan
```

The destroy plan should name only preview resources. The summary should show destroy actions before the apply runs.

```console
Switched to workspace "pr-142".
workspace=pr-142

Plan: 0 to add, 0 to change, 3 to destroy.

Apply complete! Resources: 0 added, 0 changed, 3 destroyed.
```

Only after the destroy apply succeeds should the job delete the workspace state record. Terraform cannot delete the workspace you are currently using, so switch back to `default` first:

```bash
terraform workspace select default
terraform workspace delete pr-142
```

```console
Switched to workspace "default".
Deleted workspace "pr-142".
```

This order matters. Deleting a workspace state record before destroying the resources can leave real infrastructure running without Terraform tracking it. Terraform's `workspace delete -force` flag exists for rare cases where the team intentionally wants Terraform to stop managing those objects, but most cleanup jobs should destroy the resources first and delete the empty workspace after that.

## Where Directories Are Clearer
<!-- section-summary: Separate directories clarify environments with different backend keys, provider targets, approvals, secrets, or blast radius. -->

Production often has different needs: separate accounts, stricter approvals, different backend keys, different secrets, and a larger blast radius. In those cases, a directory layout gives reviewers a clearer surface:

```
live/
  dev/
    backend.hcl
    main.tf
    terraform.tfvars
  prod/
    backend.hcl
    main.tf
    terraform.tfvars
modules/
  billing-service/
```

The directory makes the target visible before Terraform runs. Reviewers can inspect `live/prod/backend.hcl`, production variables, provider configuration, and module versions in one place.

Each tool has a useful place. Workspaces are handy state instances for repeated shapes. Directories are stronger environment boundaries for long-lived production.

Directories also help access control. CI can have one protected production job that runs only from `live/prod`, uses production credentials, and requires approval. The development job can run from `live/dev` with lower privileges. A single shared folder with runtime workspace selection makes that separation less explicit.

The practical choice is usually easy to state:

| Situation | Clearer shape |
|---|---|
| Pull request previews with the same resources each time | Workspaces |
| Training labs or demos with repeated stacks | Workspaces |
| Dev and prod in separate cloud accounts | Directories |
| Different backend keys, approvals, secrets, or owners | Directories |
| Different modules or resource shapes per environment | Directories |

The best option makes the target easiest to prove in review. The team should be able to look at the folder, workspace, backend key, credentials, variables, and plan output and see one consistent environment.

## Putting It All Together
<!-- section-summary: Workspaces separate state instances, and safe teams make the selected workspace visible before every plan. -->

Workspaces let one configuration directory use multiple state records. They are practical for repeated infrastructure shapes with small environment differences.

![Workspaces Summary](/content-assets/articles/article-iac-terraform-environments-workspaces/workspaces-summary.png)

*The summary board compares workspace fit against directory isolation so the environment target stays reviewable.*

Safe teams make the selected workspace visible, keep variable files aligned, and pause after the plan shows names or tags from the wrong environment. For production, compare workspaces with directory isolation and choose the shape that makes targeting easiest to review.

Workspaces make the most sense after the directory-first pattern is clear. A workspace is one state-selection tool. It works well for repeated, low-risk shapes and needs extra review discipline for long-lived environments.

---

**References**

- [Terraform: Workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces) - Explains workspace state instances and the default workspace.
- [Terraform CLI: workspace commands](https://developer.hashicorp.com/terraform/cli/commands/workspace) - Documents `list`, `new`, `select`, `show`, and related workspace commands.
- [Terraform CLI: workspace select](https://developer.hashicorp.com/terraform/cli/commands/workspace/select) - Documents `terraform workspace select` and the `-or-create` flag.
- [Terraform CLI: workspace delete](https://developer.hashicorp.com/terraform/cli/commands/workspace/delete) - Explains workspace deletion, `-force`, and the risk of dangling unmanaged resources.
- [Terraform CLI: destroy](https://developer.hashicorp.com/terraform/cli/commands/destroy) - Documents destroy planning and applying for managed infrastructure cleanup.
- [Terraform: State](https://developer.hashicorp.com/terraform/language/state) - Explains why Terraform keeps state and how it maps configuration to real resources.
- [Terraform: Backend configuration](https://developer.hashicorp.com/terraform/language/backend) - Documents how backends store state and support team workflows.

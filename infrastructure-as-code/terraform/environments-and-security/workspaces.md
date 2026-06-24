---
title: "Workspaces"
description: "Use Terraform workspaces to maintain multiple independent state files from a single configuration directory."
overview: "Terraform workspaces let one configuration directory use multiple state instances. This article shows workspace commands, how workspace names get consumed in .tf files, how plans reveal the active environment, and when directories are clearer than workspaces."
tags: ["workspaces", "state", "environments", "isolation", "terraform"]
order: 1
id: article-iac-terraform-environments-workspaces
---

## Table of Contents

1. [What Workspaces Are](#what-workspaces-are)
2. [Creating and Selecting Workspaces](#creating-and-selecting-workspaces)
3. [Using terraform.workspace in Configuration](#using-terraformworkspace-in-configuration)
4. [How Workspace Values Appear in Plans](#how-workspace-values-appear-in-plans)
5. [Where Workspaces Fit and Where They Do Not](#where-workspaces-fit-and-where-they-do-not)
6. [Putting It All Together](#putting-it-all-together)

## What Workspaces Are
<!-- section-summary: A workspace is a named state instance for the same Terraform configuration directory. -->

A **Terraform workspace** is a named state instance. The same `.tf` files can have separate state for `dev`, `stage`, `prod`, or short-lived preview environments. The selected workspace decides which state record Terraform reads and writes.

This is useful when the infrastructure shape is the same and only the state instance changes. For example, a training project or preview environment can use one configuration directory and one workspace per branch.

Workspaces are not the only way to separate environments. Many production teams prefer separate directories because the backend config, variable files, provider accounts, and approval rules are more visible. Workspaces are a tool for state separation, not a full environment strategy by themselves.

## Creating and Selecting Workspaces
<!-- section-summary: Workspace commands choose the state instance before Terraform plans or applies. -->

The default workspace always exists:

```bash
terraform workspace list
```

Create a development workspace:

```bash
terraform workspace new dev
```

Select it later:

```bash
terraform workspace select dev
```

Now `terraform plan` reads and writes the `dev` workspace state. The selected workspace is runtime context, so CI should print it before planning:

```bash
terraform workspace show
terraform plan -var-file=env/dev.tfvars
```

The variable file and workspace should agree. A `prod` variable file with the `dev` workspace is a warning sign because the values and state target point at different environments.

## Using terraform.workspace in Configuration
<!-- section-summary: terraform.workspace can feed names and tags, but it should be used carefully because it hides environment choice in runtime context. -->

Terraform exposes the selected workspace as `terraform.workspace`. A small module can consume it in locals:

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

Resources then consume those locals:

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

The value path is direct. The selected workspace feeds `local.environment`, the local feeds the bucket name and tags, and the output publishes the final bucket name.

This can be fine for preview environments. For production, many teams prefer an explicit `var.environment` passed from `prod.tfvars` because it makes the environment visible in code review and CI logs.

## How Workspace Values Appear in Plans
<!-- section-summary: The plan shows evaluated workspace-derived names and tags, so reviewers should check that those values match the selected workspace. -->

If the active workspace is `dev`, the plan shows:

```hcl
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

If a production plan shows `dev` names, the active workspace or environment values are wrong. Stop before apply and check `terraform workspace show`, backend config, provider account, and variable file.

The plan cannot tell you every piece of runtime context by itself. CI should print enough context before the plan to make the target obvious:

```bash
echo "workspace=$(terraform workspace show)"
echo "var_file=env/dev.tfvars"
terraform plan -var-file=env/dev.tfvars
```

## Where Workspaces Fit and Where They Do Not
<!-- section-summary: Workspaces fit repeated low-risk environments, while long-lived production environments often need more explicit separation. -->

Workspaces fit small repeated stacks, training labs, and pull request preview environments where the same code shape repeats many times. They reduce folder duplication and make it easy to create another state instance.

Production environments often have more differences: separate accounts, stricter approvals, different backend keys, different secrets, and different blast radius. A directory layout like `live/dev` and `live/prod` usually makes those differences easier to review.

:::expand[The workspace mix-up to guard against]{kind="pitfall"}
The risky workspace mistake is running the right code with the wrong selected workspace. A developer may test in `dev`, switch branches, and forget that the shell still points at the `prod` workspace. A CI job may reuse a working directory and keep old workspace context.

Guardrails help. Print `terraform workspace show` before every plan. Use CI concurrency and job names that include the environment. Prefer fresh working directories in automation. For production, use separate directories or separate backend configuration so the target environment is visible outside the selected workspace.

The workspace feature is useful, but the selected workspace should never be a hidden surprise during a plan review.
:::

## Putting It All Together
<!-- section-summary: Workspaces separate state instances, and safe teams make the selected workspace visible before every plan. -->

Workspaces let one configuration directory use multiple state records. They are practical for repeated environments with the same shape. They need discipline because the selected workspace is runtime context.

Use `terraform.workspace` sparingly, check plan output for workspace-derived names and tags, and make CI print the active workspace before planning. For production, compare workspaces with directory isolation and choose the approach that makes environment targeting easiest to review.

For official reference, use Terraform's docs for [workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces), [`terraform workspace`](https://developer.hashicorp.com/terraform/cli/commands/workspace), [state](https://developer.hashicorp.com/terraform/language/state), and [backends](https://developer.hashicorp.com/terraform/language/backend).

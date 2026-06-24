---
title: "Terraform in CI/CD"
description: "Run Terraform plans and applies automatically in your CI/CD pipeline so infrastructure changes go through the same review and automation as code."
overview: "Terraform automation turns infrastructure changes into a repeatable workflow: format, initialize, validate, plan, review, apply, and record evidence. This article shows the .tf values a pipeline consumes, the plan artifact it reviews, and the controls teams add around production applies."
tags: ["ci/cd", "github actions", "automation", "pipeline", "terraform"]
order: 1
id: article-iac-terraform-automation-cicd
---

## Table of Contents

1. [Why Terraform Belongs in CI/CD](#why-terraform-belongs-in-cicd)
2. [The Pipeline Shape](#the-pipeline-shape)
3. [A GitHub Actions Example](#a-github-actions-example)
4. [Where Variables and Backend Values Are Consumed](#where-variables-and-backend-values-are-consumed)
5. [Plan Artifacts and Production Applies](#plan-artifacts-and-production-applies)
6. [Operational Guardrails](#operational-guardrails)
7. [Putting It All Together](#putting-it-all-together)

## Why Terraform Belongs in CI/CD
<!-- section-summary: CI/CD gives Terraform changes repeatable checks, reviewable plans, and controlled applies instead of one-off laptop runs. -->

Terraform changes should move through the same review path as application code. A pull request shows the `.tf` change. CI runs formatting and validation. A plan shows the infrastructure impact. A production apply happens only after review and approval.

This matters because Terraform can delete databases, change networks, rotate IAM permissions, and replace load balancers. A local apply from one laptop may work, but it leaves the team asking which variables were used, which state was targeted, which provider identity made the change, and what plan was approved.

A CI/CD pipeline makes those details visible and repeatable. The pipeline chooses the backend, variable file, cloud identity, Terraform version, and apply rules. The plan gives reviewers evidence for the change.

## The Pipeline Shape
<!-- section-summary: A healthy Terraform pipeline separates quick checks, speculative plans, approved applies, and post-apply records. -->

A practical Terraform pipeline has these stages:

1. `terraform fmt -check` verifies formatting.
2. `terraform init` configures providers and backend.
3. `terraform validate` checks configuration shape.
4. `terraform plan` creates a reviewable plan for the target environment.
5. Policy and security checks inspect configuration or plan JSON.
6. A protected apply job runs after approval for long-lived environments.
7. The pipeline stores logs, plan summaries, and apply results for audit.

Pull requests usually run speculative plans. They show what would happen if the change were applied, but they are not the final approval for production. The apply job should create or use a fresh approved plan after merge because state or cloud objects may have changed since the pull request plan.

## A GitHub Actions Example
<!-- section-summary: CI jobs should print target context, use short-lived cloud identity, and keep plan/apply steps explicit. -->

Here is a compact GitHub Actions workflow for a production root module:

```yaml
name: terraform-prod

on:
  pull_request:
    paths:
      - "terraform/live/prod/**"
      - "terraform/modules/**"
  push:
    branches: ["main"]
    paths:
      - "terraform/live/prod/**"
      - "terraform/modules/**"

permissions:
  contents: read
  id-token: write

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform/live/prod
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.15.0

      - name: Show target
        run: |
          echo "environment=prod"
          echo "state_key=infrastructure/billing/prod/terraform.tfstate"

      - name: Terraform fmt
        run: terraform fmt -check -recursive ../..

      - name: Terraform init
        run: terraform init -backend-config=backend.hcl

      - name: Terraform validate
        run: terraform validate

      - name: Terraform plan
        run: terraform plan -var-file=terraform.tfvars -out=tfplan
```

The workflow uses OIDC permission (`id-token: write`) so the runner can assume a cloud role without storing a long-lived access key in GitHub secrets. The exact cloud login step depends on the provider, but the principle is the same: short-lived pipeline identity is safer than static credentials.

## Where Variables and Backend Values Are Consumed
<!-- section-summary: The backend file chooses state, the tfvars file chooses input values, and the plan shows where those values landed in resources and outputs. -->

The production root module has two separate inputs to the workflow.

`backend.hcl` chooses the state record:

```hcl
bucket       = "dp-terraform-state-prod"
key          = "infrastructure/billing/prod/terraform.tfstate"
region       = "us-east-1"
use_lockfile = true
```

`terraform.tfvars` chooses the infrastructure values:

```hcl
environment    = "prod"
service_name   = "billing"
retention_days = 90
```

The module consumes those values:

```hcl
module "log_bucket" {
  source = "../../modules/log-bucket"

  environment    = var.environment
  service_name   = var.service_name
  retention_days = var.retention_days
}
```

The plan proves the values landed in the expected resources:

```hcl
  # module.log_bucket.aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "service"     = "billing"
        }
    }

Changes to Outputs:
  + log_bucket_name = "dp-billing-prod-logs"
```

This is the review loop. The workflow says production. The backend key says production. The variable file says production. The plan output says production names and tags.

## Plan Artifacts and Production Applies
<!-- section-summary: Saved plans connect review to apply, but they must be protected because plan files can contain sensitive data and backend configuration. -->

Terraform can save a plan with `-out=tfplan` and later apply exactly that plan:

```bash
terraform plan -var-file=terraform.tfvars -out=tfplan
terraform apply tfplan
```

This is useful in automation because the approved plan and applied plan match. Treat saved plan files as sensitive artifacts. They can contain resource values, backend details, and sometimes sensitive data. Store them only where the deployment system can protect them, and avoid broad artifact retention.

For production, many teams run apply only after merge to `main`, with environment protection, required reviewers, and CI concurrency set so one stack cannot apply twice at the same time.

:::expand[Why pull request plans still need a final apply check]{kind="pitfall"}
A pull request plan is a snapshot. It compares the branch code with the state and remote objects at that moment. By the time the pull request merges, another infrastructure change may have applied, a cloud operator may have changed something manually, or a provider may refresh different remote data.

That is why production apply jobs should re-run `terraform plan` or apply a saved plan created in the protected apply flow. The pull request plan is review evidence. The apply-stage plan is the final check against current state.
:::

## Operational Guardrails
<!-- section-summary: Production pipelines need state locking, concurrency controls, least-privilege identity, policy checks, and clear rollback habits. -->

Good Terraform automation includes more than commands. Use remote state with locking. Restrict the pipeline role to the accounts, regions, and APIs it needs. Print target context before planning. Run policy checks against the plan. Require approval for production applies. Keep apply logs and plan summaries.

Rollback in Terraform usually means a new code change and a new plan, not blindly undoing the last command. If a change replaced a bad security group rule, revert the code and plan the correction. If a resource replacement caused an outage, use provider-native recovery steps first when needed, then reconcile Terraform state and configuration.

## Putting It All Together
<!-- section-summary: Terraform CI/CD is strongest when it makes target context, plan impact, approvals, and apply evidence visible. -->

Terraform in CI/CD gives infrastructure changes a repeatable path. The pipeline chooses state, variables, identity, checks, plan, and apply approval. The plan shows the exact resource impact. The apply job records what changed.

For official reference, use Terraform's docs for [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan), [`terraform apply`](https://developer.hashicorp.com/terraform/cli/commands/apply), [`terraform fmt`](https://developer.hashicorp.com/terraform/cli/commands/fmt), [`terraform validate`](https://developer.hashicorp.com/terraform/cli/commands/validate), and [Terraform automation](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform).

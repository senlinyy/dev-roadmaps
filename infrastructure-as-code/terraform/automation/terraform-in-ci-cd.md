---
title: "Terraform in CI/CD"
description: "A protected CI/CD workflow gives Terraform checks, plans, and applies reviewed artifacts, approvals, locking, evidence, and rollback notes."
overview: "Terraform CI/CD turns the local checks from the testing article into a shared release path. This article follows a production stack through fast checks, a pull request plan, protected plan artifacts, an approved apply, state locking, audit evidence, and a practical rollback note."
tags: ["ci/cd", "github actions", "automation", "pipeline", "terraform"]
order: 2
id: article-iac-terraform-automation-cicd
---

## Table of Contents

1. [The Laptop Apply Risk](#the-laptop-apply-risk)
2. [Testing Layers in the Pipeline](#testing-layers-in-the-pipeline)
3. [Target Context Beside the Plan](#target-context-beside-the-plan)
4. [Careful Plan Artifacts](#careful-plan-artifacts)
5. [Protected Apply Workflow](#protected-apply-workflow)
6. [State Protection and One-Stack-at-a-Time Applies](#state-protection-and-one-stack-at-a-time-applies)
7. [Evidence and Rollback Notes](#evidence-and-rollback-notes)
8. [Putting It All Together](#putting-it-all-together)

The testing article built the safety layers on a developer machine and inside a reusable module. CI/CD takes those same checks and gives them a shared home. The goal is for Terraform changes to move through one visible path: checks, target context, plan, review, approval, apply, evidence, and rollback notes.

The examples use GitHub Actions because the YAML is familiar to many teams. The same design works in GitLab CI, Azure Pipelines, Buildkite, Jenkins, HCP Terraform, Terraform Enterprise, and other systems. The important part is the workflow boundary, not the product name.

## The Laptop Apply Risk
<!-- section-summary: A local apply can change production while losing the exact context reviewers and operators need later. -->

Imagine the billing team needs to change the log bucket retention from thirty days to ninety days. A developer has Terraform installed, cloud credentials on the laptop, and a working copy of the repository. The command sequence is familiar:

![Pipeline Identity Approval](/content-assets/articles/article-iac-terraform-automation-cicd/pipeline-identity-approval.png)

*The identity and approval path shows how CI replaces a laptop apply with a recorded, scoped, reviewable deployment path.*

```bash
terraform init
terraform plan -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
```

`terraform init` prepares the working directory, backend, modules, and provider plugins. `terraform plan -var-file=prod.tfvars` loads production values and prints the proposed actions. `terraform apply -var-file=prod.tfvars` runs a fresh plan and asks for confirmation before it calls provider APIs.

The commands can succeed and still leave the team with weak evidence. Which Terraform version ran? Which cloud identity applied the change? Which backend key held the state? Which commit was checked out? Did another apply run at the same time? Who reviewed the plan? Where is the approval record? What would restore the previous retention value if the change causes a problem?

CI/CD answers those questions by owning the risky context. The pipeline pins the Terraform version, working directory, backend config, variable file, cloud identity, checks, approval rule, plan output, apply log, and artifact retention. The developer still writes Terraform, but production changes move through a workflow the team can inspect after the fact.

This matters during normal operations too. During an incident review, the answer to "what changed production?" should come from a run record, not one person's shell history. Terraform automation creates that run record as part of the deployment path.

## Testing Layers in the Pipeline
<!-- section-summary: CI should run the same fast checks and module tests before it spends time planning a target environment. -->

The first CI job should carry forward the testing layers from the previous article. These commands catch common mistakes before the workflow reaches the target environment plan:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test
tflint --init
tflint --recursive
checkov -d .
```

The order is intentional. Formatting runs before provider initialization. Backend-free initialization and validation check Terraform language and module structure without touching remote state. `terraform test` checks module behavior with planned values. TFLint and security scanners add provider-aware and security rules.

CI runners usually start from a small toolset. The workflow should install Terraform-adjacent tools explicitly and pin their versions in one place. In the GitHub examples below, Terraform uses `vars.TERRAFORM_VERSION`, TFLint uses `vars.TFLINT_VERSION`, and Checkov uses `vars.CHECKOV_VERSION`. Those repository or environment variables should hold reviewed values such as `1.x.y`, `v0.x.y`, and `3.x.y`. The article uses variables instead of hard-coded tool versions so the example stays current while still teaching version pinning.

In GitHub Actions, a fast check job can run on pull requests. The job skeleton has four parts: path trigger, read-only permissions, tool setup, and the checks themselves. The completed job below fills those parts in that order:

```yaml
name: terraform-checks

on:
  pull_request:
    paths:
      - "terraform/live/**"
      - "terraform/modules/**"

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: ${{ vars.TERRAFORM_VERSION }}

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - uses: terraform-linters/setup-tflint@v6
        with:
          tflint_version: ${{ vars.TFLINT_VERSION }}

      - name: Install Checkov
        env:
          CHECKOV_VERSION: ${{ vars.CHECKOV_VERSION }}
        run: python -m pip install "checkov==${CHECKOV_VERSION}"

      - name: Format check
        run: terraform fmt -check -recursive

      - name: Validate modules without a backend
        run: |
          terraform -chdir=terraform/modules/log_bucket init -backend=false
          terraform -chdir=terraform/modules/log_bucket validate
          terraform -chdir=terraform/modules/log_bucket test

      - name: Initialize TFLint plugins
        run: tflint --init

      - name: Provider-aware lint
        run: tflint --recursive

      - name: Security scan
        run: checkov -d terraform
```

`terraform -chdir=terraform/modules/log_bucket` runs Terraform as if the shell had changed into that module directory. This keeps the job easy to read in repositories with several modules and live stacks. A larger repository may discover changed module directories dynamically, but the idea stays the same: module checks run before a production plan.

A useful failed job points to the layer that failed. A formatting failure should tell the author to run `terraform fmt -recursive`. A test failure should show the `run` block name and assertion message. A scanner failure should name the resource and rule. This keeps the pull request review focused on infrastructure behavior instead of log archaeology.

## Target Context Beside the Plan
<!-- section-summary: A pull request plan needs target context so reviewers know which stack, state, account, and values produced the result. -->

After fast checks pass, the pipeline can create a plan for a target stack. A **target stack** is one deployable Terraform root module, such as `terraform/live/prod/billing`. It has its own backend key, variable file, provider account, and apply workflow.

The plan job should show the target context before it renders resource changes. Reviewers need to match the pull request, working directory, state location, cloud account, region, and variable file. A correct resource change in the wrong target is still dangerous.

The plan workflow has five pieces: trigger, OIDC permissions, target context output, Terraform initialization, and the saved plan summary. The complete YAML keeps those pieces in one job so reviewers can see the context and plan together:

```yaml
name: terraform-plan-prod

on:
  pull_request:
    paths:
      - "terraform/live/prod/billing/**"
      - "terraform/modules/**"

permissions:
  contents: read
  id-token: write

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform/live/prod/billing

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: ${{ vars.TERRAFORM_VERSION }}

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/devpolaris-terraform-plan
          aws-region: us-east-1

      - name: Print target context
        run: |
          echo "environment=prod"
          echo "stack=billing"
          echo "working_directory=terraform/live/prod/billing"
          echo "state_key=billing/prod/terraform.tfstate"
          echo "var_file=terraform.tfvars"
          echo "region=us-east-1"
          echo "terraform_version=${{ vars.TERRAFORM_VERSION }}"

      - name: Terraform init
        run: terraform init -backend-config=backend.hcl

      - name: Terraform validate
        run: terraform validate

      - name: Terraform plan
        run: terraform plan -lock-timeout=5m -var-file=terraform.tfvars -out=tfplan

      - name: Render plan for review
        run: terraform show -no-color tfplan > tfplan.txt
```

The `permissions` block gives the workflow read access to repository contents and permission to request an OpenID Connect token. The AWS credentials step uses that token to assume a cloud role. This avoids storing long-lived cloud access keys in CI secrets.

The plan role should be narrower than the apply role where possible. It often needs enough read access to refresh state and calculate a plan, but it should not receive broad unrelated production permissions. The cloud trust policy should limit which repository, workflow, branch, or environment can assume the role.

The plan output should include a clear summary:

```console
Plan: 0 to add, 1 to change, 0 to destroy.

  # aws_s3_bucket_lifecycle_configuration.logs will be updated in-place
  ~ resource "aws_s3_bucket_lifecycle_configuration" "logs" {
      ~ rule {
          ~ expiration {
              ~ days = 30 -> 90
            }
        }
    }
```

That output gives reviewers the action count and the exact change. The target context tells them this is the billing production stack in `us-east-1` with the expected state key. Both pieces belong together in the pull request review.

## Careful Plan Artifacts
<!-- section-summary: A saved plan connects review, policy, and apply, but plan files can expose sensitive values. -->

Terraform can save a binary plan with `-out=tfplan`. The workflow can then render human-readable text and machine-readable JSON from that same saved plan:

```bash
terraform plan -var-file=terraform.tfvars -out=tfplan
terraform show -no-color tfplan > tfplan.txt
terraform show -json tfplan > tfplan.json
```

The binary `tfplan` is the exact set of actions Terraform can apply later with `terraform apply tfplan`. The text file is the review artifact. The JSON file feeds policy checks in the next article. All three come from the same saved plan, so reviewers, policy, and apply discuss the same evaluated change.

Plan artifacts need careful protection. Terraform documentation warns that saved plan files can include configuration, input variables, planned values, and sensitive data. A terminal plan may hide a sensitive value, while a saved plan or JSON representation can still carry it. Artifact access and retention should match the sensitivity of the infrastructure.

For pull requests, many teams upload only the readable text summary:

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: prod-billing-tfplan-review
          path: terraform/live/prod/billing/tfplan.txt
          retention-days: 14
```

The artifact name includes the environment and stack so reviewers can identify it later. Fourteen days may fit a normal pull request review window, but sensitive environments may need shorter retention.

For a protected apply workflow, a team may store the binary plan only inside the production environment:

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: prod-billing-tfplan-binary
          path: terraform/live/prod/billing/tfplan
          retention-days: 1
```

The apply job should download a binary plan only after the environment approval and only for the same commit that produced it. If the repository, variables, providers, backend, or state changed, the workflow should create a fresh plan. A stale plan can describe a world that no longer matches production.

Some teams choose a simpler and safer pattern: the pull request workflow publishes the readable plan, and the protected post-merge workflow creates a fresh saved plan immediately before approval and apply. That pattern reduces artifact handoff risk while still giving reviewers evidence during the pull request.

## Protected Apply Workflow
<!-- section-summary: Production apply should run from a protected environment with approval, short-lived credentials, and the reviewed plan. -->

The apply workflow should have stronger trigger controls than the pull request plan workflow. It usually runs from the default branch after merge, targets one stack, creates a fresh post-merge plan, and requires approval before the apply job receives production apply credentials.

![CI Plan Apply Gates](/content-assets/articles/article-iac-terraform-automation-cicd/ci-plan-apply-gates.png)

*The pipeline view separates plan, evidence, approval, and apply so the saved plan is the thing reviewers approve.*

In GitHub Actions, environment approval happens before a job starts. That means a good production workflow often has two jobs. The first job creates the fresh plan and uploads a short-lived artifact. The second job is attached to the protected environment, waits for approval, downloads the saved plan from the same workflow run, and applies it. The skeleton is plan first, protected apply second; the completed workflow keeps that boundary visible:

```yaml
name: terraform-apply-prod-billing

on:
  push:
    branches: ["main"]
    paths:
      - "terraform/live/prod/billing/**"
      - "terraform/modules/**"

permissions:
  contents: read
  id-token: write

concurrency:
  group: terraform-prod-billing
  cancel-in-progress: false

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform/live/prod/billing

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: ${{ vars.TERRAFORM_VERSION }}

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/devpolaris-terraform-plan
          aws-region: us-east-1

      - name: Terraform init
        run: terraform init -backend-config=backend.hcl

      - name: Create production plan
        run: terraform plan -lock-timeout=5m -var-file=terraform.tfvars -out=tfplan

      - name: Show action summary
        run: terraform show -no-color tfplan | sed -n '/Plan:/,$p'

      - uses: actions/upload-artifact@v4
        with:
          name: prod-billing-tfplan-binary
          path: terraform/live/prod/billing/tfplan
          retention-days: 1

  apply:
    runs-on: ubuntu-latest
    needs: plan
    environment: production
    defaults:
      run:
        working-directory: terraform/live/prod/billing

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: ${{ vars.TERRAFORM_VERSION }}

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/devpolaris-terraform-apply
          aws-region: us-east-1

      - uses: actions/download-artifact@v4
        with:
          name: prod-billing-tfplan-binary
          path: terraform/live/prod/billing

      - name: Terraform init
        run: terraform init -backend-config=backend.hcl

      - name: Apply approved saved plan
        run: terraform apply tfplan
```

The `plan` job creates a fresh plan after merge, so it sees the current default branch and current remote state. The `apply` job uses `needs: plan`, so it cannot start until the plan job finishes. `environment: production` connects the apply job to GitHub environment protection rules such as required reviewers. The approver should review the plan job's target context and action summary before approving the protected apply job.

`terraform apply tfplan` applies the saved plan file. Terraform does not ask for another interactive approval for a saved plan file because the approval happened in the workflow. This is why the workflow must create the plan in the right context, keep the artifact short-lived, and require approval before the apply job runs.

The apply role should have enough permission for this stack and as little unrelated access as practical. A role that can manage billing production storage does not also need broad permission to modify identity, networking, and databases across every account. Short-lived OIDC credentials reduce secret handling risk, but permissions still need careful scope.

Production applies should run from trusted branches and protected environments. A workflow from an untrusted fork should never receive production credentials. A manual `workflow_dispatch` apply can be useful for controlled operations, but it should require the same target context, approval, and evidence as a merge-triggered apply.

## State Protection and One-Stack-at-a-Time Applies
<!-- section-summary: Backend locking and CI concurrency protect different layers, so production workflows should use both. -->

Terraform state records the resources Terraform manages and the last known attributes for those resources. A remote backend stores that state in a shared location such as Terraform Cloud, HCP Terraform, S3 with native lock files, Azure Storage, Google Cloud Storage, or another supported backend. Some older S3 setups still use DynamoDB locking, so migration notes should call out which lock path a stack actually uses. The exact backend varies, but the operational rule stays the same: one writer should update a stack's state at a time.

State locking protects the state file. If one Terraform run holds the lock, another run should wait or fail rather than write conflicting state. The plan and apply commands can use a lock timeout:

```bash
terraform plan -lock-timeout=5m -var-file=terraform.tfvars -out=tfplan
terraform apply -lock-timeout=5m tfplan
```

`-lock-timeout=5m` tells Terraform to wait up to five minutes for an existing lock. That helps during normal deploy overlap, where one run is finishing and another begins. A repeated lock timeout should trigger investigation because it may mean a previous run crashed or an operator is applying outside the pipeline.

CI concurrency protects the workflow scheduler:

```yaml
concurrency:
  group: terraform-prod-billing
  cancel-in-progress: false
```

This setting tells GitHub Actions to run one `terraform-prod-billing` workflow at a time. `cancel-in-progress: false` lets the current apply finish rather than interrupting it halfway through. The concurrency group should include the environment and stack name so unrelated stacks can still deploy independently.

Both controls matter because they protect different layers. The backend lock protects Terraform state from simultaneous writers, even if someone runs Terraform outside CI. The CI concurrency group prevents the pipeline from queueing or overlapping two applies for the same stack. Together they reduce the chance of state conflicts, partial releases, and confusing evidence.

The workflow should also print lock-related failures clearly. A failed lock message should include the stack name, backend key, run URL, and next action. The next action may be "wait for the active run," "find the operator holding the lock," or "follow the backend's documented force-unlock procedure after confirming no run is active." Force-unlocking without checking for an active run can corrupt state, so it belongs in a controlled incident or operations process.

## Evidence and Rollback Notes
<!-- section-summary: A production Terraform run should leave target context, plan summary, approvals, apply output, policy result, and rollback guidance. -->

After apply, the team needs evidence. Evidence helps with audits, incident reviews, cost investigations, and ordinary debugging. A good Terraform run record answers who changed what, where, at what time, why, and how to respond if the change causes trouble.

For the billing retention change, the evidence should include:

| Evidence item | Example |
|---|---|
| Commit | `abc1234` on `main` |
| Actor | Pull request author and workflow actor |
| Approver | Production environment reviewer |
| Target | `terraform/live/prod/billing`, state key `billing/prod/terraform.tfstate` |
| Terraform version | The `vars.TERRAFORM_VERSION` value recorded by the workflow |
| Plan summary | `Plan: 0 to add, 1 to change, 0 to destroy.` |
| Changed resource | `aws_s3_bucket_lifecycle_configuration.logs` |
| Policy result | Passed required tags and protected delete rules |
| Apply result | Successful apply log and final output changes |

The rollback note should be part of the same habit. Terraform rollback usually means a new commit that restores the previous desired configuration, followed by the same plan, approval, and apply workflow. The note should name the previous value and the expected verification check.

For the retention change, a rollback note could look like this:

```markdown
Rollback note:
- Previous value: log expiration was 30 days.
- Restore path: open a pull request that changes `expiration.days` from `90` back to `30`.
- Verification: plan should show `90 -> 30` for `aws_s3_bucket_lifecycle_configuration.logs`.
- Owner: platform on-call approves and applies through the production workflow.
```

That note avoids improvisation during an incident. Some resources, such as databases, identity policies, or network changes, may need data checks, customer communication, or a forward fix instead of a direct rollback. The point is to record the recovery path while the change is fresh.

Evidence retention should separate metadata from sensitive artifacts. Run metadata, approvals, and plan summaries may need longer retention for audit. Binary plans and JSON plans may contain sensitive values and should usually have shorter retention and stricter access.

## Putting It All Together
<!-- section-summary: Terraform CI/CD turns local checks into a protected production path with review, approval, locking, evidence, and rollback context. -->

The workflow started with a risky laptop apply. The testing layers moved into CI so formatting, validation, module tests, linting, and scans fail before a production plan. The plan job printed target context beside the evaluated change. Plan artifacts received careful handling because they can contain sensitive values. The apply workflow used a protected environment, short-lived cloud identity, state locking, CI concurrency, and a saved plan. The run record kept evidence and a rollback note.

![CI/CD Summary](/content-assets/articles/article-iac-terraform-automation-cicd/cicd-summary.png)

*The summary board shows the full CI/CD loop from local checks through protected apply and deployment evidence.*

This is the production shape most teams are trying to reach. Developers still work locally and open pull requests. Reviewers see the code diff and the Terraform plan together. Approvers see the target and action summary before production apply. Operators can answer what changed after the run finishes.

The next article adds the governance gate. Policy as code reads the plan JSON from this workflow and blocks known risks, such as missing tags, public exposure, broad IAM, or protected deletes, before the apply step can call provider APIs.

---

**References**

- [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [`terraform apply`](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [`terraform show`](https://developer.hashicorp.com/terraform/cli/commands/show)
- [`terraform test`](https://developer.hashicorp.com/terraform/cli/commands/test)
- [Automate Terraform with GitHub Actions](https://developer.hashicorp.com/terraform/tutorials/automation/github-actions)
- [HashiCorp setup-terraform action](https://github.com/hashicorp/setup-terraform)
- [TFLint setup action](https://github.com/terraform-linters/setup-tflint)
- [Checkov installation](https://github.com/bridgecrewio/checkov#installation)
- [GitHub Actions OpenID Connect security hardening](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS configure-aws-credentials action](https://github.com/aws-actions/configure-aws-credentials)
- [GitHub Actions environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [GitHub Actions concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency)

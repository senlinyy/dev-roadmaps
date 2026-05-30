---
title: "Terraform in CI/CD"
description: "Run Terraform plans and applies automatically in your CI/CD pipeline so infrastructure changes go through the same review and automation as code."
overview: "Running Terraform manually means relying on individual engineers to follow the correct process every time. A CI/CD pipeline enforces the process automatically: every change is planned, reviewed, and applied consistently. This article covers how to wire Terraform into GitHub Actions, how to handle credentials safely, and the patterns that make automated Terraform reliable."
tags: ["ci/cd", "github actions", "automation", "pipeline", "terraform"]
order: 1
id: article-iac-terraform-automation-cicd
---

## Table of Contents

1. [Why Automate Terraform](#why-automate-terraform)
2. [The Basic Pipeline Shape](#the-basic-pipeline-shape)
3. [A GitHub Actions Workflow for Terraform](#a-github-actions-workflow-for-terraform)
4. [Handling Credentials in CI/CD](#handling-credentials-in-cicd)
5. [Plan as a Pull Request Check](#plan-as-a-pull-request-check)
6. [Applying Only After Merge](#applying-only-after-merge)
7. [Managing Multiple Environments in One Pipeline](#managing-multiple-environments-in-one-pipeline)
8. [State Locking and Pipeline Concurrency](#state-locking-and-pipeline-concurrency)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Automate Terraform

When engineers run Terraform manually from their laptops, several things can go wrong. Different engineers might have different Terraform versions installed. One person's laptop might have old provider versions that are not in the lock file. Someone might apply from a branch that has not been merged, deploying changes that were not reviewed. Someone might skip the plan step and apply directly, missing what Terraform is about to change.

A CI/CD pipeline removes these variables. Every plan and apply runs from the same clean environment — the same Terraform version, the same provider versions from the lock file, the same credentials configuration. Every change goes through a predictable sequence: open a pull request, the pipeline runs `terraform plan` and posts the output as a comment, a reviewer approves the plan, the pull request is merged, and the pipeline applies the change.

This process is the same as the software development workflow your team already uses for application code. Infrastructure changes deserve the same scrutiny, and the CI/CD pipeline enforces that scrutiny without requiring anyone to remember to follow the steps manually.

## The Basic Pipeline Shape

A production Terraform CI/CD pipeline has two phases tied to two Git events.

The first phase runs on every pull request and is read-only. It runs `terraform plan` and makes the output visible to reviewers. No changes are made to real infrastructure. The purpose is to let engineers and reviewers see exactly what will change before approving the pull request.

The second phase runs when a pull request is merged to the main branch and is write. It runs `terraform apply` — using the same plan output from the first phase if possible, or regenerating the plan if not — and makes the actual infrastructure changes.

This two-phase approach means: propose changes through code, review the plan, merge to apply. Every infrastructure change is associated with a specific pull request, a specific reviewer approval, and a specific merge commit. The history of what changed and why is in Git, just like application code changes.

## A GitHub Actions Workflow for Terraform

GitHub Actions is one of the most common CI/CD platforms. Here is a complete workflow that implements the two-phase pattern:

```yaml
name: Terraform

on:
  pull_request:
    branches: [main]
    paths:
      - 'infrastructure/**'
  push:
    branches: [main]
    paths:
      - 'infrastructure/**'

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  plan:
    name: Plan
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    defaults:
      run:
        working-directory: infrastructure/environments/prod

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "~1.6"

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/terraform-plan-role
          aws-region: us-east-1

      - name: Terraform Init
        run: terraform init

      - name: Terraform Plan
        id: plan
        run: terraform plan -out=plan.tfplan
        continue-on-error: true

      - name: Post Plan to PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const output = `#### Terraform Plan 📖
            \`\`\`
            ${{ steps.plan.outputs.stdout }}
            \`\`\`
            `;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: output
            });

      - name: Fail if Plan Failed
        if: steps.plan.outcome == 'failure'
        run: exit 1

  apply:
    name: Apply
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    defaults:
      run:
        working-directory: infrastructure/environments/prod

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "~1.6"

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/terraform-apply-role
          aws-region: us-east-1

      - name: Terraform Init
        run: terraform init

      - name: Terraform Apply
        run: terraform apply -auto-approve
```

A few important design decisions in this workflow deserve explanation.

The `paths` filter on the trigger events means the workflow only runs when files inside `infrastructure/**` change. Pull requests that only touch application code do not trigger a Terraform plan or apply.

The `plan` job runs only on pull requests. The `apply` job runs only on pushes to `main`. These are two separate jobs with two separate IAM roles — the plan role has read-only permissions, and the apply role has write permissions. This is principle of least privilege: the plan step cannot accidentally create or destroy resources even if it is compromised.

The `setup-terraform` action installs a specific Terraform version range (`~1.6`), ensuring the CI environment uses a consistent version regardless of what any individual engineer has installed locally.

## Handling Credentials in CI/CD

Giving a CI/CD pipeline access to AWS requires credentials. There are two approaches: long-lived access keys stored as secrets, and short-lived tokens generated through OIDC federation.

**Long-lived access keys** are the simpler option. You create an IAM user, generate access keys, and store `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as GitHub Actions secrets. The pipeline injects these as environment variables. The problem is that these keys do not expire. If they are leaked — through a log file, a compromised machine, or a security breach — they remain valid until you manually rotate them.

**OIDC federation** is the more secure modern approach. GitHub Actions can act as an identity provider, and AWS can be configured to trust it. Instead of long-lived keys, the pipeline requests a short-lived token that is valid only for the duration of the job. The token is automatically rotated for every job run.

The `configure-aws-credentials` action in the workflow above uses OIDC: `role-to-assume` specifies the IAM role ARN to assume, and GitHub's OIDC provider issues a token that AWS accepts. The token is valid for one hour and automatically expires when the job finishes. No secrets need to be stored. No rotation is required.

Setting up OIDC requires a one-time configuration in AWS: creating an IAM OIDC provider for GitHub Actions and creating IAM roles with appropriate trust policies that restrict which GitHub repositories and branches can assume them.

Azure supports the same secretless pattern with GitHub Actions and Microsoft Entra ID. Instead of storing a client secret, you create a federated credential for the GitHub workflow and allow the job to request an Azure token through OIDC:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: actions/checkout@v4

  - name: Azure Login
    uses: azure/login@v2
    with:
      client-id: ${{ vars.AZURE_CLIENT_ID }}
      tenant-id: ${{ vars.AZURE_TENANT_ID }}
      subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

The AzureRM provider can then use that authenticated Azure context during `terraform plan` and `terraform apply`, depending on how your provider authentication is configured.

## Plan as a Pull Request Check

Posting the plan output as a pull request comment is useful, but a plan that succeeds (exits with code 0) is not the same as a plan that proposes no destructive changes. A plan that proposes to destroy a production database and recreate it still exits with code 0 — Terraform considers that a valid plan.

Reviewers need to actually read the plan. A few practices help with this:

Configure branch protection rules in GitHub to require the plan job to pass before a pull request can be merged. This ensures every pull request has a plan — reviewers cannot accidentally merge without one.

Use a tool like `tfcmt` or `atlantis` that posts structured plan summaries with change counts clearly highlighted. These tools format the plan output to emphasize the number of resources being added, changed, and destroyed, making it easy to spot unexpected changes at a glance.

Add a checklist to your pull request template that includes an item for reviewing the Terraform plan output. Social enforcement is not as reliable as technical enforcement, but it helps remind reviewers to look at the plan before approving.

## Applying Only After Merge

The apply step runs after merge, not after approval. This is an important distinction. The pull request approval is a code review signal — the code change looks right to a second set of eyes. The apply itself happens when the code reaches the main branch.

This has an important implication: the plan from the pull request checks and the actual apply after merge might be slightly different. If the AWS infrastructure changed between when the plan was computed and when the apply runs (because another apply happened in between, or because some external change occurred), the apply will see a different starting state.

For most changes, this difference is harmless. For sensitive operations, such as large-scale replacements, deletions, or changes to shared infrastructure that multiple teams depend on, some teams save a plan file and apply that exact file within the same protected workflow run after manual approval.

Be careful with pull-request-to-push workflows: the plan artifact produced for an unmerged pull request is usually not the artifact you should apply after the merge commit. It may have been created from a different commit, with different credentials, or before another infrastructure change landed. A safer default is to regenerate the plan on `main`, require an environment approval if needed, and then apply that saved plan within the same job or workflow run.

Saving and reusing a plan file:

```yaml
- name: Terraform Plan
  run: terraform plan -out=plan.tfplan

- name: Upload Plan
  uses: actions/upload-artifact@v4
  with:
    name: terraform-plan
    path: infrastructure/environments/prod/plan.tfplan
```

Then in the apply job:

```yaml
- name: Download Plan
  uses: actions/download-artifact@v4
  with:
    name: terraform-plan
    path: infrastructure/environments/prod/

- name: Terraform Apply
  run: terraform apply plan.tfplan
```

The plan file contains the exact operations Terraform intends to perform from the state snapshot and inputs used during planning. Applying it attempts those exact operations without making a fresh plan, but it can still fail if reality changed in a way that makes the saved plan invalid, if credentials expired, or if provider APIs reject a change. Plan files can also contain sensitive values, so store them only in protected artifacts with short retention.

## Managing Multiple Environments in One Pipeline

For a repository with multiple environment directories (dev, staging, prod), you need the pipeline to apply changes to the correct environment. There are several patterns for this.

**Separate workflows per environment** — one YAML file for dev, one for staging, one for prod — with each workflow targeting a different directory. Simple but repetitive.

**A matrix strategy** runs the same job steps across multiple environments in parallel:

```yaml
strategy:
  matrix:
    environment: [dev, staging, prod]
  fail-fast: false
```

Each matrix job runs with a different `environment` value, and you use `matrix.environment` to set the working directory and the IAM role to assume.

**Environment-specific protection rules in GitHub** let you require manual approval before a job applies to production. You configure a GitHub environment called `prod` with required reviewers. When the apply job targets `prod`, GitHub pauses and waits for a reviewer to approve before proceeding. This gives you a manual gate specifically for production without blocking automated dev and staging deployments.

## State Locking and Pipeline Concurrency

If two pull requests are merged in quick succession and both trigger apply jobs, both jobs run `terraform apply` at nearly the same time. The first job acquires the backend state lock. The second job tries to acquire the same lock and waits or fails with a lock error, depending on the timeout setting and backend behavior.

By default, Terraform does not wait long for a lock unless you configure a lock timeout. You can set one explicitly:

```bash
terraform apply -lock-timeout=300s -auto-approve
```

This tells Terraform to wait up to 5 minutes for the lock rather than failing immediately. For most pipelines, a 5-minute wait is acceptable.

The better solution is to configure your CI/CD system to queue apply jobs sequentially rather than running them in parallel. In GitHub Actions, the `concurrency` key does this:

```yaml
concurrency:
  group: terraform-prod
  cancel-in-progress: false
```

The `group` name identifies which jobs are in the same concurrency group. With `cancel-in-progress: false`, if an apply is running and a new one is triggered, the new one waits until the current one finishes rather than being cancelled. This ensures every merge eventually gets applied, in order, without lock conflicts.

## Putting It All Together

A well-designed Terraform CI/CD pipeline treats infrastructure changes with the same rigour as application code. Engineers propose changes through pull requests. The pipeline runs `terraform plan` automatically and posts the output for reviewers to read. Reviewers evaluate the plan — not just the code, but the actual proposed infrastructure operations — before approving. After merge, the pipeline applies the changes automatically from a consistent, clean environment using credentials that expire after each use.

Separate IAM roles for plan and apply enforce least privilege — the read-only plan step cannot accidentally create or destroy resources. State locking with appropriate timeout settings or sequential job queuing prevents concurrent applies from corrupting state. Environment-specific approval gates in the CI/CD platform provide a manual safeguard for production changes.

The pipeline itself is code, stored in version control, subject to the same review process as everything else. Changes to the pipeline go through a pull request. The infrastructure and the automation that manages it are both reviewed, versioned, and reproducible.

## What's Next

Automated pipelines enforce process. Policy as code enforces rules. The next article covers Open Policy Agent (OPA) and HashiCorp Sentinel — tools that evaluate your Terraform plans against organization-wide policies before allowing an apply to proceed, blocking configurations that violate security or compliance requirements.

---

**References**

- [GitHub Actions: setup-terraform (HashiCorp)](https://github.com/hashicorp/setup-terraform) — The official GitHub Action for installing Terraform in CI/CD workflows.
- [Configuring OpenID Connect in AWS (GitHub Documentation)](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) — Step-by-step guide for setting up OIDC-based AWS authentication from GitHub Actions.
- [GitHub Actions: Concurrency](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#concurrency) — Reference for the `concurrency` key to serialize workflow jobs.
- [Connect from GitHub Actions to Azure with OpenID Connect (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) — Microsoft guidance for secretless GitHub Actions authentication to Azure.
- [Store Terraform State in Azure Storage (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/store-state-in-azure-storage) — Microsoft guidance for Azure Storage-backed Terraform state in automation.

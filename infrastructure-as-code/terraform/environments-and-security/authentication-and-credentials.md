---
title: "Authentication and Credentials"
description: "Safe Terraform credentials for local plans, CI/CD jobs, and production applies after the provider and state foundations are in place."
overview: "Terraform providers need an authenticated identity before they can read or change cloud resources. This article assumes you already know providers, resources, plans, and state, then explains local CLI authentication, provider credential discovery, short-lived CI/CD identity, and the evidence real teams keep after production runs."
tags: ["terraform", "authentication", "credentials", "security"]
order: 1
id: article-iac-terraform-foundations-authentication
aliases:
  - infrastructure-as-code/terraform/foundations/authentication-and-credentials.md
---

## Table of Contents

1. [Why Terraform Needs an Identity](#why-terraform-needs-an-identity)
2. [Secrets Stay Out of Terraform Files](#secrets-stay-out-of-terraform-files)
3. [Local Developer Authentication](#local-developer-authentication)
4. [Environment Variables and Provider Discovery](#environment-variables-and-provider-discovery)
5. [CI/CD Authentication with OIDC](#cicd-authentication-with-oidc)
6. [Provider Blocks with No Hardcoded Secrets](#provider-blocks-with-no-hardcoded-secrets)
7. [Deployment Evidence](#deployment-evidence)
8. [Putting It All Together](#putting-it-all-together)

At this point in the Terraform roadmap, the basics are already on the table. A provider talks to a platform API, resources describe the objects Terraform manages, plans preview the intended changes, and state records what Terraform already knows about the real world. Authentication enters after those ideas because credentials only make sense once Terraform has something real to read or change.

The running example is the `devpolaris-orders-api` service. The team has separate development and production cloud accounts, a remote state backend, and CI/CD jobs that run `terraform plan` on pull requests and `terraform apply` after approval. The important question in this article is simple: which identity should Terraform use for each run, and how can the team prove that identity was the right one?

## Why Terraform Needs an Identity
<!-- section-summary: Terraform configuration can describe infrastructure, but providers need an authenticated identity before they can call cloud APIs. -->

Terraform starts on your machine or in a CI/CD runner, but the real work happens through provider APIs. If Terraform needs to read an existing VPC, create a bucket, update an IAM role, or configure a GitHub repository environment, the provider has to prove who is making the request before the platform lets the request continue.

That proof is **authentication**. A **credential** is the proof the provider uses, such as a temporary role session, a CLI login token, or a workload identity token. After the provider knows the caller, the platform checks **authorization**, which means checking what the caller can do. For `devpolaris-orders-api`, a development plan might use a developer session with access to the dev account, while a production apply uses a deployment role that only the approved release job can enter.

The Terraform file usually has two separate shapes: a provider block for the platform target, and resource blocks for the objects Terraform manages.

```hcl
provider "<provider_name>" {
  target_setting = target_value
}

resource "<provider_resource_type>" "<local_name>" {
  argument_name = argument_value
}
```

The provider block should name non-secret target settings, such as a region. The resource block describes the infrastructure. A small AWS example fills in that shape like this:

```hcl
provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-dev-exports"
}
```

The code names the region and the bucket. Access keys and passwords stay out of the file. The [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) lists supported credential methods, and the provider will look for credentials in the run environment.

That split is the safe direction. Terraform code should describe the target infrastructure. The current run environment should supply the identity.

The provider performs the authenticated work during plan and apply. During plan, it may read existing buckets, IAM roles, VPCs, or repository settings to compare remote reality with Terraform state. During apply, it sends create, update, delete, or read requests according to the reviewed plan. Authentication is therefore needed before apply; a plan can fail early if the provider cannot read the platform.

This is why the identity for a Terraform run should be visible in the run record. A production apply performed by a role named `devpolaris-orders-api-terraform-deploy` gives the team a cleaner audit trail than a production apply performed from a personal admin key. The role name, permissions, approval record, and cloud audit log all tell the same story about the run.

## Secrets Stay Out of Terraform Files
<!-- section-summary: Safe Terraform projects avoid permanent secrets in .tf files, tfvars files, state, logs, and pull requests. -->

A **credential** is proof that a caller can act as an identity. It might be a browser-backed session, a temporary role session, a service principal token, or a cloud access key. The safest Terraform setups prefer short-lived credentials with limited permissions.

The risky pattern is a long-lived secret copied into files. In AWS, that might be `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for an IAM user. In Azure, it might be a service principal client secret. In Google Cloud, it might be a downloaded service account JSON key.

The danger is practical. A secret in a `.tf` file can land in Git history. A secret in `prod.tfvars` can appear in a pull request. A secret printed in logs can be copied into a ticket. A secret stored in state can be read by anyone with state access.

The `sensitive = true` flag belongs on sensitive variables and outputs that must pass through Terraform, while the limit stays clear. Sensitive marking reduces display in CLI output, and values can still land in state if Terraform needs to store them. Terraform's [sensitive data guidance](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) is worth reading before production secret handling, and the safer credential pattern avoids passing secret material through Terraform configuration in the first place.

Secrets can leak through several paths that beginners do not expect. A `*.tfvars` file may be attached to a pull request. A plan file may be uploaded as a CI artifact. A failed provider error may echo part of a request. State may store values so Terraform can compare future changes. All of those places are part of the credential design, alongside the `.tf` file.

For application secrets, a common production pattern is to let Terraform create or reference a secret container while a dedicated secret workflow writes the secret value. For example, Terraform may create an AWS Secrets Manager secret name and IAM permission, while the actual database password is rotated by a secrets process. That keeps infrastructure ownership in Terraform and keeps secret material out of normal plan review.

![Credential Boundary](/content-assets/articles/article-iac-terraform-foundations-authentication/credential-boundary.png)

*The credential boundary shows the safe split: Terraform files describe targets, while credential sources provide short-lived proof outside the code.*

## Local Developer Authentication
<!-- section-summary: Local plans usually use cloud CLI sessions or profiles so permanent keys stay out of Terraform code. -->

For local work, many teams authenticate through the cloud provider's normal CLI. An AWS developer might use AWS IAM Identity Center and run `aws sso login`. An Azure developer might run `az login`. A Google Cloud developer might run `gcloud auth application-default login` for supported application default credential flows.

The exact command depends on the provider and the team's identity system. The common shape is that the developer signs in through a browser, completes MFA, and receives a temporary session. Terraform providers can then discover those credentials through the local CLI profile, shared configuration files, or environment variables.

For AWS, a local plan might look like this:

```bash
aws sso login --profile devpolaris-dev
export AWS_PROFILE=devpolaris-dev
aws sts get-caller-identity
terraform plan
```

`aws sso login` opens the browser-based sign-in flow for the named profile. `AWS_PROFILE` tells the AWS provider which local profile to use. `aws sts get-caller-identity` prints the account and role session before Terraform runs, so the developer can catch a wrong account early.

```console
{
    "UserId": "AROAXAMPLE:senlin@example.com",
    "Account": "111111111111",
    "Arn": "arn:aws:sts::111111111111:assumed-role/AWSReservedSSO_DeveloperAccess/senlin@example.com"
}
```

This output should match the intended development account. If the account ID or role name points at production, the login context needs correction before `terraform plan` reads anything.

For a beginner, the important part is the boundary. The profile name or region can be visible in the shell environment or provider block. The secret session material stays in the provider-supported credential store, not in the Terraform files.

The same idea works across the major clouds:

```bash
az login
az account set --subscription "DevPolaris Development"
az account show --query "{name:name, id:id, tenantId:tenantId}" --output json
terraform plan
```

The Azure commands first sign the human into Azure, then choose the subscription Terraform should target. The subscription selection matters because the same human may have access to development, staging, and production subscriptions.

```console
{
  "name": "DevPolaris Development",
  "id": "00000000-0000-0000-0000-000000000111",
  "tenantId": "00000000-0000-0000-0000-000000000999"
}
```

```bash
gcloud auth application-default login
gcloud config set project devpolaris-dev
gcloud config get-value project
terraform plan
```

The Google Cloud commands create application-default credentials for local tools and select the project for future calls. In all three clouds, the article's rule is the same: sign in through the provider-supported flow, then prove the account, subscription, or project before Terraform plans.

```console
devpolaris-dev
```

The exact provider documentation should decide the final setup. AzureRM can use Azure CLI authentication for local development. The Google provider commonly uses Application Default Credentials for local plans. The practical habit is the same: confirm the current account, subscription, project, or profile before running a plan.

Local pre-flight checks are quick:

```bash
aws sts get-caller-identity
az account show --query "{name:name, id:id, tenantId:tenantId}"
gcloud auth list
gcloud config get-value project
```

For AWS, the `Account` and `Arn` fields matter before planning. For Azure, the `name`, `id`, and `tenantId` should match the intended subscription and tenant. For Google Cloud, `gcloud auth list` marks the active account with an asterisk, and `gcloud config get-value project` should print the intended project ID. The relevant provider command should match the provider in the Terraform run. If any value is wrong, authentication should be corrected before Terraform reads or changes anything.

## Environment Variables and Provider Discovery
<!-- section-summary: Providers commonly discover credentials from environment variables, profiles, CLI sessions, or managed runtime identity. -->

Provider credential discovery means the provider checks supported places for credentials. The AWS provider can use environment variables, shared config and credentials files, web identity settings, container credentials, instance metadata, and other documented sources. Other providers have their own discovery chains.

Environment variables are common in CI/CD and local shells:

```bash
export AWS_PROFILE=devpolaris-dev
export AWS_REGION=us-east-1
env | grep -E '^(AWS_PROFILE|AWS_REGION)='
terraform plan
```

`AWS_PROFILE` chooses the named local profile, and `AWS_REGION` gives the provider a default Region. Those are configuration hints, not secret values. The secret session material stays in the shared credential store, SSO cache, or CI identity path.

```console
AWS_PROFILE=devpolaris-dev
AWS_REGION=us-east-1
```

The small `env` check proves which hints Terraform will see. A surprising `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `ARM_SUBSCRIPTION_ID`, or `GOOGLE_PROJECT` explains many plans that point at the wrong place.

Some CI systems set temporary credential variables for a single job:

```bash
export AWS_ACCESS_KEY_ID="$TEMP_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$TEMP_AWS_SECRET_ACCESS_KEY"
export AWS_SESSION_TOKEN="$TEMP_AWS_SESSION_TOKEN"
terraform apply tfplan
```

Those variables should come from a temporary role session or secure CI identity flow. Permanent access keys should stay out of repository secrets if the platform supports federation. If a permanent secret is unavoidable for a legacy integration, it needs tight scope, scheduled rotation, and a documented owner.

Terraform also has its own CLI environment variables, such as `TF_VAR_name` for input variables and variables that control automation behavior. These are separate from provider credentials. Terraform CLI variables shape Terraform behavior or input values; provider credentials authorize API calls.

Credential discovery can create confusing bugs because old environment variables may override the profile or CLI login you expected. If `env | grep AWS` shows an old `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, or `AWS_REGION`, Terraform may use that value instead of the login you had in mind. No matching environment variables often means the next place to inspect is the shared profile or provider configuration. For Azure, check `ARM_SUBSCRIPTION_ID` and the active `az account`. For Google Cloud, check provider arguments, `GOOGLE_PROJECT`, and `gcloud config`.

The official provider docs are the source of truth for the exact order. The [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs), [AzureRM provider documentation](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs), and [Google provider documentation](https://registry.terraform.io/providers/hashicorp/google/latest/docs) each document supported authentication paths. The provider page for the platform you are actually using matters because the environment variable names and fallback behavior differ.

## CI/CD Authentication with OIDC
<!-- section-summary: OIDC lets a CI job exchange its signed job identity for short-lived cloud credentials without storing a permanent cloud key. -->

CI/CD needs a cloud identity too. A safer modern pattern is **OIDC federation**. OIDC lets a CI job present a signed identity token to the cloud provider. The cloud provider checks claims such as repository, branch, environment, or workflow, then issues short-lived credentials for an allowed role.

![OIDC Identity Flow](/content-assets/articles/article-iac-terraform-foundations-authentication/oidc-identity-flow.png)

*The OIDC flow shows the CI job exchanging its signed job identity for temporary credentials instead of storing a permanent cloud key.*

For GitHub Actions and AWS, the shape is usually this:

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/devpolaris-orders-api-terraform-plan
          aws-region: us-east-1
      - run: terraform init
      - run: aws sts get-caller-identity
      - run: terraform plan
```

The repository has no AWS access key to protect. The cloud trust policy decides which GitHub workflow can assume the role. The role permissions decide which resources the job can read or change.

The example uses the current major version of the official AWS credentials action. In a production workflow, some teams pin a reviewed major version, a specific release tag, or a full commit SHA depending on their supply-chain policy. The important Terraform security point stays the same: the workflow requests an OIDC token through `id-token: write`, exchanges that token for short-lived cloud credentials, and avoids storing a permanent AWS access key in GitHub secrets.

The identity check in the middle is there for humans. In a successful run, the log should show the deployment role rather than a personal user or a long-lived access key.

```console
{
    "UserId": "AROAXAMPLE:GitHubActions",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/devpolaris-orders-api-terraform-plan/GitHubActions"
}
```

Production apply usually gets a different role from pull request planning. The plan role might be read-heavy and limited to development or preview environments. The apply role might require protected environments, manual approval, and stronger restrictions on branches and tags.

The cloud side also needs a trust rule. An **OIDC issuer** is the system that signs the job identity token, such as GitHub Actions. An **audience** is the service the token is meant for. A **subject** is the exact workload identity, such as one repository branch, tag, pull request, or protected environment. The cloud provider checks those fields before it issues temporary credentials.

In AWS, a role trust policy can require claims such as repository, branch, and audience before `AssumeRoleWithWebIdentity` succeeds. For a production role, the trust policy might allow only the `main` branch or a protected GitHub environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:devpolaris/platform:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

That policy says the role trusts only a GitHub Actions token meant for AWS STS from the approved repository branch. The Terraform job still needs IAM permissions on the role itself, but the trust policy controls who can enter the role.

In Azure, workload identity federation connects a GitHub Actions subject to an application or managed identity. Terraform then authenticates the AzureRM provider with values such as tenant ID, subscription ID, client ID, and OIDC token flow instead of a client secret. The federated credential should match the exact repository, branch, tag, pull request, or environment that is allowed to deploy.

In Google Cloud, Workload Identity Federation maps an external identity provider to a service account flow. The GitHub job exchanges its OIDC token through Google's Security Token Service, then impersonates the approved service account after the workload identity pool and provider rules match.

The names differ, and the security shape is the same: the CI job receives short-lived credentials only after the signed job identity matches the approved rule.

For production, separate plan and apply permissions are worth the extra setup. A pull request plan can run with read access and limited write access to a temporary environment. The protected apply job can use a stronger deployment role after approval. That separation reduces the damage from an untrusted branch or a compromised low-privilege workflow.

## Provider Blocks with No Hardcoded Secrets
<!-- section-summary: Provider blocks should usually identify targets such as region or owner while credentials come from the run environment. -->

A provider block should be boring. It should usually say where the provider should operate, not embed the secret that lets it operate. That keeps the same Terraform code usable from a developer laptop, a CI plan job, and a production apply job.

```hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

provider "aws" {
  region = var.aws_region
}
```

The value file supplies the target region:

```hcl
aws_region = "us-east-1"
```

The run environment supplies the identity:

```bash
export AWS_PROFILE=devpolaris-prod
terraform plan -var-file=prod.tfvars
```

That separation helps review. A pull request can show that production uses `us-east-1` without exposing production credentials. The CI runner can assume the production role only after the protected deployment gate allows it.

Provider blocks can still include security-sensitive target choices. An AWS `region`, Azure `subscription_id`, Google `project`, or GitHub `owner` decides where Terraform will operate. Those settings deserve review because a correct identity pointed at the wrong target can still produce a bad plan.

For several environments, target values should stay boring and explicit:

```hcl
variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      service     = "orders-api"
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}
```

This keeps credentials out of code. It gives every created resource a visible environment tag and makes the target region part of normal Terraform review.

## Deployment Evidence
<!-- section-summary: Real Terraform runs should leave evidence: who ran it, what plan was applied, which identity was used, and how the result was verified. -->

Credential safety continues after apply. Real teams keep deployment evidence so they can answer what changed, who approved it, which identity applied it, and how the result was checked. This is especially important for production infrastructure.

A useful deployment record includes the commit SHA, pull request link, Terraform workspace or backend key, provider versions from `.terraform.lock.hcl`, plan summary, approval record, CI job URL, cloud role or identity used for apply, and a short verification note. For `devpolaris-orders-api`, verification might include the bucket exists, the database endpoint is reachable from the app network, and the IAM role has only the expected policies.

A short record can live in the CI job summary:

```yaml
environment: prod
commit: 8c4f1ab
plan: "2 to add, 0 to change, 0 to destroy"
backend_key: "orders-api/prod/terraform.tfstate"
terraform_workspace: "default"
apply_identity: "arn:aws:sts::123456789012:assumed-role/devpolaris-orders-api-terraform-deploy/GitHubActions"
approval: "release-environment approved by diana@example.com"
verification: "exports bucket created, default tags present, deployment role policy scoped to prod resources"
```

The exact format matters less than the facts. A future incident review should be able to connect the code, the plan, the approval, the identity, and the verification without guessing.

Cloud audit logs provide another layer. AWS CloudTrail, Azure Activity Logs, Google Cloud Audit Logs, and SaaS audit logs can show the API calls made by the Terraform identity. Terraform evidence and provider audit logs together make incident review more direct.

This is where credentials, Terraform state, and Git history connect. The code says what should exist, the plan says what Terraform intended to change, the apply record says what ran, and the provider audit log shows the platform-side API activity.

## Putting It All Together
<!-- section-summary: Terraform authentication is safest with code that names the target and a run environment that supplies short-lived, scoped credentials. -->

Terraform providers need credentials because they call real APIs. The safe pattern is to keep long-lived secrets out of Terraform files, use short-lived scoped identities, and let providers discover credentials through supported local or CI/CD flows.

![Credential Summary](/content-assets/articles/article-iac-terraform-foundations-authentication/credential-summary.png)

*The summary board keeps the authentication review practical: avoid hardcoded secrets, use temporary identity, print the target, protect state, and record evidence.*

For local development, cloud CLI sessions or profiles are usually the safest starting point. For CI/CD, OIDC federation is safer than permanent cloud keys. For provider blocks, target settings such as region or owner belong in code, and credential material belongs in the run environment.

The beginner rule is practical: any secret that would be dangerous in Git, a pull request, a plan log, or state belongs outside Terraform code. Terraform receives an identity for the run, that identity receives only the permissions it needs, and every production apply leaves evidence.

---

**References**

- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - Explains sensitive values, state exposure, and safer handling patterns.
- [Terraform: Environment variables](https://developer.hashicorp.com/terraform/cli/config/environment-variables) - Documents Terraform CLI environment variables such as `TF_VAR_name` and automation controls.
- [AWS provider authentication](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Lists supported authentication sources for the AWS provider.
- [AzureRM provider authentication](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs) - Documents supported Azure authentication methods for Terraform.
- [Google provider authentication](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/provider_reference) - Documents Google provider credential and project configuration options.
- [GitHub Actions: OpenID Connect in cloud providers](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers) - Documents the `id-token: write` permission and cloud OIDC setup pattern.
- [GitHub Actions: OpenID Connect in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) - Shows GitHub's AWS OIDC trust setup and use of `aws-actions/configure-aws-credentials`.
- [AWS IAM: Creating OpenID Connect identity providers](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html) - Documents AWS IAM OIDC providers used by web identity federation.
- [AWS action: Configure AWS credentials](https://github.com/aws-actions/configure-aws-credentials) - Official action documentation for GitHub OIDC credential exchange and current major-version examples.
- [AzureRM provider: Service principal with OpenID Connect](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/service_principal_oidc) - Documents AzureRM provider authentication with OpenID Connect for CI.
- [Microsoft Learn: Azure Login with OpenID Connect](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) - Documents authenticating GitHub Actions to Azure with OIDC and federated identity credentials.
- [Microsoft Learn: Workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) - Explains federated credentials, issuer, subject, and audience matching for Microsoft Entra workload identity federation.
- [Google Cloud: Workload Identity Federation with deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) - Documents federation from CI/CD systems such as GitHub Actions to Google Cloud service accounts.

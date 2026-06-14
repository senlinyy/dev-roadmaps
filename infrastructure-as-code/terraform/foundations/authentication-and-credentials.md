---
title: "Authentication and Credentials"
description: "Learn how Terraform safely gets permission to call cloud APIs from laptops and CI/CD pipelines."
overview: "Terraform providers need credentials before they can read or change cloud resources. This article explains local CLI authentication, environment variables, provider credential discovery, OIDC federation for CI/CD, and the deployment evidence teams record after real runs."
tags: ["terraform", "authentication", "credentials", "security"]
order: 5
id: article-iac-terraform-foundations-authentication
---

## Table of Contents

1. [Why Terraform Needs a Cloud Identity](#why-terraform-needs-a-cloud-identity)
2. [The Safe Shape of a Terraform Credential](#the-safe-shape-of-a-terraform-credential)
3. [Local Developer Authentication](#local-developer-authentication)
4. [Environment Variables and Credential Discovery](#environment-variables-and-credential-discovery)
5. [CI/CD Identity](#cicd-identity)
6. [OIDC Federation for GitHub Actions and GitLab CI](#oidc-federation-for-github-actions-and-gitlab-ci)
7. [Provider Blocks Without Secrets](#provider-blocks-without-secrets)
8. [What to Record for a Real Deployment Run](#what-to-record-for-a-real-deployment-run)
9. [Putting It All Together](#putting-it-all-together)

## Why Terraform Needs a Cloud Identity
<!-- section-summary: Terraform can describe infrastructure in files, but a provider still needs a trusted identity before it can call cloud APIs. -->

Terraform feels local at first. You write `.tf` files on your laptop, run `terraform plan`, and see a neat list of resources that might be created. But the moment Terraform needs to check whether a VPC exists, read a subnet, create a storage bucket, or update an IAM policy, it has to talk to a real cloud API.

That API call needs **authentication**. Authentication means proving who is making the request. If Terraform wants to create the production database for `devpolaris-orders-api`, AWS, Azure, or Google Cloud needs to know which person or automation job is asking. The cloud provider then checks **authorization**, which means checking what that identity is allowed to do.

The important detail is that Terraform acts as the coordinator for cloud work. Terraform delegates cloud API calls to **providers**. A provider is a Terraform plugin that knows how to talk to one external API, such as AWS, Azure, Google Cloud, Cloudflare, or GitHub. The provider block configures that plugin, and the provider documentation defines which credential sources it can use.

So when you run this tiny AWS example, Terraform reads the configuration and hands the cloud-specific work to the AWS provider. The AWS provider reads the provider configuration, finds credentials somewhere in the run environment, signs AWS API requests with those credentials, and sends the request to AWS.

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-exports-dev"
}
```

Notice what this code says and what it leaves out. It says the AWS region. It says which bucket Terraform should manage. It leaves out the access key, password, browser login token, and session token. That is the shape we want for most Terraform code: the configuration names the target, and the run environment supplies the identity.

This split matters because the same code often runs in several places. Priya might run `terraform plan` from her laptop against the dev account. Later, GitHub Actions might run `terraform apply` against the production account after a pull request is approved. The `.tf` files can stay the same, while the identity changes based on where the command runs.

Before we talk about AWS SSO, Azure CLI, GCP ADC, and CI/CD federation, we need one shared rule for all of them: Terraform needs credentials for the current run, and those credentials should have a small scope and a short lifetime. That rule gives us a safe way to compare local laptops, cloud runners, and external CI/CD systems.

## The Safe Shape of a Terraform Credential
<!-- section-summary: Safe Terraform authentication gives the provider a short-lived, scoped identity for one run instead of a permanent secret copied into code. -->

A **credential** is proof that a caller can act as an identity. For a human, that proof may come from a browser login plus MFA. For a CI/CD job, it may come from a signed OIDC token exchanged for cloud credentials. For a virtual machine, it may come from a managed identity or instance role attached to the machine.

The dangerous version is a **long-lived cloud key**. In AWS, that usually means an access key ID and secret access key for an IAM user. In Azure, it might be a service principal client secret. In Google Cloud, it might be a downloaded service account JSON key. These keys keep working until someone rotates or deletes them, which gives them a long life outside the cloud provider's control.

Here is the common accident. A team creates a key for Terraform, stores it in a local `.env` file, copies it into a CI secret, shares it with a second engineer, and then forgets where every copy went. Three months later, the key appears in a log, a branch, a Docker layer, or an old laptop backup. The cloud provider can disable the original key, but it cannot magically erase every place the secret was pasted.

The safer pattern is **temporary credentials**. Temporary credentials expire automatically after a short time, often minutes or hours. If a temporary credential leaks after the run, the damage window is smaller. If the credential also belongs to a narrow role, the leaked session can only do the actions that role allows.

For our running example, imagine `devpolaris-orders-api` has Terraform that manages these resources:

| Resource area | Example cloud resources | Terraform needs permission to |
| --- | --- | --- |
| Networking | VPC, subnets, security groups | Read shared network IDs and manage app-specific rules |
| Compute | ECS service, Azure Container App, or Cloud Run service | Deploy the application runtime |
| Data | RDS, Azure Database, or Cloud SQL | Create the database and manage connection settings |
| Observability | CloudWatch, Azure Monitor, or Cloud Logging | Create log groups, metrics, and alerts |
| State | S3 and DynamoDB, Azure Storage, or GCS | Read and lock Terraform state |

The Terraform identity for this service should match the job. A local developer doing a review plan can use read-heavy permissions in a dev account. A production deploy job can use a deploy role such as `devpolaris-orders-api-terraform-deploy`, limited to the resources and state backend for that service. A pull request from an untrusted fork should get no production cloud credentials at all.

So the first big idea is simple: **design Terraform authentication around short-lived identities for the current run**. Copied permanent keys create cleanup and incident-response work every time they spread. Local runs use local developer login flows. Pipeline runs use pipeline identities. Cloud-hosted runners use the platform identity attached to the runner.

That gives us the next split in the article. First we will handle local developer authentication, because this is where beginners usually start. Then we will move to CI/CD authentication, because production deploys should have their own identity story.

## Local Developer Authentication
<!-- section-summary: Local Terraform runs should usually use cloud CLI login flows, so the developer signs in normally and the provider finds a temporary session. -->

Local authentication means Terraform runs from a developer machine and uses a credential source that belongs to that developer. This is usually the right setup for `terraform fmt`, `terraform validate`, and development `terraform plan` runs. It can also support dev-account applies when the team allows developers to create sandbox infrastructure.

The clean local pattern is **cloud CLI authentication**. The engineer signs in through the provider's official CLI, and the Terraform provider reuses the CLI's credential files or application default credential store. The `.tf` code still avoids secret values. The laptop holds the login session, and the cloud account still controls the actual permission.

For AWS, the beginner-friendly path is usually **AWS IAM Identity Center**, often called AWS SSO in CLI commands. The engineer signs in through a browser, completes MFA, and the AWS CLI stores a temporary session for a named profile.

```bash
aws configure sso --profile devpolaris-dev
aws sso login --profile devpolaris-dev
export AWS_PROFILE=devpolaris-dev
terraform plan
```

The profile name is only a local label. In a real setup, the profile points to an AWS account and a permission set, such as read-only access to the dev account or deploy access to a sandbox account. The repository stays free of IAM user access keys. The AWS provider can use the selected profile, then call AWS APIs as the role session that Identity Center issued.

For Azure, the common local path is **Azure CLI authentication**. The engineer signs in with `az login`, selects the subscription, and runs Terraform in the same shell. The AzureRM provider can use the active Azure CLI session for local development.

```bash
az login
az account set --subscription "DevPolaris Development"
terraform plan
```

In Azure, an explicit subscription choice matters. A developer may have access to several subscriptions, and a silent subscription mismatch can send a plan to the wrong place. Many teams put the subscription ID in a variable or environment variable and make the provider configuration show the intended target clearly.

For Google Cloud, the common local path is **Application Default Credentials**, usually shortened to ADC. ADC is the credential lookup flow used by Google client libraries and tools such as the Terraform Google provider. For Terraform on a workstation, the practical command is usually `gcloud auth application-default login`.

```bash
gcloud auth application-default login
gcloud config set project devpolaris-dev
terraform plan
```

This is worth saying slowly because beginners often mix up two Google commands. `gcloud auth login` signs the `gcloud` CLI in for interactive CLI commands. `gcloud auth application-default login` writes credentials in the ADC location that application libraries and the Terraform provider can discover. In day-to-day work, engineers often use both, but Terraform commonly relies on the ADC side.

Here is how the local `devpolaris-orders-api` workflow might look across clouds:

| Cloud | Local sign-in | Terraform target setting | Good local use |
| --- | --- | --- | --- |
| AWS | `aws sso login --profile devpolaris-dev` | `AWS_PROFILE` and provider `region` | Plan and sandbox apply in the dev account |
| Azure | `az login` and `az account set` | `subscription_id` or `ARM_SUBSCRIPTION_ID` | Plan against the selected subscription |
| Google Cloud | `gcloud auth application-default login` | provider `project` and `region` | Plan against the selected project |

Local CLI login works well because it keeps human authentication human. The engineer uses MFA, the session can expire, access can be removed through the identity system, and the Terraform code stays free of secret values.

There is still one place where secrets and settings commonly enter Terraform runs: environment variables. They are useful, but they also explain many confusing authentication bugs.

## Environment Variables and Credential Discovery
<!-- section-summary: Providers search several credential sources, and environment variables often override local files or CLI profiles. -->

A **credential discovery chain** is the ordered list of places a provider checks when it needs credentials. Each provider has its own exact rules, so use the provider documentation as the source of truth. The general pattern is still easy to recognize: provider arguments, environment variables, shared credential files, CLI credential stores, and cloud metadata services.

Environment variables are values attached to the current shell process. When you run `terraform plan`, your shell passes those values to Terraform, and Terraform passes the relevant environment to provider plugins. That makes environment variables a convenient way to change one run without editing code.

For AWS, you might see variables like these:

```bash
export AWS_PROFILE=devpolaris-dev
export AWS_REGION=us-east-1
terraform plan
```

You might also see the three-part temporary credential set that AWS STS returns:

```bash
export AWS_ACCESS_KEY_ID="ASIA..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
terraform plan
```

The session token is important. An AWS access key ID and secret access key pair can represent a long-lived IAM user key or a temporary session. Temporary AWS credentials include `AWS_SESSION_TOKEN`. If a pipeline step receives temporary credentials and forgets to export the session token, Terraform will fail authentication or call AWS as the wrong identity.

For AzureRM, automation often uses variables such as these:

```bash
export ARM_SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000000"
export ARM_TENANT_ID="11111111-1111-1111-1111-111111111111"
export ARM_CLIENT_ID="22222222-2222-2222-2222-222222222222"
export ARM_USE_OIDC=true
terraform plan
```

That example names the subscription, tenant, and workload identity client. It uses OIDC and leaves out a client secret. Older service principal examples often include `ARM_CLIENT_SECRET`; treat that as a legacy or exception path when a platform has no federation support yet.

For Google Cloud, you may see these:

```bash
export GOOGLE_PROJECT="devpolaris-dev"
export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/to/application-default.json"
terraform plan
```

The file named by `GOOGLE_APPLICATION_CREDENTIALS` must be protected because it can contain usable credential material. In a workstation setup, ADC created through the CLI login flow gives Terraform a safer local path. In a pipeline setup, workload identity federation or a platform-provided identity gives the run a cleaner path than downloaded service account keys.

The discovery chain explains a very normal debugging story. Priya runs `terraform plan` and expects her AWS SSO profile to be used. The plan fails with access denied in a different account. She runs `env | grep AWS` and finds old `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` values left over from yesterday. The AWS provider saw those environment variables before the SSO profile she had in mind.

A practical pre-flight check catches this before a plan touches real infrastructure:

```bash
aws sts get-caller-identity
az account show --query "{name:name, id:id, tenantId:tenantId}"
gcloud auth list
gcloud config get-value project
```

The command for the cloud you are using gives you a caller to compare with your Terraform variables and backend configuration. For AWS, the important values are the account ID and ARN. For Azure, they are the subscription and tenant. For Google Cloud, they are the active account and project. This takes a few seconds and saves a lot of "why did Terraform read that account?" confusion.

Now we can move from laptops to automation. The same provider discovery idea applies, and the identity source changes from a human login session to the CI/CD platform running the job.

## CI/CD Identity
<!-- section-summary: Production Terraform runs should use a dedicated pipeline identity with scoped permissions and clear audit names. -->

CI/CD means the automated system that tests, plans, approves, and deploys changes. GitHub Actions, GitLab CI, Azure DevOps, Jenkins, Buildkite, and similar systems run Terraform from automation runners. Those runners need cloud access with their own identity, separate from a person's login session.

The usual automation pattern is a **workload identity**. A workload identity is an identity assigned to software, a job, or a runtime. A human identity belongs to a person, and a workload identity belongs to automation. For our `devpolaris-orders-api` example, the production pipeline can use a role named `devpolaris-orders-api-terraform-deploy`. That role can have permission to manage only the infrastructure owned by this service and the state backend used by this service.

The pipeline identity should answer four questions clearly:

| Question | Example answer |
| --- | --- |
| Which system can request credentials? | GitHub Actions in `devpolaris/devpolaris-orders-api` |
| Which branch, tag, or environment can deploy? | `main` branch with the `production` environment approval |
| Which cloud role does the job receive? | `arn:aws:iam::123456789012:role/devpolaris-orders-api-terraform-deploy` |
| Which resources can the role manage? | Orders API ECS service, task role, log groups, alarms, and its state backend |

This separation gives local development and production deployment different risk profiles. A developer can run a dev plan with a personal SSO session. The production apply runs through a controlled workflow, with a deploy role, an approval gate, and an audit trail tied to the commit and run ID.

Cloud-hosted runners may also have platform-native identity options. Terraform running on an Azure VM or Azure-hosted agent can use a managed identity. Terraform running on an AWS EC2 runner can use an instance profile. Terraform running inside Google Cloud can use a service account attached to the workload. These are good patterns when the runner is inside the cloud boundary because the platform can hand the provider temporary credentials without a copied secret.

External CI/CD systems need a different bridge because the runner starts outside the cloud provider. That bridge is usually OIDC federation.

## OIDC Federation for GitHub Actions and GitLab CI
<!-- section-summary: OIDC lets a CI/CD job exchange a signed job identity token for short-lived cloud credentials without storing a cloud key in the repository. -->

**OpenID Connect**, or **OIDC**, is a standard way for one system to issue a signed identity token that another system can verify. In CI/CD, the CI platform issues a token that describes the job. The cloud provider checks that token, checks the trust rules on a role or application, and returns temporary credentials for the job.

Think about the production deploy for `devpolaris-orders-api`. The target setup lets GitHub Actions deploy from the `main` branch after approval while GitHub repository secrets stay free of permanent AWS keys. With OIDC, GitHub gives the job a signed token for this exact workflow run, and AWS exchanges that token for a role session if the trust policy matches.

A GitHub Actions workflow can look like this:

```yaml
name: deploy

on:
  push:
    branches: ["main"]

permissions:
  contents: read
  id-token: write

jobs:
  terraform:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/devpolaris-orders-api-terraform-deploy
          aws-region: us-east-1
          role-session-name: devpolaris-orders-api-${{ github.run_id }}

      - run: terraform -chdir=infra init
      - run: terraform -chdir=infra plan -out=tfplan
      - run: terraform -chdir=infra apply -auto-approve tfplan
```

The `id-token: write` permission lets the job request an OIDC token from GitHub. The AWS credentials action exchanges that token for temporary AWS credentials by assuming the deploy role. The role trust policy should check claims such as repository, branch, and environment, so approved workflows are the only workflows that receive the same role.

GitLab CI uses the same overall idea. GitLab issues an OIDC ID token for the job, and the job exchanges it with AWS STS through `AssumeRoleWithWebIdentity`. GitLab's current guidance uses ID tokens for this flow.

```yaml
deploy:
  image: amazon/aws-cli:2
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: sts.amazonaws.com
  script:
    - >
      aws_sts_output=$(aws sts assume-role-with-web-identity
      --role-arn "$ROLE_ARN"
      --role-session-name "GitLabRunner-${CI_PROJECT_ID}-${CI_PIPELINE_ID}"
      --web-identity-token "$GITLAB_OIDC_TOKEN"
      --duration-seconds 3600
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]'
      --output text)
    - export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s" $aws_sts_output)
    - terraform -chdir=infra init
    - terraform -chdir=infra plan
```

GitLab trust policies can restrict access by project, branch, tag, and other token claims. On GitLab.com, stable identifiers such as project ID and namespace ID can help keep trust rules tied to the real project even if a group path changes. That matters because CI trust should follow stable project identifiers through future renames.

Azure supports the same pattern with Microsoft Entra workload identity federation. A GitHub Actions job can request an OIDC token, Azure can validate it against a federated credential on an app registration or managed identity, and the AzureRM provider can use the resulting workload identity through environment variables such as `ARM_USE_OIDC`, `ARM_CLIENT_ID`, `ARM_TENANT_ID`, and `ARM_SUBSCRIPTION_ID`.

Google Cloud also supports federation through workload identity federation. In that setup, a CI job exchanges its external OIDC token for access as a Google service account, and the Terraform Google provider can use those credentials for the run. The names differ across clouds, and the security shape stays consistent: the CI job proves who it is, the cloud provider issues a short-lived credential, and Terraform uses that credential only for the current run.

OIDC solves the biggest CI/CD credential problem. Repository secrets stay free of permanent cloud keys. The cloud trust rule can say exactly which repository, branch, tag, or environment can request the deploy identity. The credential expires after the job, and the audit trail can point back to one workflow run.

Now that the identity source is clean, the Terraform provider block should stay clean too. The next step is deciding which values belong in code and which values belong in the run environment.

## Provider Blocks Without Secrets
<!-- section-summary: Provider blocks should describe the target cloud configuration while secret material stays in CLI sessions, environment variables, or workload identity systems. -->

A **provider block** configures a provider plugin. It can set things like region, subscription ID, project ID, default tags, and provider aliases. Provider-specific arguments are defined by each provider, and many providers allow values to come from environment variables or other external sources.

Provider blocks are a good place for non-secret target information. They are a bad place for secret material because Terraform files live in version control, get reviewed in pull requests, and may be copied into examples. Even if a provider marks a field as sensitive, a committed secret is still a committed secret.

Here is a clean AWS provider for `devpolaris-orders-api`. It names the region and default tags. It lets the AWS provider discover credentials from AWS SSO locally or OIDC-provided environment variables in CI.

```hcl
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "devpolaris-orders-api"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
```

If the same code deploys to multiple AWS accounts, a role can be part of the provider configuration. The role ARN is a cloud resource address, so teams can commit it the same way they commit a region or project ID. Terraform uses that address after the initial authentication source proves it is allowed to assume that role.

```hcl
provider "aws" {
  region = var.aws_region

  assume_role {
    role_arn     = "arn:aws:iam::123456789012:role/devpolaris-orders-api-terraform-deploy"
    session_name = "terraform-devpolaris-orders-api"
  }
}
```

That configuration still needs an initial identity. Locally, the initial identity might be Priya's AWS SSO profile. In GitHub Actions, it might be the OIDC role session created by the credentials action. The provider block tells the AWS provider which deploy role to use, and the run environment supplies the proof that this caller can use it.

For AzureRM, the provider usually carries target subscription information and the required `features` block. The credentials can come from Azure CLI locally or OIDC variables in CI.

```hcl
provider "azurerm" {
  features {}

  subscription_id = var.azure_subscription_id
}
```

For Google Cloud, the project and region belong in visible configuration. ADC, workload identity federation, or service account impersonation can provide the credential.

```hcl
provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
```

The same rule applies to Terraform variables. A variable named `aws_region` or `gcp_project_id` is normal. A variable named `aws_secret_access_key` should make you pause. Passing a secret through Terraform variables can leak into plans, logs, shell history, CI output, or state depending on how it is used. The safer design keeps cloud secrets outside Terraform input whenever the provider can discover credentials directly.

We have now covered local identity, environment variables, CI identity, OIDC, and clean provider blocks. The last operational piece is recordkeeping. In a real deployment, the team needs enough evidence to explain who changed what, where, and from which run.

## What to Record for a Real Deployment Run
<!-- section-summary: A production Terraform run should leave an audit trail that names the identity, target environment, commit, plan, approval, and credential source without recording secret values. -->

A real Terraform deployment should leave a useful trail. This trail helps during incident review, rollback planning, access audits, and normal team handoff. The goal is to record the facts of the run while leaving out secret values.

For a production `devpolaris-orders-api` apply, record these items:

| Record | Example |
| --- | --- |
| Service | `devpolaris-orders-api` |
| Environment | `production` |
| Cloud target | AWS account `123456789012`, Azure subscription ID, or GCP project ID |
| Terraform version | `Terraform v1.13.5` |
| Provider versions | AWS provider `6.x`, AzureRM provider `4.x`, or Google provider `6.x` |
| State backend | `s3://devpolaris-tfstate/orders-api/prod.tfstate` |
| Code version | Commit SHA and pull request number |
| Plan identity | Human SSO profile or CI role session used for `terraform plan` |
| Apply identity | `devpolaris-orders-api-terraform-deploy` role or equivalent workload identity |
| Credential source | AWS SSO, Azure CLI, GCP ADC, GitHub OIDC, GitLab OIDC, managed identity |
| Approval | Change ticket, environment approval, or release approval |
| Run ID | GitHub run ID, GitLab pipeline ID, Jenkins build number, or similar |
| Plan artifact | Saved plan file name and checksum, if your process uses saved plans |
| Apply result | Start time, end time, success or failure, and link to logs |

For AWS, add the output of `aws sts get-caller-identity` to the run evidence. For Azure, record the subscription ID, tenant ID, and client or object ID of the workload identity. For Google Cloud, record the project ID and service account email or federated principal used by the job.

Access keys, client secrets, service account JSON content, OIDC tokens, session tokens, and raw environment dumps stay out of the record. Those values are credentials. A deployment log should help you prove which identity ran Terraform without giving the next reader the ability to impersonate that identity.

Session names deserve special attention. In AWS, a clear session name such as `devpolaris-orders-api-1234567890` makes CloudTrail easier to read. In Azure, the workload identity application or managed identity name should map cleanly to the pipeline. In Google Cloud, service account impersonation and workload identity federation should point back to the repository and run. Good names turn audit logs into a story a human can follow.

This recordkeeping is also how you catch wrong-auth mistakes. A production run with a developer's sandbox profile, a GitHub OIDC run with an access key in the environment, or a subscription mismatch between the plan target and backend should pause the deployment. The record makes those mismatches visible before an apply changes infrastructure.

## Putting It All Together
<!-- section-summary: Terraform authentication works best when each run gets credentials from the environment it runs in and the provider block stays free of secrets. -->

Let's connect the whole flow through `devpolaris-orders-api`. This is the same service we used for local plans, pipeline deploys, and audit records, so it gives the whole article one concrete path.

Priya starts locally. She signs in with AWS SSO, Azure CLI, or GCP ADC depending on the cloud she is working in. She runs a pre-flight identity check, then runs `terraform plan` against the development environment. The provider block names the region, subscription, or project. The credential comes from her local CLI session, and her access can be removed through the company's identity system.

The production pipeline runs separately. GitHub Actions or GitLab CI receives a signed OIDC token for the job. The cloud provider checks the token claims and issues temporary credentials for `devpolaris-orders-api-terraform-deploy`. Terraform uses those credentials for `plan` and `apply`, and the session expires after the run.

Environment variables still play a role. They can select a profile, pass a region, name a subscription, enable OIDC, or carry temporary credentials produced by a federation step. They deserve the same attention as the rest of the run environment. Authentication surprises often come from stale variables, and logs should avoid raw environment dumps.

The provider discovers credentials through provider-specific rules. AWS, AzureRM, and Google each have their own documentation and their own supported sources. Terraform's job is to load the provider and pass it configuration. The provider's job is to find credentials, call the cloud API, and return results to Terraform.

The safe operating pattern is consistent across clouds:

- **Local developers use human login flows** such as AWS SSO, Azure CLI, and GCP ADC.
- **Pipelines use workload identity** such as OIDC federation, managed identity, instance roles, or service account impersonation.
- **Provider blocks avoid secrets** and describe the target environment instead.
- **Long-lived cloud keys stay rare** and receive tight scope, rotation, storage, and exception tracking when a legacy tool still needs them.
- **Deployment records name the caller** without exposing the credential.

That is the practical foundation. Terraform can only manage infrastructure after a cloud provider trusts the caller. Safe teams make that trust short-lived, scoped, visible in audit logs, and separate between local development and production automation.

---

**References**

- [Provider block reference](https://developer.hashicorp.com/terraform/language/block/provider) - Explains how Terraform provider blocks configure provider plugins and why provider-specific documentation defines each provider's arguments.
- [AWS provider docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Documents AWS provider authentication and configuration options.
- [AzureRM provider docs](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs) - Documents AzureRM provider authentication and configuration options.
- [AzureRM service principal OIDC guide](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/service_principal_oidc) - Explains OIDC-based authentication for Azure service principals with the AzureRM provider.
- [Google provider configuration reference](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/provider_reference) - Documents Google provider configuration, project settings, and credential options.
- [GitHub Actions OIDC](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - Explains how GitHub Actions jobs can request short-lived cloud credentials through OIDC.
- [GitLab AWS OIDC tutorial](https://docs.gitlab.com/ci/cloud_services/aws/) - Shows how GitLab CI jobs use OIDC ID tokens to retrieve temporary AWS credentials.

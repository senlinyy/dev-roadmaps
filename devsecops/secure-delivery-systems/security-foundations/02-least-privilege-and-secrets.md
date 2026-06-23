---
title: "Least Privilege and Secrets"
description: "Limit permissions for people, workloads, and pipelines, and replace static shared secrets with scoped, short-lived access."
overview: "Follow one delivery pipeline as it moves from shared deployment keys to SSO, workload identities, secret managers, rotation plans, repository protections, and OIDC-based CI/CD access."
tags: ["devsecops", "least-privilege", "secrets", "oidc"]
order: 2
id: article-devsecops-security-foundations-least-privilege
aliases:
  - least-privilege
  - article-devsecops-security-foundations-least-privilege
  - devsecops/security-foundations/least-privilege.md
  - secrets-management-basics
  - article-devsecops-security-foundations-secrets-management-basics
  - devsecops/security-foundations/secrets-management-basics.md
  - devsecops/security-foundations/02-least-privilege-and-secrets.md
  - devsecops/security-foundations/02-least-privilege-and-secrets
  - security-foundations/02-least-privilege-and-secrets
---

## Table of Contents

1. [The Production Story](#the-production-story)
2. [Least Privilege](#least-privilege)
3. [Static Shared Secrets](#static-shared-secrets)
4. [Scoped Access For People](#scoped-access-for-people)
5. [Scoped Access For Workloads](#scoped-access-for-workloads)
6. [Keep Secrets Out Of Code And Builds](#keep-secrets-out-of-code-and-builds)
7. [Secret Managers](#secret-managers)
8. [Rotation](#rotation)
9. [Repository And Environment Protections](#repository-and-environment-protections)
10. [CI/CD OIDC Federation](#cicd-oidc-federation)
11. [Static Key Versus OIDC Session](#static-key-versus-oidc-session)
12. [Leaked Secret Incident Response](#leaked-secret-incident-response)
13. [Putting It All Together](#putting-it-all-together)

## The Production Story
<!-- section-summary: We will use one realistic delivery pipeline so every permission and secret has a concrete job. -->

Let's stay with one production system through the whole article. The company is called ParcelPulse. It runs a delivery tracking product for small shops. Customers upload shipping labels, warehouse staff scan packages, and shoppers see delivery status in a web app. The engineering team has one main API, one PostgreSQL database, one object storage bucket for label PDFs, and one GitHub Actions pipeline that builds and deploys the API to production.

The production path has several callers. A person like Mia, a backend engineer, needs to read logs and deploy approved releases. The API container needs to read the database password and write label PDFs into one bucket. The CI/CD pipeline needs to push a container image and update the production service. A coverage uploader runs during tests and sends test coverage to a vendor. Each caller has a real job, and each job needs a different amount of access.

That is the structure of this article. We will first define **least privilege**, then look at the common shortcut: one long-lived deployment key placed in the pipeline. From there, we will separate access for **people**, **workloads**, and **pipelines**, then we will handle the secret lifecycle: storage, rotation, repository protections, OIDC federation, and incident response after a leak.

Here are the pieces we will connect:

| Piece | Simple definition | ParcelPulse example |
|---|---|---|
| **Principal** | The identity making a request | Mia, the API container, or the GitHub Actions job |
| **Permission** | The action the identity can take | `s3:PutObject`, `logs:FilterLogEvents`, or `ecs:UpdateService` |
| **Scope** | The boundary around that permission | One bucket, one branch, one environment, one role session |
| **Secret** | A sensitive value that proves identity or unlocks access | Database password, API key, cloud access key, signing key |
| **Session** | A temporary access window | A one-hour deployment role session for one workflow run |

The key idea is simple, but the implementation touches many places. A secure delivery system needs access that matches the caller, the task, the environment, and the time window. A developer reading logs, an API container reading a database password, and a deployment job updating production should never share the same credential.

## Least Privilege
<!-- section-summary: Least privilege means every person, workload, and pipeline gets the minimum access needed for its assigned task. -->

**Least privilege** means granting the minimum access needed to complete an assigned task. NIST defines the principle around restricting users and processes to the minimum privileges they need. In plain DevOps terms, a caller should have enough access to do its real work and no extra access for unrelated systems.

For ParcelPulse, Mia needs to inspect API logs during an incident. She does not need the production database password for that. The API container needs to read the database password at startup. It does not need permission to create new IAM users. The deployment pipeline needs to update the production ECS service after approval. It does not need read access to every customer label in object storage.

You can think about least privilege with four questions:

| Question | What you are narrowing | Example answer |
|---|---|---|
| **Who is calling?** | The identity | `parcelpulse-api-prod`, `github-actions-prod-deploy`, or Mia through SSO |
| **What action is needed?** | The API operation | Read logs, fetch one secret, push one image, update one service |
| **Which resource is allowed?** | The target | One log group, one secret ARN, one registry repository, one ECS service |
| **What context must be true?** | The condition | Main branch, production environment approval, MFA, one repository claim |

This table matters because broad access often enters through one fuzzy phrase: "the pipeline needs AWS access." That phrase hides the caller, the action, the resource, and the conditions. A real policy needs all four. The pipeline may need `ecr:PutImage` for one repository and `ecs:UpdateService` for one service, while a separate migration job may need database migration access for a short window.

Real teams rarely produce perfect least-privilege policies on day one. They usually start with a working permission set in a low-risk account, run the normal workflow, inspect actual usage, and then reduce the policy. On AWS, CloudTrail records API calls, and IAM Access Analyzer can generate a policy template from recent activity. That generated policy still needs human review, but it gives the reviewer evidence instead of guesses.

For ParcelPulse, the platform team can keep an access worksheet in the pull request that introduces a new deployment role:

| Caller | Needed actions | Resource scope | Time scope | Owner |
|---|---|---|---|---|
| `github-actions-prod-deploy` | Push image, update ECS service | `parcelpulse-api` ECR repo and `parcelpulse-prod` ECS service | One workflow job | Platform team |
| `parcelpulse-api-prod` | Read DB secret, write labels | One Secrets Manager secret and `labels/prod/*` bucket prefix | Runtime task session | API team |
| `release-managers` | Approve production deployment | GitHub `production` environment | Human approval session | Engineering manager |

This is a practical habit, not paperwork for its own sake. The table gives the team a place to ask, "Does the coverage uploader need the cloud key?" The answer should be no. The uploader sends coverage to the vendor, so it should receive only the vendor token it needs, and only in the job that sends coverage.

The next section shows why this separation matters. ParcelPulse starts with a single static cloud key in the pipeline because that is quick. The shortcut works, and then it quietly creates a large blast radius.

## Static Shared Secrets
<!-- section-summary: Static shared secrets keep working until someone revokes them, so one leak can expose many jobs and environments. -->

A **static secret** is a sensitive value that stays valid until someone changes or revokes it. A cloud access key, database password, personal access token, SSH private key, and webhook signing secret can all be static secrets. A **shared secret** means more than one person, job, service, or machine uses the same value. Shared secrets make incidents harder because the team cannot quickly tell who used the value or where every copy lives.

ParcelPulse takes the common early shortcut. The team creates an IAM user called `parcelpulse-ci`, gives it permission to deploy, creates an access key, and stores the key in GitHub Actions repository secrets. The deployment workflow reads those values every time it runs:

```yaml
name: deploy-api

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.PROD_AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.PROD_AWS_SECRET_ACCESS_KEY }}
      AWS_REGION: us-east-1
    steps:
      - uses: actions/checkout@v6
      - run: ./scripts/build-and-deploy.sh
```

This setup is convenient on the first day because the script can call AWS. The problem appears as the workflow grows. The same job may install dependencies, run tests, upload coverage, build a container, scan the image, and deploy. Every step in that job runs in the same runner environment, so the key sits near many pieces of code that do not need production deployment access.

The risk also lasts too long. An AWS access key for an IAM user can work for months or years. If someone copies it into a local terminal, a Docker layer, a debug log, or a third-party action, the key keeps working from outside GitHub until the team deactivates it. GitHub may mask the exact value in logs, but masking log output does not stop code in the workflow from sending the value somewhere else.

The 2021 Codecov Bash Uploader incident is a good real-world warning. Codecov's post-mortem says an attacker extracted a Google Cloud Storage service account HMAC key from an intermediate layer in a public self-hosted Docker image, used it to modify the Bash Uploader, and the malicious uploader extracted environment variables from customer CI environments. The painful part for customers came from the same idea ParcelPulse is facing: CI environments often hold powerful secrets, and build tools run close to those secrets.

![Static key versus scoped sessions infographic comparing one long-lived CI secret with separate people, workload, and pipeline sessions](/content-assets/articles/article-devsecops-security-foundations-least-privilege/static-key-vs-scoped-sessions.png)

*One shared key spreads risk across many jobs, while separate scoped sessions keep people, workloads, and pipelines on their own access paths.*

After a CI secret leaks, the hard questions arrive immediately. Which jobs had the secret? Which third-party tools ran beside it? Did a forked pull request touch the workflow? Did the secret appear in a container image layer? Did someone reuse the same cloud key in another repository? These questions take time because static shared secrets spread into places that are hard to inventory.

Least privilege turns those questions into design requirements. People need scoped human access. Workloads need scoped runtime access. Pipelines need short-lived deployment sessions. Secret values that must exist need storage, rotation, and audit trails. Let's separate those paths one by one.

## Scoped Access For People
<!-- section-summary: Human access should flow through workforce identity, groups, MFA, and role sessions instead of shared production keys. -->

**Human access** means access used by real people: developers, operators, release managers, auditors, and support engineers. People need to sign in, investigate issues, approve changes, and sometimes run emergency actions. They should use named accounts through a workforce identity system, so the team can answer who accessed production and why.

ParcelPulse uses a company identity provider such as Okta, Microsoft Entra ID, Google Workspace, or another SSO source. The cloud account trusts that identity provider, and engineers receive access through groups. Mia belongs to `parcelpulse-developers`, which can read development resources and production logs. The release lead belongs to `parcelpulse-release-managers`, which can approve production deployments. A small on-call group can request short emergency access during incidents.

The practical pattern has three layers:

| Layer | What it controls | ParcelPulse choice |
|---|---|---|
| **Identity** | Who the person is | SSO account with MFA |
| **Group** | What job the person has | Developer, release manager, on-call |
| **Session** | How long access lasts | CLI or console session with an expiration |

For AWS, this usually means IAM Identity Center or another federation path into AWS roles. For Azure, it means Entra ID groups and Azure RBAC assignments. For Google Cloud, it means IAM bindings for groups from Cloud Identity or Google Workspace. The names change by provider, but the security shape stays the same: people authenticate to the company directory, receive temporary access, and avoid long-lived personal cloud keys for daily work.

Mia's normal production access can stay narrow. She needs to read logs and inspect service status, so a policy can grant CloudWatch log read actions for the API log group and ECS read actions for the cluster. She does not need database write access, object storage delete access, or IAM administration.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadParcelPulseApiLogs",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents",
        "logs:GetLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/parcelpulse-api-prod:*"
    },
    {
      "Sid": "ReadParcelPulseServiceState",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:ListTasks"
      ],
      "Resource": "*"
    }
  ]
}
```

The ECS read actions show one normal production compromise. Some cloud APIs still need broad resource patterns for list or describe calls, depending on the service. Least privilege still helps because the policy grants read-only ECS visibility instead of production mutation. The team can add conditions and account-level guardrails where the provider supports them.

For local CLI work, Mia should use temporary credentials from the identity system:

```bash
aws sso login --profile parcelpulse-prod-readonly
aws logs filter-log-events \
  --profile parcelpulse-prod-readonly \
  --log-group-name /ecs/parcelpulse-api-prod \
  --filter-pattern "ERROR"
```

This gives ParcelPulse named human access, MFA, session expiration, and centralized offboarding. When Mia leaves the company, disabling her workforce identity stops new sessions. The team does not need to hunt through repositories for a shared production key she might have copied six months earlier.

Human access is now cleaner, but the production API still needs machine access. That is the next caller.

## Scoped Access For Workloads
<!-- section-summary: Workloads should use runtime identities such as roles, managed identities, or service accounts instead of embedded cloud keys. -->

A **workload** is running software that needs to call another system. An API container, batch job, Kubernetes pod, VM, serverless function, and database migration job are all workloads. A **workload identity** gives that software its own identity at runtime, so the application can call cloud APIs without storing a static cloud key in the image or repository.

ParcelPulse runs the API as an ECS service. The API needs two production permissions. It must read the database password from AWS Secrets Manager, and it must write label PDFs to one S3 bucket prefix. It does not need permission to list every bucket, read billing data, or change IAM policies.

In ECS, the API uses a **task role** named `parcelpulse-api-prod`. The task role grants permissions to the application code running inside the container. This differs from the **task execution role**, which ECS uses to pull images and fetch secrets for container startup. That split matters because the application should receive only the permissions it needs while running.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadDatabaseSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/parcelpulse/api/postgres-*"
    },
    {
      "Sid": "WriteShippingLabels",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::parcelpulse-labels-prod/labels/*"
    }
  ]
}
```

Behind the scenes, AWS vends temporary credentials to the ECS task. The AWS SDK inside the container can find those credentials through the container runtime credential endpoint. The app code does not need an `AWS_ACCESS_KEY_ID` baked into the image, and the session expires automatically. If the container stops, that runtime identity path stops with it.

The same idea appears across platforms. An EC2 instance uses an instance profile. A Lambda function uses an execution role. A Kubernetes pod can use a Kubernetes service account plus cloud workload identity federation, such as IAM Roles for Service Accounts on EKS, Workload Identity Federation on GKE, or Microsoft Entra Workload ID on AKS. A VM on Azure can use a managed identity. A Google Cloud workload can use a service account without downloading a JSON key when the platform can attach the identity directly.

The practical rule for ParcelPulse is: put the cloud identity on the workload runtime, then make the policy match the workload's job. The API gets `GetSecretValue` for one secret and object access for one bucket prefix. The nightly report job gets read access to a reporting replica and write access to one report bucket. The migration job gets database migration credentials during a release window, then the team removes or disables that path.

This solves the cloud key problem for the running application. The application still needs secrets like database passwords and vendor tokens, so the next step is handling secret values without scattering them through code, build logs, and images.

## Keep Secrets Out Of Code And Builds
<!-- section-summary: Secrets should stay out of source code, image layers, logs, and general build environments. -->

A **secret** is any value that grants access or proves identity. Database passwords, API tokens, private keys, OAuth client secrets, signing keys, webhook secrets, and cloud access keys all count. The safest secret is the one the team can avoid creating. When a secret must exist, the team should store it in a controlled system and expose it only to the caller that needs it.

ParcelPulse has a few secret types. The API uses a PostgreSQL password. The coverage uploader uses a vendor upload token. The deployment workflow may need a container registry login. The app signs webhook payloads with a signing secret. Each value has a different owner, use case, and rotation plan.

The first practical habit is to keep real values out of the repository. A `.env.example` file should show variable names and harmless sample values, while `.env`, `.env.local`, and downloaded credentials stay ignored:

```bash
# .env.example
DATABASE_URL=postgres://app_user:example-password@localhost:5432/parcelpulse
COVERAGE_UPLOAD_TOKEN=example-token
WEBHOOK_SIGNING_SECRET=example-secret
```

```bash
# .gitignore
.env
.env.*
!.env.example
*.pem
*.key
service-account*.json
```

The second habit is to avoid build-time leaks. A Docker image keeps layer history and metadata. Docker's own guidance warns against using `ARG` or `ENV` for secrets in a Dockerfile because those values can persist in the final image or metadata. If ParcelPulse needs a private package token during build, Docker BuildKit secret mounts provide the token only to the build instruction that needs it.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./

RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN \
    npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN" \
    && npm ci \
    && npm config delete //registry.npmjs.org/:_authToken

COPY . .
RUN npm run build
```

The matching GitHub Actions build step can pass the secret to Docker without placing it in the Dockerfile:

```yaml
- name: Build image
  uses: docker/build-push-action@v7
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
  with:
    context: .
    push: false
    tags: parcelpulse-api:test
    secret-envs: |
      npm_token=NPM_TOKEN
```

This still uses a secret, so the team should keep the token narrow. The package token should read only the package scope needed by the build. It should not have permission to publish packages, manage organization settings, or read unrelated private packages. Least privilege applies to vendor tokens just like it applies to cloud roles.

The third habit treats logs as a leak surface. ParcelPulse keeps environment dumps out of logs and keeps `set -x` away from secret-handling shell commands because it echoes commands and expanded values. The team chooses tools that accept secrets through files, standard input, or native secret integrations. In CI, jobs that need secrets stay separate from jobs that process untrusted code, because the runner is a powerful place.

At this point, secrets stay out of code and image layers, but they still need a home. That home is a secret manager.

## Secret Managers
<!-- section-summary: A secret manager centralizes storage, access control, audit, and retrieval for sensitive values. -->

A **secret manager** is a service for storing, retrieving, auditing, and rotating sensitive values. Examples include AWS Secrets Manager, Azure Key Vault, Google Secret Manager, HashiCorp Vault, Doppler, 1Password Secrets Automation, and CyberArk Conjur. The product choice depends on the environment, but the job stays the same: keep secrets out of random files and put access behind identity, policy, logging, and lifecycle controls.

ParcelPulse stores the production database credential in AWS Secrets Manager under the name `prod/parcelpulse/api/postgres`. The secret value contains structured JSON, so the application can read the username, password, host, and database name together:

```json
{
  "username": "parcelpulse_app",
  "password": "replace-with-real-generated-value",
  "engine": "postgres",
  "host": "parcelpulse-prod.cluster-example.us-east-1.rds.amazonaws.com",
  "port": 5432,
  "dbname": "parcelpulse"
}
```

The team can create the secret with the AWS CLI during infrastructure setup. In a real environment, the password should come from a generator or from the database provisioning workflow, and the shell history should never capture the real value.

```bash
aws secretsmanager create-secret \
  --name prod/parcelpulse/api/postgres \
  --description "Production database login for the ParcelPulse API" \
  --secret-string file://postgres-secret.json \
  --tags Key=service,Value=parcelpulse-api Key=environment,Value=prod Key=owner,Value=api-team
```

The API can read the secret at startup through the AWS SDK. This Node.js example shows the shape without adding framework details:

```js
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: "us-east-1" });

export async function loadDatabaseConfig() {
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: "prod/parcelpulse/api/postgres",
    })
  );

  if (!response.SecretString) {
    throw new Error("Database secret did not contain a SecretString value");
  }

  return JSON.parse(response.SecretString);
}
```

There are two important production details here. First, the ECS task role must have `secretsmanager:GetSecretValue` for this one secret. The app does not need broad access to list or read every secret. Second, most applications should cache the secret value in memory for a reasonable period instead of calling the secret manager on every request. AWS recommends client-side caching for Secrets Manager because it improves speed and reduces cost.

Secret names also need structure. ParcelPulse uses this naming pattern:

```bash
{environment}/{service}/{purpose}
```

That gives names like:

```bash
dev/parcelpulse/api/postgres
prod/parcelpulse/api/postgres
prod/parcelpulse/webhook/signing
prod/parcelpulse/coverage/upload-token
```

The naming pattern helps reviews. A production workload should not read a development secret by accident. A frontend service should not read an API database password. A coverage uploader token should not sit beside cloud deployment credentials. Tags such as `owner`, `environment`, `rotation`, and `service` also make inventory and incident response faster.

Secret managers still leave one important risk. A workload with permission to read a secret can leak it through a bug, logs, command output, or a dependency compromise. The manager reduces sprawl and gives the team a control point. Rotation handles the next part of the lifecycle.

![Secret manager rotation loop infographic showing store, grant, read, rotate, restart, revoke old, and audit around a central vault](/content-assets/articles/article-devsecops-security-foundations-least-privilege/secret-rotation-loop.png)

*A secret manager gives the team one controlled place to store, grant, rotate, revoke, and audit sensitive values.*

## Rotation
<!-- section-summary: Rotation replaces old secret values with new ones, updates the target system, and removes the old value after consumers move. -->

**Rotation** means replacing a secret value with a new value. Real rotation has two sides. The secret manager must store the new value, and the system that trusts the secret must accept the new value. If ParcelPulse changes the database password in Secrets Manager but never changes the PostgreSQL user's password, the application breaks. If the database accepts a new password but the app still reads the old one, the app breaks in the other direction.

AWS Secrets Manager describes rotation as updating credentials in both the secret and the database or service. That wording matters because a secret manager is the storage layer, while the database, API provider, or cloud account is the authority that accepts the credential. For database secrets, managed rotation may handle this. For custom vendor API tokens, the team may need a manual or scripted rotation process.

ParcelPulse can rotate database credentials with a staged approach:

| Stage | What happens | Why it helps |
|---|---|---|
| **Prepare** | Confirm owner, consumers, dashboards, and rollback path | The team knows who may break |
| **Create new value** | Generate a new password or token | The new credential exists before cutover |
| **Update authority** | Change the database password or vendor token | The target system accepts the new value |
| **Update secret manager** | Store the new value under the same secret name | Consumers keep using the same lookup path |
| **Restart or refresh consumers** | Roll ECS tasks or let the app refresh its cache | The app starts using the new value |
| **Revoke old value** | Disable the old password or token | The leak window closes |
| **Verify** | Check logs, metrics, and authentication failures | The team catches broken consumers |

For an AWS-managed database secret, the command may look like this after the rotation function or managed rotation option exists:

```bash
aws secretsmanager rotate-secret \
  --secret-id prod/parcelpulse/api/postgres \
  --rotation-rules AutomaticallyAfterDays=30
```

For a manual emergency rotation, the team may put a new secret version after changing the database password:

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/parcelpulse/api/postgres \
  --secret-string file://postgres-secret-rotated.json

aws ecs update-service \
  --cluster parcelpulse-prod \
  --service parcelpulse-api \
  --force-new-deployment
```

The `update-service` command forces new ECS tasks to start. Those tasks read the current secret value at startup. If the app caches secrets for a long time, the team needs a reload path or a restart plan. If the app uses connection pooling, the team should watch database login failures and connection errors during the rollout.

Rotation frequency should match risk and operational reality. A high-value production database credential may rotate automatically every 30 or 60 days. A vendor token with weak audit logs may rotate more often. A secret that supports dual active keys can rotate with no downtime: create key B, deploy consumers to use B, then revoke key A. A secret that allows only one active value needs a planned maintenance path or an application design that can tolerate quick restarts.

Rotation also needs inventory. Codecov's post-mortem called out how hard questions around key metadata can be: when a key was generated, where it is used, and how to revoke it. ParcelPulse should record owner, purpose, environment, creation date, last rotation date, and consumers for every production secret. A secret with no owner is already an incident waiting to happen.

Now secrets have a storage and rotation plan. The next risk sits around the repository and CI/CD environment, because that is where code, workflows, approvals, and secrets meet.

## Repository And Environment Protections
<!-- section-summary: Repository and environment protections keep privileged jobs away from unreviewed code and uncontrolled branches. -->

A CI/CD platform runs code with access to source, build artifacts, tokens, and deployment permissions. That makes the repository a security boundary. If anyone can change the deployment workflow, they may be able to change what production deploys or what secrets the job reads. If untrusted pull request code runs in a privileged job, the workflow can become a secret exfiltration path.

ParcelPulse uses GitHub Actions, so the team should separate three kinds of workflows:

| Workflow type | Example | Secret access |
|---|---|---|
| **Untrusted validation** | Tests for pull requests from forks | No production secrets |
| **Trusted build** | Build and scan after merge to `main` | Read-only package or artifact secrets if needed |
| **Privileged deploy** | Deploy from `main` to `production` after approval | Production deployment role through OIDC |

GitHub already withholds most secrets from workflows triggered by forked repositories, with `GITHUB_TOKEN` as the special exception. That protection helps, but teams can still create dangerous workflows. GitHub's secure use guidance warns about `pull_request_target` and `workflow_run` when they check out or process untrusted pull request code in privileged contexts. ParcelPulse should keep those triggers away from production secrets unless the security team has reviewed the design.

The workflow should also limit the built-in `GITHUB_TOKEN`. GitHub Actions creates this token for workflow runs, and actions can access it through the `github.token` context. ParcelPulse should set explicit permissions instead of accepting broad defaults:

```yaml
permissions:
  contents: read
  packages: read
```

The deployment job can request only the extra permissions it needs:

```yaml
permissions:
  contents: read
  id-token: write
```

The `id-token: write` permission allows the workflow to request an OIDC token. Cloud access still comes from the provider trust rule, where the provider checks the token's claims and exchanges the token for a scoped cloud session. We will wire that up in the OIDC section.

GitHub Environments add another useful boundary. ParcelPulse can create a `production` environment, require reviewers, restrict deployment branches to `main`, and store any environment-specific variables or remaining secrets there. GitHub documents that environment secrets become available only to jobs that use the environment, and jobs can access those secrets only after configured protection rules pass.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v6
      - run: ./scripts/deploy.sh
```

Repository protection also includes scanning. GitHub secret scanning can detect hardcoded credentials in repository history and related surfaces such as issues and pull requests. Push protection can block many supported secret patterns before they enter the repository. These tools shorten the time between mistake and response, while rotation remains the control that makes a leaked value stop working.

The core practice is to keep privileged deployment access attached to trusted code paths. Pull requests run tests without production secrets. Merged code builds in a controlled workflow. Production deployment waits for environment rules. The final improvement replaces the static deployment key with OIDC federation.

## CI/CD OIDC Federation
<!-- section-summary: OIDC lets a CI/CD job exchange its signed workflow identity for a short-lived cloud session. -->

**OpenID Connect**, usually shortened to **OIDC**, is a standard way for one system to issue a signed identity token that another system can verify. In CI/CD, GitHub Actions can issue an OIDC token for a workflow job. The cloud provider checks that token, verifies claims such as repository, branch, workflow, and audience, then issues a short-lived cloud access token or role session.

**Federation** means one identity system trusts another identity system for a specific purpose. ParcelPulse leaves static AWS access keys out of GitHub. AWS trusts tokens from GitHub's OIDC issuer only when the token claims match the ParcelPulse repository and production deployment path. The trust rule replaces secret storage with a signed claim check.

Here is the flow in words:

1. The deployment job starts on `main` and references the `production` environment.
2. GitHub creates a signed OIDC token for that job when the job requests one.
3. The AWS IAM role trust policy checks the token issuer, audience, repository subject, and environment or branch claim.
4. AWS STS exchanges the token for temporary role credentials.
5. The workflow uses those credentials to push the image and update ECS.
6. The credentials expire after the job's session window.

The AWS side has two parts. First, the account has an OIDC provider for `https://token.actions.githubusercontent.com`. Second, the deployment role trusts that provider with conditions. This example trust policy limits access to one repository and the `production` environment subject format:

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
          "token.actions.githubusercontent.com:sub": "repo:parcelpulse/api:environment:production"
        }
      }
    }
  ]
}
```

AWS documentation recommends limiting the GitHub OIDC `sub` condition to specific organizations, repositories, or branches. It also warns that a trust policy without a narrow subject condition can allow workflows outside your control to assume the role. That warning is exactly why ParcelPulse ties the role to the repository and environment.

The role's permission policy grants deployment actions with narrow account reach. The exact actions vary by deployment design, and a simplified ECS deployment role may look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PushApiImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/parcelpulse-api"
    },
    {
      "Sid": "UpdateApiService",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService"
      ],
      "Resource": "arn:aws:ecs:us-east-1:123456789012:service/parcelpulse-prod/parcelpulse-api"
    },
    {
      "Sid": "PassOnlyApiTaskRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::123456789012:role/parcelpulse-api-task",
        "arn:aws:iam::123456789012:role/parcelpulse-api-execution"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    }
  ]
}
```

The `iam:PassRole` line deserves attention. Deployment systems often need to pass a task role or execution role to ECS, Lambda, or another service. A broad `iam:PassRole` permission can let a deployment job attach a more powerful role to a workload. ParcelPulse scopes it to the exact roles the API service may use and adds a condition for the ECS tasks service.

The GitHub Actions workflow then uses OIDC instead of static AWS keys:

```yaml
name: deploy-api

on:
  push:
    branches:
      - main

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v6

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-prod-deploy
          aws-region: us-east-1
          role-session-name: parcelpulse-prod-${{ github.run_id }}

      - name: Build and deploy
        run: ./scripts/build-and-deploy.sh
```

This pattern exists beyond AWS. GitHub documents OIDC setup for Azure through `azure/login`, and Microsoft Entra workload identity federation exchanges a GitHub token for an Azure access token after checking a trust relationship. GitHub also documents OIDC setup for Google Cloud, and Google Cloud Workload Identity Federation lets deployment pipelines authenticate without maintaining service account keys. The provider names differ, but the design stays consistent: CI job identity, trust conditions, short-lived token, scoped authorization.

Now we can compare the original static key pipeline with the OIDC pipeline side by side.

## Static Key Versus OIDC Session
<!-- section-summary: A static key lives until revocation, while an OIDC role session is issued for one trusted job and expires automatically. -->

ParcelPulse started with one static key because it made deployment work quickly. The key sat in repository secrets and the workflow exported it into the job environment. Every step in that job ran near a long-lived production credential. If the key leaked, the team had to revoke it, rotate any copies, inspect logs, and search every place the key might have traveled.

With OIDC, the workflow asks GitHub for a signed token during the deployment job. AWS checks the token claims and issues a role session for the deployment role. The workflow receives temporary credentials, uses them for the deployment, and then the session expires. GitHub's OIDC documentation describes the cloud provider issuing a short-lived access token that is valid for a single job and automatically expires.

Here is the comparison ParcelPulse should care about:

| Question | Static cloud key in pipeline | OIDC role session |
|---|---|---|
| **Where is the credential stored?** | GitHub secret value holding a long-lived access key | No long-lived cloud credential in GitHub |
| **Who can use it?** | Anyone or anything that obtains the key | Jobs whose OIDC claims satisfy the cloud trust policy |
| **How long does it work?** | Until manual deactivation or deletion | Until the role session expires |
| **How do you scope it?** | IAM policy on the key's user, plus careful secret placement | IAM role policy plus trust conditions for repo, branch, environment, and audience |
| **What happens after leak?** | Revoke key and find every copy | Let current session expire, tighten trust or revoke role access, inspect role session logs |
| **What does audit show?** | The same IAM user key across runs unless session naming adds context | Role session with workflow run details such as `role-session-name` |

OIDC still needs surrounding controls. If an attacker can modify trusted workflow code on `main`, approve deployments, or change the cloud trust policy, they may still obtain a valid deployment session. That is why OIDC must pair with branch protections, environment approvals, minimal `GITHUB_TOKEN` permissions, pinned or trusted actions, and scoped cloud policies.

The practical win is that OIDC removes a whole class of secret storage and rotation work. ParcelPulse removes `PROD_AWS_ACCESS_KEY_ID` and `PROD_AWS_SECRET_ACCESS_KEY` from GitHub. The static AWS deployment key disappears from the place where a third-party coverage action could read it. The cloud account issues a short-lived session only after the job proves it came from the expected repository and environment.

This gives the team a much cleaner incident story. A static key leak creates a hunt for every copy. An OIDC session leak still matters, but the time window is short, and the trust policy gives the team a central place to tighten who can obtain the next session.

## Leaked Secret Incident Response
<!-- section-summary: A leaked secret response revokes the credential first, then investigates usage, rotates dependents, and prevents the same path from leaking again. -->

A **leaked secret incident** starts when a sensitive value leaves its intended boundary. It might appear in a Git commit, CI log, container image layer, crash dump, support ticket, Slack message, or third-party system. The first response goal is containment. The team should make the leaked value stop working before spending too much time cleaning history.

ParcelPulse finds a production AWS access key in an old workflow log. The team should treat the key as compromised, even if the log was private. Private logs can move, people can download them, and dependencies can copy environment values during a build. The response should follow a simple order.

| Step | What ParcelPulse does | Why |
|---|---|---|
| **Identify** | Confirm the secret type, owner, scope, and environment | You need the right revocation path |
| **Contain** | Disable or revoke the credential | A dead secret cannot make new requests |
| **Rotate** | Replace any needed credential with a new value or OIDC path | Production keeps working safely |
| **Investigate** | Review cloud audit logs, CI logs, repository history, and access patterns | The team learns whether someone used it |
| **Eradicate** | Remove the secret from current code, images, variables, and docs | New leaks from the same copy stop |
| **Harden** | Add scanning, protections, and a design change | The same leak path closes |

For an AWS IAM user access key, containment can happen quickly:

```bash
aws iam update-access-key \
  --user-name parcelpulse-ci \
  --access-key-id AKIAEXAMPLEOLDKEY \
  --status Inactive
```

After the team confirms production no longer depends on it, deletion removes the key:

```bash
aws iam delete-access-key \
  --user-name parcelpulse-ci \
  --access-key-id AKIAEXAMPLEOLDKEY
```

CloudTrail helps investigation. The team can look for API calls made by the access key during the suspected exposure window:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIAEXAMPLEOLDKEY \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-06-21T23:59:59Z
```

This tells the team which API calls used that key, from which source IPs, and around which times. It does not prove safety by itself because logs can have limits, services vary in event detail, and an attacker may have made no calls yet. It gives evidence for the next decisions.

For a GitHub repository secret, the team can update the value through the UI or CLI after generating a replacement at the source system:

```bash
gh secret set COVERAGE_UPLOAD_TOKEN --repo parcelpulse/api
```

For a Secrets Manager value, the team can write a new version and restart affected workloads:

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/parcelpulse/api/postgres \
  --secret-string file://postgres-secret-rotated.json

aws ecs update-service \
  --cluster parcelpulse-prod \
  --service parcelpulse-api \
  --force-new-deployment
```

History cleanup needs care. Removing a secret from Git history can reduce accidental rediscovery, but revocation comes first. GitHub's secret scanning guidance also says that after a leak, the affected credential should be rotated immediately, and history removal can be time-intensive. ParcelPulse should remove the secret from current branches and open pull requests, then decide whether full history rewriting is worth the disruption after the secret is dead.

The final incident step is design change. If the leaked value was a static deployment key, the fix should be OIDC federation plus a removed IAM user key. If the leak came from a Docker build argument, the fix should be BuildKit secret mounts and a CI scan for suspicious `ARG` or `ENV` names. If a vendor token leaked through a third-party action, the fix may be job separation: run the vendor action in a job that has only the vendor token and no cloud credentials.

Good incident response should leave the system with fewer secrets, narrower scopes, and shorter sessions. A response that only rotates the static deployment key leaves the old design in place. The cleaner fix removes the static deployment key from the design.

## Putting It All Together
<!-- section-summary: A secure delivery system gives each caller a named identity, a narrow policy, a protected path, and a rotation or expiration plan. -->

ParcelPulse now has a better production delivery setup. People use SSO, MFA, groups, and temporary sessions. Mia can read logs without holding the production database password. Release managers approve deployments through a protected environment instead of sharing a cloud key.

Workloads use runtime identities. The API container has the `parcelpulse-api-prod` task role, which can read one database secret and write to one label bucket prefix. The application reads secrets from a secret manager and caches them carefully. The container image stays free of static cloud keys.

Pipelines use OIDC federation. The GitHub Actions deployment job requests an OIDC token, AWS verifies the repository and environment claims, and STS issues a short-lived deployment role session. The role can push one image and update one service. A coverage uploader never receives production cloud credentials because it runs in a separate job with only the vendor token it needs.

Secrets that remain have owners and rotation paths. Database credentials live in AWS Secrets Manager. Vendor tokens live in GitHub environment secrets or a central secret manager depending on who consumes them. The team records purpose, owner, environment, creation date, last rotation, and consumers. Secret scanning and push protection help catch mistakes before they spread.

If a secret leaks, the team follows a direct runbook: revoke first, rotate what production still needs, inspect audit logs, remove live copies, and harden the design. Static shared secrets turn that runbook into a wide search. Scoped sessions, workload identities, and OIDC make the same incident smaller and clearer.

Least privilege and secrets management belong together because permissions decide what a secret can do. A leaked read-only token for one coverage upload is a contained problem. A leaked long-lived cloud key that can deploy, read storage, and pass roles is a production incident. Secure delivery systems reduce both sides of the risk: fewer long-lived secrets, and much smaller permissions when credentials exist.

![CI/CD OIDC infographic showing a workflow job exchanging an OIDC token through a trust policy for a short-lived role session and production deploy](/content-assets/articles/article-devsecops-security-foundations-least-privilege/oidc-deployment-session.png)

*OIDC replaces stored cloud keys with a short-lived deployment session whose claims match the repository, branch, and production environment.*

---

**References**

- [NIST glossary: least privilege](https://csrc.nist.gov/glossary/term/least_privilege) - Defines least privilege as restricting users and processes to the minimum necessary access.
- [Codecov April 2021 post-mortem](https://about.codecov.io/apr-2021-post-mortem/) - Explains the Bash Uploader compromise, extracted environment variables, key-management lessons, and Docker layer issue.
- [GitHub Actions: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Explains how GitHub Actions uses OIDC tokens and short-lived cloud credentials.
- [GitHub Actions: configuring OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) - Shows the AWS OIDC workflow pattern without long-lived AWS secrets.
- [AWS IAM: create a role for OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - Documents GitHub OIDC trust policy conditions for repository, branch, and subject scoping.
- [AWS IAM: temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Explains AWS STS temporary credentials and expiration behavior.
- [GitHub Actions: using secrets in workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) - Documents workflow secret behavior, fork restrictions, and OIDC as an alternative for cloud credentials.
- [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - Covers workflow hardening and risks around privileged triggers with untrusted code.
- [GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) - Documents environment protection rules, deployment branch restrictions, and environment secrets.
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Describes detection, alerts, and remediation for leaked credentials.
- [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) - Describes blocking supported secrets before they enter a repository.
- [AWS Secrets Manager rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html) - Explains rotation as updating both the stored secret and the backing database or service.
- [AWS Secrets Manager: retrieve secrets](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets.html) - Covers retrieving secret values and CloudTrail logging for secret access.
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Explains assigning IAM roles to ECS tasks so application code can call AWS services.
- [Amazon ECS sensitive data guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - Covers Secrets Manager, Parameter Store, and sensitive data delivery to ECS containers.
- [IAM Access Analyzer policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html) - Documents generating fine-grained policies from CloudTrail access activity.
- [Docker build secrets](https://docs.docker.com/build/building/secrets/) - Documents BuildKit secret mounts for build-time sensitive values.
- [Docker build check: secrets in ARG or ENV](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/) - Explains why Dockerfile `ARG` and `ENV` are inappropriate for secrets.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) - Gives general guidance for centralized storage, provisioning, auditing, rotation, and management of secrets.
- [Microsoft Entra workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) - Describes exchanging external workload tokens such as GitHub Actions OIDC tokens for Microsoft identity platform access tokens.
- [Google Cloud Workload Identity Federation for deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) - Documents pipeline authentication to Google Cloud without maintaining service account keys.

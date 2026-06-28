---
title: "Least Privilege and Secrets"
description: "Learn how delivery teams limit access for people, services, and CI jobs while moving long-lived secrets into scoped, rotated, and short-lived paths."
overview: "Start with a simple delivery-locker key story, then follow ParcelPulse as it separates human access, workload identities, CI/CD OIDC sessions, secret storage, rotation, repository protections, verification, and leaked-secret response."
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

1. [A Simple Key Story](#a-simple-key-story)
2. [The ParcelPulse Delivery Path](#the-parcelpulse-delivery-path)
3. [Least Privilege Starts With One Job](#least-privilege-starts-with-one-job)
4. [Static Shared Secrets](#static-shared-secrets)
5. [Scope Human Access](#scope-human-access)
6. [Scope Workload Access](#scope-workload-access)
7. [Keep Secrets Out of Code and Builds](#keep-secrets-out-of-code-and-builds)
8. [Store Secrets in a Secret Manager](#store-secrets-in-a-secret-manager)
9. [Rotate Secrets With a Real Cutover Plan](#rotate-secrets-with-a-real-cutover-plan)
10. [Protect Repositories and Environments](#protect-repositories-and-environments)
11. [Use OIDC for CI/CD Cloud Access](#use-oidc-for-cicd-cloud-access)
12. [Verify Access and Secret Use](#verify-access-and-secret-use)
13. [Respond to a Leaked Secret](#respond-to-a-leaked-secret)
14. [Put It All Together](#put-it-all-together)
15. [References](#references)

## A Simple Key Story
<!-- section-summary: Least privilege is easiest to understand as a key that opens one needed locker, rather than every door in the building. -->

Imagine a delivery employee named Lena. Her job is simple: put one parcel into locker 42 at the front of an apartment building. The building manager has two choices. They can give Lena a master key for the lobby, mailroom, maintenance room, every apartment hallway, and every locker. Or they can give her a small access card that opens the front delivery area and locker 42 for the next ten minutes.

The second choice is the safer design. Lena can finish the delivery, and a lost access card has a small blast radius. Whoever finds it can open one locker for a short time. They cannot enter every part of the building or come back next month.

That is the beginner version of **least privilege**. An identity receives only the access it needs for one job, in the place where the job happens, for the time the job needs. For ParcelPulse, the delivery employee maps to a person, a running service, or a CI/CD job. The locker maps to one resource such as a log group, database secret, container registry repository, object-storage prefix, or production deployment environment.

Here is the same key story translated into delivery work:

| Simple story | DevSecOps version | ParcelPulse example |
|---|---|---|
| Lena has a named badge | The caller has an identity | Mia signs in through SSO, the API runs as `parcelpulse-api-prod`, the workflow runs as `github-actions-prod-deploy` |
| The badge opens one locker | The policy allows one job | Read API logs, read one database secret, push one image, update one service |
| The badge expires | The session has a short lifetime | SSO session, ECS task credentials, GitHub Actions OIDC role session |
| The badge has an access log | The platform records usage | CloudTrail, GitHub audit log, secret manager access events, deployment records |

Secrets enter this story when a key can be copied. A database password, API token, private key, and cloud access key are all values that unlock something. If the value lives in a repository, workflow log, Docker layer, shared spreadsheet, or laptop shell history, the team has to assume it can travel. Least privilege limits what the value can do, and good secret management limits where the value lives, who can read it, how long it works, and how quickly the team can rotate it.

The rest of this article keeps that one locker story attached to a real production path.

## The ParcelPulse Delivery Path
<!-- section-summary: One realistic ParcelPulse release gives every permission and secret a concrete caller, resource, and purpose. -->

ParcelPulse runs a delivery tracking product for small shops. Customers upload shipping labels, warehouse staff scan parcels, and shoppers check delivery status in a web app. The main service is `parcelpulse-api`, which stores label metadata in PostgreSQL, writes label PDFs to object storage, and deploys through GitHub Actions into an AWS ECS service.

The production path has several callers:

| Caller | Job | Access it needs |
|---|---|---|
| Mia, backend engineer | Investigate an API incident | Read production logs and service status |
| `parcelpulse-api-prod` ECS task | Run the API in production | Read one database secret and write label PDFs to one bucket prefix |
| `github-actions-prod-deploy` workflow | Deploy a reviewed release | Push one container image and update one ECS service |
| Coverage uploader job | Send test coverage to a vendor | Use one vendor upload token |
| Release manager | Approve the production deployment | Approve the GitHub `production` environment |

Those callers should never share one credential. Mia reading logs, the API fetching a database password, and a workflow updating ECS are different jobs. A shared cloud key for all of them would look convenient on the first day and painful during the first leak.

We will build the access model in layers:

| Layer | Production question | Control |
|---|---|---|
| People | Which named humans can inspect or approve production work? | SSO, groups, MFA, temporary sessions, environment reviewers |
| Workloads | Which running services can call cloud APIs? | Runtime identities such as ECS task roles, managed identities, or service accounts |
| Pipelines | Which CI jobs can publish and deploy? | GitHub Environments, branch rules, OIDC federation, scoped cloud roles |
| Secrets | Where do sensitive values live and how do they rotate? | Secret manager, naming, tags, audit logs, rotation runbooks |
| Verification | How do we prove the access is narrow and used as expected? | Policy review, CLI checks, audit logs, access reviews, incident records |

This order gives us a clean path. First we define least privilege, then we look at the shared-secret shortcut that many teams start with. After that, we replace the shortcut with separate access paths for people, workloads, pipelines, and the few secrets that still need to exist.

## Least Privilege Starts With One Job
<!-- section-summary: Least privilege means the policy names the caller, action, resource, and context for one specific job. -->

**Least privilege** means an identity gets only the actions it needs for one job. NIST defines least privilege around restricting users and processes to the minimum access needed to perform authorized work. In plain delivery terms, a caller should have enough access to finish the task in front of it, with no extra access to unrelated data, systems, or administrative controls.

For ParcelPulse, the deployment job can push one image and update one service. It should not read customer label PDFs, change billing permissions, create IAM users, or fetch the production database password. The API can read its own database secret and write label PDFs. It should not update the ECS service that runs it. Mia can read production logs. She should not carry a shared production access key in her laptop profile.

A useful least-privilege review asks four questions:

| Question | What the team writes down | ParcelPulse example |
|---|---|---|
| **Who is calling?** | The principal or identity | `github-actions-prod-deploy` |
| **What action is needed?** | The API operations | `ecr:PutImage`, `ecs:UpdateService` |
| **Which resource is allowed?** | The resource boundary | One ECR repository and one ECS service |
| **What context must be true?** | Conditions around branch, environment, time, MFA, or repository claim | GitHub `production` environment from `parcelpulse/api` |

Teams often say "the pipeline needs AWS access" during early setup. That phrase hides all four questions. A better first policy sentence is: "The GitHub Actions deployment job for `parcelpulse/api` may push the `parcelpulse-api` image and update the `parcelpulse-api` service after the `production` environment approval." That sentence gives the policy author the caller, action, resource, and context.

Here is the smallest useful access worksheet for ParcelPulse:

| Caller | Needed actions | Resource scope | Time scope | Owner |
|---|---|---|---|---|
| `github-actions-prod-deploy` | Push image, update ECS service | `parcelpulse-api` ECR repo and `parcelpulse-prod/parcelpulse-api` ECS service | One workflow job | Platform team |
| `parcelpulse-api-prod` | Read DB secret, write labels | One Secrets Manager secret and `parcelpulse-labels-prod/labels/*` | ECS task session | API team |
| `release-managers` | Approve production deployment | GitHub `production` environment | Human approval session | Engineering manager |
| `coverage-uploader` | Upload coverage report | Vendor coverage project token | One CI job | Developer experience team |

This worksheet is practical. It gives the reviewer a place to ask whether the coverage uploader needs a cloud key. It does not. The uploader sends a report to a vendor, so it receives only the vendor token in the job that sends coverage.

Real teams rarely create perfect policies on the first try. A normal production path is to start with a narrow design, test it in a lower environment, inspect actual API calls, and reduce or adjust the policy. On AWS, CloudTrail records many API calls, and IAM Access Analyzer can generate a policy from recent access activity. The generated policy still needs human review, but it gives the team evidence from real usage.

Now we can look at the shortcut ParcelPulse wants to retire: one static shared key in the deployment pipeline.

## Static Shared Secrets
<!-- section-summary: Static shared secrets are copied credentials that keep working until the team revokes or rotates them. -->

A **static secret** is a sensitive value that stays valid across runs until someone changes or revokes it. A cloud access key, database password, personal access token, SSH private key, webhook signing secret, and vendor API token can all be static secrets. A **shared secret** is a value used by more than one person, job, service, or machine.

ParcelPulse starts with a common early setup. The team creates an IAM user called `parcelpulse-ci`, creates an access key, stores the key in GitHub repository secrets, and lets the deployment job export the key into the runner environment:

```yaml
name: deploy-api

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-24.04
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.PROD_AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.PROD_AWS_SECRET_ACCESS_KEY }}
      AWS_REGION: us-east-1
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/build-and-deploy.sh
```

The YAML is easy to understand. The workflow runs after a push to `main`, the job receives two repository secrets as environment variables, and the deploy script can call AWS. The same simplicity creates the risk. Every step in that job runs near a long-lived production cloud credential. Dependency install scripts, test tools, coverage uploaders, build scripts, and third-party actions all share the same runner environment unless the workflow separates them.

The 2021 Codecov Bash Uploader incident is a useful warning. Codecov's post-mortem says an attacker extracted a Google Cloud Storage service account HMAC key from a public Docker image layer, modified the Bash Uploader, and the malicious uploader collected environment variables from customer CI environments. The lesson maps directly to ParcelPulse: CI jobs often hold powerful secrets, and build tools run close to those secrets.

![Static key versus scoped sessions infographic comparing one long-lived CI secret with separate people, workload, and pipeline sessions](/content-assets/articles/article-devsecops-security-foundations-least-privilege/static-key-vs-scoped-sessions.png)

*One shared key spreads risk across many jobs, while separate scoped sessions keep people, workloads, and pipelines on their own access paths.*

After a shared key leaks, the team has to answer several hard questions. Which workflows had the key? Which actions ran beside it? Did any forked pull request touch a privileged path? Did the value land in a Docker layer, debug log, cache, or artifact? Did someone reuse the key in another repository?

The clean design moves away from the master-key pattern. People use named human access. Workloads use runtime identities. Pipelines use short-lived deployment sessions. Secret values that still exist live in a secret manager with owners, rotation, and audit records.

## Scope Human Access
<!-- section-summary: Human access should flow through named accounts, groups, MFA, and expiring sessions. -->

**Human access** means access used by real people: developers, operators, release managers, auditors, and support engineers. People need to sign in, investigate issues, approve changes, and sometimes perform emergency actions. Production access should point back to named workforce identities so the team can answer who did what.

ParcelPulse uses a company identity provider such as Okta, Microsoft Entra ID, Google Workspace, or another SSO source. Engineers sign in with MFA, and cloud access comes from groups. Mia belongs to `parcelpulse-developers`, which can read production API logs and ECS service status. Release managers belong to `parcelpulse-release-managers`, which can approve GitHub `production` deployments. A small on-call group can request break-glass access during incidents.

The practical pattern has three layers:

| Layer | What it controls | ParcelPulse choice |
|---|---|---|
| **Identity** | Who the person is | SSO account with MFA |
| **Group** | What job the person has | Developer, release manager, on-call |
| **Session** | How long access lasts | CLI or console session with expiration |

For AWS, this usually means IAM Identity Center or another federation path into AWS roles. For Azure, it means Entra ID groups and Azure RBAC assignments. For Google Cloud, it means IAM bindings for groups from Cloud Identity or Google Workspace. The product names differ, and the shape stays familiar: people authenticate to the company directory, receive temporary access, and leave long-lived personal cloud keys out of daily work.

Mia's read-only production role can start small:

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

The `logs:*` actions give Mia read access to one API log group. The ECS actions let her inspect service and task state. Some AWS read APIs require broader resource patterns for list and describe calls, so the team keeps the action list read-only and adds account-level guardrails where the service supports them.

Mia signs in through SSO and checks her session identity before reading logs:

```bash
aws sso login --profile parcelpulse-prod-readonly

aws sts get-caller-identity \
  --profile parcelpulse-prod-readonly
```

`aws sso login` opens the SSO login flow for the named CLI profile. `aws sts get-caller-identity` prints the account and assumed-role identity that the AWS CLI is using. The `--profile` flag keeps this check attached to Mia's read-only production profile.

Example output:

```json
{
  "UserId": "AROAXAMPLEID:maya.chen",
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/parcelpulse-prod-readonly/maya.chen"
}
```

Now Mia can query the logs:

```bash
aws logs filter-log-events \
  --profile parcelpulse-prod-readonly \
  --log-group-name /ecs/parcelpulse-api-prod \
  --filter-pattern "ERROR" \
  --max-items 3
```

`--log-group-name` selects the API log group. `--filter-pattern "ERROR"` narrows the output to error events. `--max-items 3` keeps the terminal output small during an investigation.

Example output, shortened:

```json
{
  "events": [
    {
      "logStreamName": "ecs/parcelpulse-api/4d2a",
      "timestamp": 1782190903120,
      "message": "ERROR failed to write label pdf: AccessDenied"
    }
  ]
}
```

This gives ParcelPulse named human access, session expiration, and audit records. If Mia changes teams, removing her from the group stops new sessions. The team avoids a search through repositories for a copied production key.

Human access is cleaner now. The production API still needs machine access while it runs, so we move to workload identity.

## Scope Workload Access
<!-- section-summary: Workloads should receive runtime identities with policies that match the service's job. -->

A **workload** is running software that needs to call another system. An API container, batch job, Kubernetes pod, VM, serverless function, and database migration job are workloads. A **workload identity** gives that software its own identity at runtime, so application code can call cloud APIs without a static cloud key in the repository or container image.

ParcelPulse runs `parcelpulse-api` as an ECS service. The API has two production cloud jobs. It reads the PostgreSQL credential from AWS Secrets Manager, and it writes label PDFs into one S3 bucket prefix. It does not administer IAM, read billing data, delete every object in the bucket, or update the ECS service that runs it.

In ECS, the API uses a **task role** named `parcelpulse-api-prod`. The task role grants permissions to the application code inside the container. ECS also has a **task execution role**, which ECS uses for platform work such as pulling images and fetching configured secrets at startup. Keeping those roles separate helps the application receive only the permissions it needs while running.

Here is the first workload policy:

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

`ReadDatabaseSecret` grants one action for one secret name pattern. `WriteShippingLabels` grants object access only under `labels/*` in the production labels bucket. The policy avoids bucket administration and account-wide secret reads.

Behind the scenes, AWS provides temporary credentials to the ECS task through the container credential endpoint. The AWS SDK can use those credentials automatically. The image stays free of `AWS_ACCESS_KEY_ID`, and the task session expires when the platform refreshes or stops it.

The same design appears in other platforms. An EC2 instance can use an instance profile. A Lambda function uses an execution role. Azure workloads can use managed identities. Google Cloud workloads can use attached service accounts. Kubernetes clusters can connect pod service accounts to cloud identities through systems such as IAM Roles for Service Accounts on EKS, Microsoft Entra Workload ID on AKS, or Workload Identity Federation on GKE.

The next question is where the API gets values such as the database password and webhook signing secret. Runtime identity handles cloud authorization. Secret management handles sensitive values that still exist.

## Keep Secrets Out of Code and Builds
<!-- section-summary: Secrets should stay out of repositories, image layers, generic build environments, and logs. -->

A **secret** is any value that grants access or proves identity. Database passwords, API tokens, private keys, OAuth client secrets, signing keys, webhook secrets, and cloud access keys all count. The safest secret is the one the team can avoid creating. When a secret has to exist, the team should expose it only to the caller that needs it.

ParcelPulse has several secret types. The API uses a PostgreSQL password. The coverage uploader uses a vendor upload token. The app signs webhook payloads. The deployment workflow uses OIDC for cloud access and therefore removes the static AWS deployment key from GitHub.

The first practical habit is a harmless example file:

```bash
# .env.example
DATABASE_URL=postgres://app_user:example-password@localhost:5432/parcelpulse
COVERAGE_UPLOAD_TOKEN=example-token
WEBHOOK_SIGNING_SECRET=example-secret
```

The matching ignore rules keep local real values out of Git:

```bash
# .gitignore
.env
.env.*
!.env.example
*.pem
*.key
service-account*.json
```

The `.env.example` file teaches developers which variables exist. The `.gitignore` rules keep local environment files, private keys, and downloaded service-account files outside normal commits. Secret scanning and push protection give another layer, but the repository should still make the safe path obvious.

Builds need the same care. Docker's guidance warns against using `ARG` or `ENV` for secrets because those values can persist in image metadata or build history. If ParcelPulse needs a private package token during build, Docker BuildKit secret mounts can provide the token only to the build instruction that needs it.

Here is a small Dockerfile skeleton:

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

The `--mount=type=secret` option gives this one `RUN` instruction access to `NPM_TOKEN`. The token stays out of the Dockerfile and out of a permanent `ENV` line. The command also removes the temporary npm config entry before the layer finishes.

The GitHub Actions build step passes the token into BuildKit:

```yaml
- name: Build image
  uses: docker/build-push-action@v6
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
  with:
    context: .
    push: false
    tags: parcelpulse-api:test
    secret-envs: |
      npm_token=NPM_TOKEN
```

`secret-envs` maps the workflow environment variable `NPM_TOKEN` to the BuildKit secret id `npm_token`. The token should read only the package scope needed by the build. It should have no package publishing rights, no organization administration rights, and no access to unrelated private packages.

The third habit treats logs as a leak surface. ParcelPulse keeps environment dumps out of CI logs, avoids shell tracing around secret-handling commands, and separates jobs that run untrusted code from jobs that receive production credentials. At this point, secrets stay out of code and image layers. They still need a controlled home.

## Store Secrets in a Secret Manager
<!-- section-summary: A secret manager centralizes storage, identity-based access, audit logs, and rotation metadata. -->

A **secret manager** is a service for storing, retrieving, auditing, and rotating sensitive values. Examples include AWS Secrets Manager, Azure Key Vault, Google Secret Manager, HashiCorp Vault, Doppler, 1Password Secrets Automation, and CyberArk Conjur. The product choice depends on the environment. The job is steady: keep secrets out of random files and put access behind identity, policy, logs, and lifecycle controls.

ParcelPulse stores the production database credential in AWS Secrets Manager under the name `prod/parcelpulse/api/postgres`. The secret value is JSON so the app can read the username, password, host, port, and database name together:

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

The team creates the secret during infrastructure setup:

```bash
aws secretsmanager create-secret \
  --name prod/parcelpulse/api/postgres \
  --description "Production database login for the ParcelPulse API" \
  --secret-string file://postgres-secret.json \
  --tags Key=service,Value=parcelpulse-api Key=environment,Value=prod Key=owner,Value=api-team
```

`--name` sets the stable lookup path. `--secret-string file://postgres-secret.json` reads the JSON value from a local file so the full value stays out of the terminal command line. `--tags` records owner, service, and environment metadata for inventory and incident response.

Example output:

```json
{
  "ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/parcelpulse/api/postgres-a1b2c3",
  "Name": "prod/parcelpulse/api/postgres",
  "VersionId": "4d91b36f-9f2a-48ef-9b62-2c7718e0e51e"
}
```

The API reads the secret at startup through the AWS SDK:

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

The app code names one secret. The ECS task role decides whether the app may read it. AWS also recommends client-side caching for Secrets Manager values, because caching improves speed and reduces cost for applications that would otherwise call the service on every request.

Secret names need structure. ParcelPulse uses this pattern:

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

The naming pattern helps reviewers spot mistakes. A production workload reads production secrets. A frontend service avoids the API database credential. A coverage uploader token stays separate from cloud deployment credentials. Tags such as `owner`, `environment`, `rotation`, and `service` make inventory and incident response faster.

The team can inspect metadata without printing the secret value:

```bash
aws secretsmanager describe-secret \
  --secret-id prod/parcelpulse/api/postgres
```

`describe-secret` returns metadata such as ARN, tags, rotation settings, creation date, and last-changed date. It does not print the secret value.

Example output, shortened:

```json
{
  "Name": "prod/parcelpulse/api/postgres",
  "RotationEnabled": true,
  "LastChangedDate": "2026-06-15T08:12:44+00:00",
  "Tags": [
    { "Key": "service", "Value": "parcelpulse-api" },
    { "Key": "environment", "Value": "prod" },
    { "Key": "owner", "Value": "api-team" }
  ]
}
```

![Secret manager rotation loop infographic showing store, grant, read, rotate, restart, revoke old, and audit around a central vault](/content-assets/articles/article-devsecops-security-foundations-least-privilege/secret-rotation-loop.png)

*A secret manager gives the team one controlled place to store, grant, rotate, revoke, and audit sensitive values.*

The secret manager gives ParcelPulse one control point. The next job is rotation, where the stored value and the system that trusts it both change in the right order.

## Rotate Secrets With a Real Cutover Plan
<!-- section-summary: Rotation changes the secret value, updates the system that trusts it, moves consumers, and removes the old value. -->

**Rotation** means replacing an old secret value with a new value. Real rotation has two sides. The secret manager stores the new value, and the backing system accepts the new value. For a database password, PostgreSQL has to accept the new password and Secrets Manager has to store the same new password. For a vendor token, the vendor platform has to issue or accept the replacement token and the consuming job has to use it.

ParcelPulse uses a staged plan:

| Stage | What happens | Evidence to keep |
|---|---|---|
| **Prepare** | Confirm owner, consumers, dashboards, and rollback path | Rotation ticket and consumer list |
| **Create new value** | Generate a new password or token | Secret manager version or vendor token ID |
| **Update authority** | Change the database password or vendor token | Database audit event or vendor admin event |
| **Update secret manager** | Store the new value under the same secret name | Secret version ID |
| **Refresh consumers** | Restart ECS tasks or reload secret cache | Deployment or restart record |
| **Revoke old value** | Disable the old password or token | Revocation event |
| **Verify** | Check logs, metrics, and authentication failures | Query output and incident notes |

For an AWS-managed database secret with rotation configured, the rotation request can look like this:

```bash
aws secretsmanager rotate-secret \
  --secret-id prod/parcelpulse/api/postgres \
  --rotation-rules AutomaticallyAfterDays=30
```

`--secret-id` selects the database secret. `--rotation-rules AutomaticallyAfterDays=30` records the desired automatic rotation interval. The secret still needs a valid rotation setup for the target database, such as a configured rotation function or managed rotation path.

Example output:

```json
{
  "ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/parcelpulse/api/postgres-a1b2c3",
  "Name": "prod/parcelpulse/api/postgres",
  "VersionId": "77be9a0f-9449-4725-9f75-bb8f6c7f7c61"
}
```

For a manual emergency rotation, the team may update the database password first, write a new secret version, and restart the service:

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/parcelpulse/api/postgres \
  --secret-string file://postgres-secret-rotated.json

aws ecs update-service \
  --cluster parcelpulse-prod \
  --service parcelpulse-api \
  --force-new-deployment
```

`put-secret-value` writes a new version under the same secret name. `update-service --force-new-deployment` starts fresh ECS tasks even when the task definition did not change, so the new tasks read the current secret at startup.

Example output from the ECS update, shortened:

```json
{
  "service": {
    "serviceName": "parcelpulse-api",
    "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/parcelpulse-prod",
    "deployments": [
      {
        "status": "PRIMARY",
        "rolloutState": "IN_PROGRESS"
      }
    ]
  }
}
```

Rotation frequency should match risk and operational reality. A production database credential may rotate automatically every 30 or 60 days. A vendor token with weak audit logs may rotate more often. A dual-key system can rotate smoothly by creating key B, moving consumers to B, then revoking key A. A single-active-secret system needs a planned restart or a design that can reload secrets quickly.

Rotation also needs inventory. Each production secret should have owner, purpose, environment, creation date, last rotation date, consumers, and emergency contact. A secret with no owner will slow down every future incident.

Secrets now have a home and a lifecycle. The next risk sits around the repository and CI/CD environment, where code, workflow files, approvals, tokens, and deployment authority meet.

## Protect Repositories and Environments
<!-- section-summary: Repository and environment protections keep privileged jobs attached to trusted branches, reviewed workflows, and approved deployments. -->

A CI/CD platform runs code with access to source, build artifacts, tokens, and deployment permissions. That makes the repository a security boundary. If someone can change the deployment workflow, they can change the path to production. If untrusted pull request code runs in a privileged job, it can become a secret exfiltration path.

ParcelPulse separates three workflow types:

| Workflow type | Example | Secret access |
|---|---|---|
| **Untrusted validation** | Tests for pull requests from forks | No production secrets |
| **Trusted build** | Build and scan after merge to `main` | Narrow package or registry permissions |
| **Privileged deploy** | Deploy from `main` to `production` after approval | Production deployment role through OIDC |

GitHub withholds most secrets from workflows triggered by forked repositories, with the special `GITHUB_TOKEN` behavior documented by GitHub. That helps, and workflow design still matters. GitHub's secure-use guidance calls out risks with privileged triggers such as `pull_request_target` and `workflow_run` when they process untrusted pull request code. ParcelPulse routes production deployment through a trusted branch and protected environment.

The workflow sets explicit `GITHUB_TOKEN` permissions:

```yaml
permissions:
  contents: read
  packages: read
```

The deployment job requests only the extra permission needed to obtain an OIDC token:

```yaml
permissions:
  contents: read
  id-token: write
```

`contents: read` lets the workflow read repository content. `id-token: write` lets the job request a GitHub OIDC token. Cloud access still depends on the AWS trust policy, which checks the token claims before issuing a role session.

GitHub Environments add the production approval boundary:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh
```

The `environment: production` line attaches the job to GitHub's `production` environment. Environment protection rules can require reviewers, wait timers, deployment branch restrictions, and environment secrets. ParcelPulse uses it to keep production deployment behind review and branch rules.

Repository protection also includes secret scanning and push protection. Secret scanning detects supported credentials in repository content and related surfaces. Push protection can block many supported secrets before they enter the repository. These tools shorten the time between mistake and response, while rotation remains the control that makes a leaked value stop working.

The final improvement removes the long-lived deployment key by using OIDC federation.

## Use OIDC for CI/CD Cloud Access
<!-- section-summary: OIDC lets a trusted workflow exchange signed job identity for a short-lived cloud role session. -->

**OpenID Connect**, usually shortened to **OIDC**, is a standard way for one system to issue a signed identity token that another system can verify. In CI/CD, GitHub Actions can issue an OIDC token for a workflow job. AWS, Azure, Google Cloud, and other providers can verify that token and issue a short-lived cloud session when the token claims match a trust rule.

**Federation** means one identity system trusts another for a specific purpose. ParcelPulse leaves static AWS access keys out of GitHub. AWS trusts tokens from GitHub's OIDC issuer only when the claims match the ParcelPulse repository and production deployment environment.

The flow is:

1. The deployment job starts from `main` and references the `production` environment.
2. GitHub creates a signed OIDC token for that job when the job requests one.
3. AWS IAM checks the token issuer, audience, repository subject, and environment subject.
4. AWS STS exchanges the token for temporary role credentials.
5. The workflow uses the credentials to push the image and update ECS.
6. The role session expires after the configured session window.

The AWS role trust policy is the first important file:

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

`Principal.Federated` names GitHub's OIDC provider in the AWS account. `Action` allows web-identity role assumption. The `aud` condition expects AWS STS as the audience. The `sub` condition ties this role to the `parcelpulse/api` repository and the `production` environment subject. AWS and GitHub both document the importance of narrow subject conditions for GitHub OIDC roles.

The role permission policy grants the deployment actions:

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

`iam:PassRole` deserves special review. Deployment systems often pass task roles, execution roles, or service roles to cloud services. Broad pass-role access can let a deployment job attach a more powerful role to a workload. ParcelPulse scopes it to the exact ECS roles the API may use and adds a condition for the ECS tasks service.

The GitHub Actions workflow then asks for the AWS role:

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
    runs-on: ubuntu-24.04
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-prod-deploy
          aws-region: us-east-1
          role-session-name: parcelpulse-prod-${{ github.run_id }}

      - name: Build and deploy
        run: ./scripts/build-and-deploy.sh
```

`role-to-assume` names the deployment role. `aws-region` configures the AWS SDK and CLI. `role-session-name` places the GitHub run ID into the AWS session name, which helps CloudTrail searches later.

This same pattern works outside AWS. Microsoft Entra workload identity federation can exchange GitHub tokens for Microsoft identity platform access tokens. Google Cloud Workload Identity Federation can let deployment pipelines authenticate without downloaded service-account keys. The provider fields differ, but the pattern is the same: job identity, trust condition, short-lived token, scoped authorization.

![CI/CD OIDC infographic showing a workflow job exchanging an OIDC token through a trust policy for a short-lived role session and production deploy](/content-assets/articles/article-devsecops-security-foundations-least-privilege/oidc-deployment-session.png)

*OIDC replaces stored cloud keys with a short-lived deployment session whose claims match the repository, branch, and production environment.*

Now ParcelPulse has scoped people, workloads, pipelines, and secrets. The next question is verification: how does the team prove the setup is working as designed?

## Verify Access and Secret Use
<!-- section-summary: Verification checks the effective identity, policy boundary, secret metadata, and audit trail before a leak forces the issue. -->

Verification turns access design into evidence. ParcelPulse does not need a giant audit project to start. It needs a few repeatable checks that answer the same questions every release or access review: who can call production, which role did the workflow assume, which secret did the workload read, and did any old static key still show activity?

The deployment workflow can print its AWS identity after OIDC configuration:

```bash
aws sts get-caller-identity
```

This command returns the AWS account and role session currently used by the job. It should show the `github-actions-prod-deploy` role and a session name containing the GitHub run ID.

Example output:

```json
{
  "UserId": "AROAXAMPLEID:parcelpulse-prod-8842119021",
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/github-actions-prod-deploy/parcelpulse-prod-8842119021"
}
```

CloudTrail can show role usage for the deployment window:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=parcelpulse-prod-8842119021 \
  --start-time 2026-06-21T00:00:00Z \
  --end-time 2026-06-21T23:59:59Z
```

`--lookup-attributes` filters the search to the session username. `--start-time` and `--end-time` set the investigation window. The output helps the team confirm the session performed expected deployment actions.

Example output, shortened:

```json
{
  "Events": [
    {
      "EventName": "PutImage",
      "Username": "parcelpulse-prod-8842119021",
      "EventTime": "2026-06-21T19:04:10+00:00"
    },
    {
      "EventName": "UpdateService",
      "Username": "parcelpulse-prod-8842119021",
      "EventTime": "2026-06-21T19:06:02+00:00"
    }
  ]
}
```

The secret inventory check looks for owner tags and rotation status:

```bash
aws secretsmanager describe-secret \
  --secret-id prod/parcelpulse/api/postgres \
  --query '{Name:Name,RotationEnabled:RotationEnabled,LastRotatedDate:LastRotatedDate,Tags:Tags}'
```

`--query` shapes the output so the reviewer sees only the fields needed for the access review: name, rotation status, last rotation date, and tags.

Example output:

```json
{
  "Name": "prod/parcelpulse/api/postgres",
  "RotationEnabled": true,
  "LastRotatedDate": "2026-06-15T08:12:44+00:00",
  "Tags": [
    { "Key": "owner", "Value": "api-team" },
    { "Key": "environment", "Value": "prod" }
  ]
}
```

Access Analyzer can help reduce policies after normal use:

```bash
aws accessanalyzer start-policy-generation \
  --policy-generation-details principalArn=arn:aws:iam::123456789012:role/github-actions-prod-deploy
```

`start-policy-generation` asks IAM Access Analyzer to build a suggested policy from CloudTrail activity for the named principal. The generated result is a starting point for review, and the team still checks whether the role needs every suggested action.

Example output:

```json
{
  "jobId": "b12f7f3a-3d8a-4f2d-a5da-2e7c4c4a6f41"
}
```

These checks keep the access design honest. They also give the team better data when a secret leak happens.

## Respond to a Leaked Secret
<!-- section-summary: A leaked-secret response revokes the value first, then rotates, investigates, removes live copies, and hardens the design. -->

A **leaked secret incident** starts when a sensitive value leaves its intended boundary. It might appear in a Git commit, CI log, container image layer, crash dump, support ticket, chat message, or third-party system. The first response goal is containment: make the value stop working.

ParcelPulse finds an old AWS access key in a workflow log. The team treats the key as compromised, even though the log was private. Private logs can be downloaded, shared, cached, or copied by tools. The response follows a direct order:

| Step | What ParcelPulse does | Evidence to keep |
|---|---|---|
| **Identify** | Confirm secret type, owner, scope, and environment | Incident ticket and secret inventory row |
| **Contain** | Disable or revoke the credential | Cloud or vendor revocation event |
| **Rotate** | Replace needed access with a new value or OIDC path | Rotation record |
| **Investigate** | Review cloud audit logs, CI logs, repository history, and artifacts | Query results and timeline |
| **Remove live copies** | Clean current branches, variables, images, docs, and tickets | Pull request or cleanup record |
| **Harden** | Add scanning, protections, or a design change | Follow-up ticket and owner |

For an AWS IAM user access key, containment can happen quickly:

```bash
aws iam update-access-key \
  --user-name parcelpulse-ci \
  --access-key-id AKIAEXAMPLEOLDKEY \
  --status Inactive
```

`--user-name` selects the IAM user that owns the key. `--access-key-id` names the leaked key. `--status Inactive` disables the key so it cannot make new AWS API requests. The command returns no output on success.

After the team confirms production no longer depends on the key, deletion removes it:

```bash
aws iam delete-access-key \
  --user-name parcelpulse-ci \
  --access-key-id AKIAEXAMPLEOLDKEY
```

This command also returns no output on success. The team keeps the CloudTrail event, incident ticket, or terminal transcript as evidence.

CloudTrail helps investigation:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIAEXAMPLEOLDKEY \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-06-21T23:59:59Z
```

`AttributeKey=AccessKeyId` searches for events made with the specific key. The time window should cover the suspected exposure period.

Example output, shortened:

```json
{
  "Events": [
    {
      "EventName": "UpdateService",
      "EventTime": "2026-06-18T17:12:03+00:00",
      "Username": "parcelpulse-ci"
    }
  ]
}
```

For a Secrets Manager value, the team writes a new version and restarts affected workloads:

```bash
aws secretsmanager put-secret-value \
  --secret-id prod/parcelpulse/api/postgres \
  --secret-string file://postgres-secret-rotated.json

aws ecs update-service \
  --cluster parcelpulse-prod \
  --service parcelpulse-api \
  --force-new-deployment
```

The first command creates a new version of the secret. The second starts fresh tasks so the API reads the replacement value. The team should watch database login failures, API error rates, and ECS rollout status during the change.

History cleanup needs care. GitHub's secret scanning guidance tells teams to rotate or revoke leaked credentials immediately. Removing a secret from Git history can reduce accidental rediscovery, and it can also disrupt forks, open branches, and commit references. ParcelPulse revokes first, cleans current branches and open pull requests, then decides whether deeper history rewriting is worth the coordination cost.

The final incident step is design change. If the leaked value was a static deployment key, the fix is OIDC federation and a removed IAM user key. If the leak came from a Docker build argument, the fix is BuildKit secret mounts plus a review for suspicious `ARG` or `ENV` names. If a vendor token leaked through a third-party action, the fix may be job separation so that action receives only the vendor token.

## Put It All Together
<!-- section-summary: A secure delivery system gives every caller a named identity, narrow permissions, a protected path, and either rotation or expiration. -->

ParcelPulse now has a tighter delivery setup. People use SSO, MFA, groups, and temporary sessions. Mia can read production logs without holding the production database password. Release managers approve deployments through a protected GitHub environment.

Workloads use runtime identities. The `parcelpulse-api-prod` task role can read one database secret and write to one label bucket prefix. The application reads secrets from a secret manager and caches them carefully. The container image stays free of static cloud keys.

Pipelines use OIDC federation. The GitHub Actions deployment job requests an OIDC token, AWS verifies the repository and environment claims, and STS issues a short-lived deployment role session. The role can push one image and update one service. The coverage uploader runs in its own job with only the vendor token it needs.

Secrets that remain have owners and rotation paths. Database credentials live in AWS Secrets Manager. Vendor tokens live in GitHub environment secrets or a central secret manager depending on who consumes them. The team records purpose, owner, environment, creation date, last rotation, and consumers.

If a secret leaks, the runbook is clear: revoke first, rotate what production still needs, inspect audit logs, remove live copies, and harden the design. Static shared secrets turn that response into a wide search. Scoped sessions, workload identities, and OIDC make the same incident smaller and easier to reason through.

Least privilege and secrets management belong together. Permissions decide what a credential can do. Secret management decides where the credential lives, who can retrieve it, when it rotates, and how the team responds after exposure. The delivery-locker story still applies: one key, one job, one bounded place, one short access window, and a record of use.

---

## References

- [NIST glossary: least privilege](https://csrc.nist.gov/glossary/term/least_privilege) - Defines least privilege as restricting users and processes to the minimum necessary access.
- [NIST Secure Software Development Framework, SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - Official NIST SSDF publication for secure software development practices.
- [Codecov April 2021 post-mortem](https://about.codecov.io/apr-2021-post-mortem/) - Explains the Bash Uploader compromise, extracted environment variables, and Docker layer key-management issue.
- [GitHub Actions: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Explains GitHub Actions OIDC tokens and short-lived cloud credentials.
- [GitHub Actions: configuring OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) - Shows the AWS OIDC workflow pattern without long-lived AWS secrets.
- [AWS IAM: create a role for OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - Documents OIDC trust policies and condition keys for federated roles.
- [AWS IAM: temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Explains AWS STS temporary credentials and expiration behavior.
- [GitHub Actions: using secrets in workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) - Documents workflow secret behavior, fork restrictions, and OIDC as an alternative for cloud credentials.
- [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - Covers workflow hardening and privileged-trigger risks with untrusted code.
- [GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) - Documents environment protection rules, deployment branch restrictions, and environment secrets.
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Describes detection, alerts, and remediation for leaked credentials.
- [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) - Describes blocking supported secrets before they enter a repository.
- [AWS Secrets Manager rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html) - Explains rotation for stored secrets and backing services.
- [AWS Secrets Manager: retrieve secrets](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets.html) - Covers retrieving secret values and CloudTrail logging for secret access.
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Explains assigning IAM roles to ECS tasks so application code can call AWS services.
- [Amazon ECS sensitive data guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - Covers Secrets Manager, Parameter Store, and sensitive data delivery to ECS containers.
- [IAM Access Analyzer policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html) - Documents generating fine-grained policies from CloudTrail access activity.
- [Docker build secrets](https://docs.docker.com/build/building/secrets/) - Documents BuildKit secret mounts for build-time sensitive values.
- [Docker build check: secrets in ARG or ENV](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/) - Explains why Dockerfile `ARG` and `ENV` instructions should avoid secrets.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) - Gives general guidance for centralized storage, auditing, rotation, and lifecycle management of secrets.
- [Microsoft Entra workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) - Describes exchanging external workload tokens such as GitHub Actions OIDC tokens for Microsoft identity platform access tokens.
- [Google Cloud Workload Identity Federation for deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) - Documents pipeline authentication to Google Cloud without maintaining service account keys.

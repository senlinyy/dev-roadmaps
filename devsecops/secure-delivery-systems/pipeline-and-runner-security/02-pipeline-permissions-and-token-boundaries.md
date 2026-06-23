---
title: "Pipeline Permissions and Token Boundaries"
description: "Scope GitHub Actions and GitLab pipeline tokens, split read and write jobs, and use OIDC for short-lived cloud deployment access."
overview: "This article follows Summit Retail's checkout-api pipeline after runner trust is in place. It explains how repository tokens, package publishing permissions, pull request permissions, and cloud deployment identities should stay scoped to the exact job that needs them."
tags: ["devsecops", "tokens", "oidc", "ci-cd"]
order: 2
id: article-devsecops-pipeline-and-runner-security-permissions-token-boundaries
---

## Table of Contents

1. [The Job Token Problem](#the-job-token-problem)
2. [GITHUB_TOKEN and CI Job Tokens](#github_token-and-ci-job-tokens)
3. [Repository Defaults and Job Permissions](#repository-defaults-and-job-permissions)
4. [Read Jobs, Write Jobs, and Pull Requests](#read-jobs-write-jobs-and-pull-requests)
5. [Package Publishing Permissions](#package-publishing-permissions)
6. [OIDC and Workload Identity Federation](#oidc-and-workload-identity-federation)
7. [AWS Trust Policies for Summit Retail](#aws-trust-policies-for-summit-retail)
8. [Environment-Bound Deployment Identities](#environment-bound-deployment-identities)
9. [GitLab Tokens in the Same Pattern](#gitlab-tokens-in-the-same-pattern)
10. [Verifying Token Boundaries](#verifying-token-boundaries)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Job Token Problem
<!-- section-summary: A pipeline token gives an automated job permission to call APIs, so every job needs a clear boundary around what that token can touch. -->

In the previous article, Summit Retail worked on **runner trust** for the `checkout-api`. The team cared about where jobs run, which runners can handle production work, and how much trust to place in code that executes on shared infrastructure. Now the runner is in better shape, so the next question is about the identity inside the job.

A **pipeline token** is a credential that the CI/CD platform gives to an automated job so the job can call APIs. The token may read repository contents, write pull request comments, upload build artifacts, publish packages, or request a cloud deployment identity. In plain English, the runner is the machine doing the work, and the token is the badge the job carries while doing that work.

A **token boundary** is the limit around that badge. It answers three questions: which system accepts this token, which actions can the token take, and which repository, package, environment, or cloud resource can it affect. A good boundary lets Summit's test job read the source code and report a result, while the production deploy job can request a production cloud role only after the workflow reaches the production environment.

This matters because pipelines run code from many situations. The same repository might run a unit test for a pull request from a fork, build a container image after a merge to `main`, publish a package after a release tag, and deploy production after approval. Those jobs share the word "pipeline," but they should not share the same power.

Here is the shape Summit Retail wants for `checkout-api`. The table gives us the path for the rest of the article, because each row needs a different token boundary:

| Pipeline job | Normal trigger | Token boundary |
|---|---|---|
| Test pull request | `pull_request` | Read repository contents and test code |
| Build image | Push to `main` | Read repository contents and write one package image |
| Deploy staging | Push to `main` | Request a staging cloud role through OIDC |
| Deploy production | Approved production environment | Request a production cloud role through OIDC |

The rest of this article follows that path. First we name the built-in tokens. Then we tighten repository and job permissions. After that we split read work from write work, handle package publishing, replace stored cloud secrets with OIDC, and verify that the jobs only received the access they needed.

![Job token boundary showing separate read, package write, and OIDC permissions for test, build, and deploy jobs](/content-assets/articles/article-devsecops-pipeline-and-runner-security-permissions-token-boundaries/job-token-boundary.png)

*Each pipeline job should receive its own narrow token boundary, so a test job cannot accidentally inherit the write power needed by publishing or deployment jobs.*

## GITHUB_TOKEN and CI Job Tokens
<!-- section-summary: Built-in job tokens are convenient because the CI system creates them automatically, but convenience still needs a narrow permission boundary. -->

**GITHUB_TOKEN** is the built-in token that GitHub Actions creates for a workflow run. A job can use it to call GitHub APIs for the repository that owns the workflow. GitHub exposes it through `secrets.GITHUB_TOKEN`, and actions can also reach it through the `github.token` context when the workflow author did not pass it explicitly.

That second detail is important for Summit Retail. If the `checkout-api` workflow uses a third-party action, that action may be able to use the job's token through the context. The permission boundary must protect the job even when an action has access to the token. That means the workflow should set permissions deliberately instead of relying on broad defaults.

GitLab has a similar built-in idea called **CI_JOB_TOKEN**. GitLab creates it for a running job so the job can call selected GitLab APIs, download dependencies, access allowed repositories, or publish to supported registries. The exact capabilities depend on GitLab settings and the endpoints that accept the token.

These built-in tokens are useful because Summit does not need to store a long-lived GitHub or GitLab personal access token in CI secrets for normal repository operations. The platform issues the token for the job, the job uses it, and the token stops being useful after the job finishes. Short-lived platform-issued credentials reduce the number of permanent secrets waiting in CI settings.

They still need scoping. A pull request test job needs code checkout and maybe pull request metadata. It does not need permission to publish a package. A package publishing job needs package write permission. It does not need permission to request the production AWS role. The token type gives the job an identity, and the permission settings decide what that identity can do.

## Repository Defaults and Job Permissions
<!-- section-summary: Repository defaults set the starting point, while workflow and job permissions narrow the token for each piece of work. -->

Before writing YAML, define two layers. **Repository workflow permissions** are the default GitHub Actions token permissions for the repository or organization. **Workflow and job permissions** are the permissions declared in a workflow file with the `permissions:` key. The repository default is the starting point, and the workflow file should narrow each job from there.

For Summit Retail, the repository default should be read-only for normal workflow tokens. That default means a new workflow starts with a safer baseline. The workflow file can then grant write access only to the job that publishes a package, or grant `id-token: write` only to the job that needs an OIDC token for cloud federation.

Here is a production-style GitHub Actions shape for the `checkout-api`. The workflow starts with `permissions: {}` so jobs receive no repository token permissions unless they ask for them. Each job then requests the narrow set it needs.

```yaml
name: checkout-api

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions: {}

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm test

  build-image:
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - run: docker build -t ghcr.io/summit-retail/checkout-api:${{ github.sha }} .
      - run: echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
      - run: docker push ghcr.io/summit-retail/checkout-api:${{ github.sha }}

  deploy-staging:
    runs-on: ubuntu-latest
    needs: build-image
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: staging
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/summit-checkout-api-staging-deploy
          aws-region: us-east-1
      - run: aws sts get-caller-identity
      - run: ./scripts/deploy-ecs-service.sh staging ghcr.io/summit-retail/checkout-api:${{ github.sha }}

  deploy-production:
    runs-on: ubuntu-latest
    needs: deploy-staging
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::444455556666:role/summit-checkout-api-production-deploy
          aws-region: us-east-1
      - run: aws sts get-caller-identity
      - run: ./scripts/deploy-ecs-service.sh production ghcr.io/summit-retail/checkout-api:${{ github.sha }}
```

The important part is the split. `test` can read code and pull request metadata. `build-image` can write a package image. `deploy-staging` and `deploy-production` can request an OIDC token, but they do not receive `packages: write`. The production job also points at a different AWS account and a different IAM role.

`persist-credentials: false` on checkout deserves a quick note. `actions/checkout` can leave the token configured in the local Git repository so later git commands can use it. Summit's test and deploy jobs do not need later git pushes, so the workflow avoids leaving the token in that git config. That does not replace `permissions:`, but it removes one common place where a token can accidentally travel farther through the job than planned.

## Read Jobs, Write Jobs, and Pull Requests
<!-- section-summary: Pull request jobs should stay mostly read-only because they often execute code before the team has accepted it into the trusted branch. -->

A **read job** uses the repository as input. It checks out code, installs dependencies, runs tests, scans files, and reports a result. A **write job** changes something outside the temporary runner workspace, such as a package registry, a GitHub release, a deployment environment, or a cloud account.

Summit Retail treats pull request jobs as read jobs. That choice matters because pull requests can contain untrusted code. A test script from a pull request can execute on the runner. If the job token can write packages or request cloud credentials, then a malicious change can try to use that access during the test run.

GitHub gives pull requests from forks a more restricted token by default, and repository settings can control whether Actions can approve pull requests or receive broader write tokens in forked pull request workflows. Summit still writes the workflow defensively. The pull request job asks only for read access and uses conditions so package publishing and deployment jobs only run from trusted `main` pushes.

The split usually appears in three places. Summit's reviewers look for this split before they read the rest of the workflow:

| Job behavior | Token choice | Summit example |
|---|---|---|
| Test code from a pull request | Read repository token | `contents: read`, `pull-requests: read` |
| Publish an image after merge | Package write token | `packages: write` only in `build-image` |
| Deploy to AWS | OIDC token and cloud role | `id-token: write` only in deploy jobs |

There is one GitHub Actions event that security teams discuss a lot: `pull_request_target`. That event runs in the context of the base repository, so it can access more trusted settings than a normal pull request workflow. It can help with safe automation like labeling or commenting, but it needs careful handling because checking out and running pull request code in that context can expose powerful credentials to untrusted code.

Summit keeps the simple path for `checkout-api`: normal `pull_request` for tests, `push` to `main` for package publishing, and deployment through named environments. That structure makes the token boundary easier to review because the workflow event already hints at the expected trust level.

## Package Publishing Permissions
<!-- section-summary: Package publishing is a write operation, so it deserves its own job, its own permission grant, and a clear package target. -->

**Package publishing** means the pipeline uploads a build output to a registry so other systems can download it later. For `checkout-api`, the package is a container image. Summit publishes it to GitHub Container Registry as `ghcr.io/summit-retail/checkout-api:<sha>`.

Publishing has a different risk profile from testing. If an attacker can publish an image under the real package name, downstream deployment jobs might pull it. If the registry uses mutable tags like `latest`, the risk is even higher because consumers may pull a changed image without noticing the commit that produced it.

That is why the `build-image` job receives `packages: write` and the `test` job does not. The build job also uses the commit SHA as the image tag. A SHA tag gives Summit a stable link between source commit, build log, image digest, and deployment record.

The package job can be small and explicit. All the write access for GitHub Container Registry stays inside this one job:

```yaml
build-image:
  runs-on: ubuntu-latest
  needs: test
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4
      with:
        persist-credentials: false
    - run: docker build -t ghcr.io/summit-retail/checkout-api:${{ github.sha }} .
    - run: echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
    - run: docker push ghcr.io/summit-retail/checkout-api:${{ github.sha }}
```

In real production, Summit also records the image digest after the push and deploys by digest where the platform supports it. A digest identifies the exact image bytes, while a tag is a label that can point at an image. Using both a SHA tag and a digest gives release reviewers a cleaner trail from commit to running service.

Package write access should stay separate from cloud deployment access. Publishing an image to a registry and updating a production service are two different trust decisions. The first creates a candidate artifact. The second asks production to run it.

## OIDC and Workload Identity Federation
<!-- section-summary: OIDC lets a CI job request short-lived cloud credentials without storing a permanent cloud access key in CI secrets. -->

**OpenID Connect**, usually shortened to **OIDC**, is a standard way for one system to issue signed identity information that another system can trust. In CI/CD, the CI platform issues a short-lived identity token for a job. A cloud provider validates that token and then gives the job temporary cloud credentials for a specific role.

**Workload identity federation** is the broader name for that pattern. A workload, such as a GitHub Actions job, proves who it is to a cloud provider through a federated identity token. The cloud provider checks the token's issuer, audience, subject, and other claims before issuing temporary credentials.

Here is the flow for Summit's production deploy. Each step moves the job from a GitHub identity to a short-lived AWS role session:

1. The `deploy-production` job starts in GitHub Actions.
2. The job has `id-token: write`, so it can request a GitHub OIDC token.
3. GitHub issues a signed token with claims about the repository, ref, workflow, environment, and run.
4. AWS IAM validates the token through the configured GitHub OIDC provider.
5. AWS checks the IAM role trust policy.
6. AWS STS issues short-lived credentials for the production deploy role.
7. The job deploys `checkout-api` with those temporary credentials.

The important part is that Summit does not store an AWS access key in GitHub secrets for this deployment. The job asks for a fresh identity token, AWS checks the trust policy, and the resulting AWS credentials expire automatically. If someone steals a log line or a temporary credential from a runner, the time window is much smaller than a permanent secret.

OIDC also gives security teams more precise rules. The AWS role can trust only `summit-retail/checkout-api`, only the `production` environment, and only the expected audience value. That is much tighter than "any workflow with this stored AWS key can deploy."

![OIDC cloud identity flow showing a CI deploy job requesting an OIDC token, matching a cloud trust policy, receiving temporary credentials, and deploying checkout-api without a stored cloud key](/content-assets/articles/article-devsecops-pipeline-and-runner-security-permissions-token-boundaries/oidc-cloud-identity-flow.png)

*OIDC turns cloud access into a checked exchange: the job proves where it came from, the cloud trust policy verifies the claims, and the job receives temporary credentials instead of a stored cloud key.*

## AWS Trust Policies for Summit Retail
<!-- section-summary: An AWS trust policy decides which CI job can assume a role, and the safest policies match the repository, audience, and environment claim. -->

An **AWS IAM role trust policy** controls who can assume the role. For OIDC, the principal is the OIDC provider registered in AWS, and the action is `sts:AssumeRoleWithWebIdentity`. The condition block checks claims from the token before AWS gives the job temporary credentials.

The two most important claims for this example are **audience** and **subject**. The audience, usually called `aud`, names the service the token is meant for. For GitHub Actions to AWS, Summit uses `sts.amazonaws.com`. The subject, usually called `sub`, identifies the GitHub workflow context. When a job references a GitHub environment, GitHub can include the environment name in the subject value.

Here is a production role trust policy for Summit Retail. The account IDs and role names are sample values, but the claim checks are the important part:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCheckoutApiProductionFromGitHubActions",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::444455556666:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:summit-retail/checkout-api:environment:production"
        }
      }
    }
  ]
}
```

This policy says that AWS can issue the production deploy role only when the OIDC token came from GitHub Actions, the token audience is AWS STS, and the subject matches Summit's `checkout-api` production environment. A workflow in another repository, another organization, or another environment will not match this condition.

The role also needs a permission policy that controls what the temporary AWS credentials can do after AWS issues them. Summit keeps that policy small. For an ECS service deploy, the role might update one service, describe the service, register a task definition, and pass only the task roles that the service already uses.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UpdateCheckoutApiService",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService"
      ],
      "Resource": "arn:aws:ecs:us-east-1:444455556666:service/summit-production/checkout-api"
    },
    {
      "Sid": "RegisterCheckoutApiTaskDefinition",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassOnlyCheckoutApiRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::444455556666:role/checkout-api-task-role",
        "arn:aws:iam::444455556666:role/checkout-api-execution-role"
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

`ecs:RegisterTaskDefinition` is the uncomfortable line in this example. ECS task definition registration uses `Resource: "*"`, so Summit compensates with controls around the generated task definition, a narrow deploy script, branch and environment gates, and a tightly scoped `iam:PassRole` statement. The role can register a task definition, but it can only pass the known task role and execution role for `checkout-api`.

`iam:PassRole` needs special attention. ECS uses task roles to give the running application AWS permissions. If the deploy role can pass any role, a compromised pipeline may attach a more powerful role to the service. Summit limits `iam:PassRole` to the known task role and execution role for `checkout-api`.

The staging role should have its own trust policy and its own AWS account or environment boundary. Summit does not reuse the production role for staging because the staging workflow should not carry production access. The two jobs may look similar in YAML, but they assume different IAM roles with different AWS account IDs and different trust conditions.

## Environment-Bound Deployment Identities
<!-- section-summary: Environment-bound identities connect CI deployment approval, OIDC claims, and cloud role trust into one narrow production path. -->

A **deployment environment** is a named target such as `staging` or `production`. In GitHub Actions, a job can declare an environment with `environment: production`. That environment can have reviewers, wait timers, environment secrets, and deployment records configured around it.

For token boundaries, the environment name matters because it can appear in the GitHub OIDC subject claim. Summit uses that fact to bind the AWS role to the deployment target. The production role trusts `repo:summit-retail/checkout-api:environment:production`, while the staging role trusts `repo:summit-retail/checkout-api:environment:staging`.

Here is the production job again, with the important access lines kept together. Notice how the environment, OIDC permission, and AWS role all describe the same production deployment:

```yaml
deploy-production:
  runs-on: ubuntu-latest
  needs: deploy-staging
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  environment: production
  permissions:
    contents: read
    id-token: write
  steps:
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: arn:aws:iam::444455556666:role/summit-checkout-api-production-deploy
        aws-region: us-east-1
    - run: aws sts get-caller-identity
    - run: ./scripts/deploy-ecs-service.sh production ghcr.io/summit-retail/checkout-api:${{ github.sha }}
```

The environment name, `id-token: write`, and AWS role ARN all have to line up. The job asks GitHub for an OIDC token. AWS checks that the token says the job belongs to the production environment. The AWS credentials that come back can update only the production resources allowed by the role's permission policy.

This is where people sometimes confuse environment secrets with environment identity. A secret is a value stored in the CI platform. An identity is the role the job receives after the cloud provider validates who the job is. Summit prefers identity federation for cloud access because it removes permanent AWS keys from GitHub and lets AWS make the final decision from signed token claims.

The next article will go deeper on protected branches and environment gates. For this article, keep the access point clear: the environment is part of the identity boundary, and the cloud trust policy should check it.

## GitLab Tokens in the Same Pattern
<!-- section-summary: GitLab uses different names, but the same design applies: job tokens for GitLab operations and ID tokens for cloud federation. -->

GitLab uses names that differ from GitHub, but the token boundary idea stays the same. **CI_JOB_TOKEN** is the built-in job token for GitLab operations. **ID tokens** are OIDC tokens that a GitLab CI job can request for a specific audience, such as AWS STS or another secret manager.

For example, a GitLab pipeline for the same `checkout-api` would keep normal GitLab package or API work on `CI_JOB_TOKEN`, then request an ID token only in the deployment job. The job defines the audience so the token is intended for the receiving system.

```yaml
deploy_production:
  stage: deploy
  environment: production
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
  id_tokens:
    AWS_ID_TOKEN:
      aud: sts.amazonaws.com
  script:
    - >
      aws_creds="$(aws sts assume-role-with-web-identity
      --role-arn arn:aws:iam::444455556666:role/summit-checkout-api-production-deploy
      --role-session-name checkout-api-${CI_PIPELINE_ID}
      --web-identity-token "${AWS_ID_TOKEN}"
      --duration-seconds 1800
      --output json)"
    - export AWS_ACCESS_KEY_ID="$(echo "${aws_creds}" | jq -r '.Credentials.AccessKeyId')"
    - export AWS_SECRET_ACCESS_KEY="$(echo "${aws_creds}" | jq -r '.Credentials.SecretAccessKey')"
    - export AWS_SESSION_TOKEN="$(echo "${aws_creds}" | jq -r '.Credentials.SessionToken')"
    - aws sts get-caller-identity
```

That example focuses on the identity exchange and keeps the secret values out of normal log output. A complete production job can also use a supported helper that handles the exchange. The important design is the same as GitHub Actions: the job receives an ID token for AWS, AWS checks claims, and AWS issues temporary credentials for the allowed role.

AWS trust policies for GitLab usually check the issuer, audience, and GitLab-specific subject or project claims. A production policy can require the `checkout-api` project and the `main` branch or production environment claim. The exact claim names depend on the GitLab issuer and ID token format, so Summit reviews a real token in a safe test project before locking the policy.

CI_JOB_TOKEN still has a job in this design. It works for GitLab package registry access, dependency retrieval, and GitLab API operations that support it. The cloud deployment identity comes from an ID token because AWS needs signed claims about the job, not a GitLab API token.

## Verifying Token Boundaries
<!-- section-summary: Verification turns the design into evidence by checking workflow YAML, repository defaults, cloud identity, package permissions, and runtime logs. -->

**Verification** means proving that the job received only the permissions the design intended. Summit treats this as part of pipeline review, not as a one-time cleanup. Every new workflow, package publisher, or deployment job should answer the same basic questions.

Start with the workflow file. The reviewer checks for a top-level `permissions: {}` or another deliberately restricted default, then checks every job that overrides it. If a job has `packages: write`, the reviewer expects a package publishing reason. If a job has `id-token: write`, the reviewer expects a matching cloud trust policy and a named deployment job.

A lightweight review table helps catch drift. Summit uses this kind of checklist during pull request review for workflow changes:

| Check | Expected evidence |
|---|---|
| Pull request job token | `contents: read` and no package or OIDC write permission |
| Package job token | `packages: write`, trusted trigger, clear package name |
| Deploy job token | `id-token: write`, environment name, cloud role ARN |
| AWS trust policy | `aud` and `sub` conditions match repository and environment |
| AWS permission policy | Actions and resources name the target service, package, and roles |

Repository settings also deserve review. In GitHub, Summit checks the Actions workflow permissions setting at the organization or repository level and keeps the default restricted. A `gh` CLI check can capture the setting during an audit:

```bash
gh api repos/summit-retail/checkout-api/actions/permissions/workflow
```

Inside a deployment job, Summit prints the AWS caller identity after assuming the role. This does not print secret values. It shows which AWS account and role the job received, which is useful during review and incident response.

```bash
aws sts get-caller-identity
```

The expected production output should show the production AWS account and the production deploy role session. If the staging job shows the production account, the trust boundary is wrong. If the production job shows a generic administrator role, the role design is too broad for a service deploy.

For GitHub OIDC specifically, Summit also verifies the subject claim before locking production trust. Teams often do this in a temporary test workflow that prints token claims in a controlled branch or uses a dedicated debugging action during setup. After the policy is confirmed, the debug step should leave the production workflow because normal deploy logs do not need to expose identity-token details.

Finally, verify negative space. That means checking the permissions a job did not receive. The test job should have no `packages: write`, no `contents: write`, and no `id-token: write`. The package job should have no production role. The deploy job should have no package write permission unless it truly builds and publishes as part of the deploy, which Summit avoids for `checkout-api`.

## Putting It All Together
<!-- section-summary: A secure pipeline gives every job a purpose-built token boundary and keeps cloud deployment access tied to short-lived federated identity. -->

Let's connect the whole `checkout-api` flow now. This is the same pipeline we have been building piece by piece:

The pull request opens, and GitHub Actions runs `test`. That job checks out code with `contents: read`, reads pull request metadata with `pull-requests: read`, and runs tests. The job handles code that may come from outside the trusted branch, so it stays away from package publishing and cloud identity.

The pull request merges to `main`, and the `build-image` job runs. That job receives `packages: write` because it has one write task: publish `ghcr.io/summit-retail/checkout-api:${{ github.sha }}`. The image tag ties the artifact to the commit, and the registry record gives deployment jobs a known artifact to deploy.

The staging deployment runs next. The job has `id-token: write`, declares `environment: staging`, and assumes the staging AWS role through OIDC. AWS checks the GitHub token claims, issues temporary credentials, and limits those credentials to staging deployment actions.

Production follows the same pattern with a stricter target. The job declares `environment: production`, assumes the production deploy role in the production AWS account, and receives only the AWS permissions needed to update the `checkout-api` service. The token boundary lives in both places: GitHub controls which job can request the OIDC token, and AWS controls which OIDC token can assume the role.

This is the operating rule Summit keeps repeating during reviews: **every job gets the smallest useful token for its job, and cloud access uses short-lived federation instead of stored cloud keys**. That rule gives reviewers a concrete way to evaluate new workflows. They can point at the job name, the trigger, the `permissions:` block, the environment, and the cloud trust policy, then check whether those pieces tell the same story.

![Least-power pipeline showing pull request tests, image publishing, staging role, production role, and log verification as separate permission steps](/content-assets/articles/article-devsecops-pipeline-and-runner-security-permissions-token-boundaries/least-power-pipeline.png)

*The finished token design lets each stage ask for the smallest useful permission, then verifies the received identity in logs before trusting the deploy path.*

## What's Next

Pipeline token boundaries answer what a job can do after it starts. The next article looks at who can make the high-risk jobs start and who can approve them.

We will connect protected branches, required checks, CODEOWNERS, deployment environments, reviewers, and environment gates. That is where Summit Retail turns the token boundary into a controlled release path for `checkout-api`.

---

**References**

- [GitHub Docs: Use GITHUB_TOKEN for authentication in workflows](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) - Explains how workflows use `GITHUB_TOKEN` and how to modify its permissions.
- [GitHub Docs: Workflow syntax for GitHub Actions](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#permissions) - Documents the `permissions:` key, workflow-level permissions, and job-level permission overrides.
- [GitHub Docs: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Introduces OIDC for GitHub Actions and cloud provider federation.
- [GitHub Docs: OpenID Connect reference](https://docs.github.com/actions/reference/openid-connect-reference) - Documents GitHub OIDC token claims, subject formats, and token permission requirements.
- [GitHub Docs: Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) - Shows AWS IAM provider setup, `id-token: write`, and AWS role assumption from GitHub Actions.
- [AWS IAM User Guide: Create a role for an OpenID Connect identity provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - Explains IAM roles that trust OIDC identity providers.
- [AWS IAM User Guide: IAM and AWS STS condition context keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html) - Documents IAM and AWS STS condition keys, including `iam:PassedToService` for role-passing boundaries.
- [Amazon ECS Developer Guide: Identity-based policy examples](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security_iam_id-based-policy-examples.html) - Documents ECS policy examples, including task definition permission behavior.
- [GitLab Docs: Tokens](https://docs.gitlab.com/security/tokens/) - Explains GitLab token types, including CI/CD job tokens and personal access tokens.
- [GitLab Docs: ID token authentication](https://docs.gitlab.com/ci/secrets/id_token_authentication/) - Documents GitLab CI/CD ID tokens, audiences, and OIDC use cases.

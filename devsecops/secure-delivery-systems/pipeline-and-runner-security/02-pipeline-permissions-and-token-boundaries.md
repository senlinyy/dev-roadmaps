---
title: "Pipeline Permissions and Token Boundaries"
description: "Scope CI job tokens, split read and write work, publish packages with narrow permissions, and use OIDC for short-lived cloud deployment identity."
overview: "Start with one checkout-api job that needs a small key to publish one package, then grow that idea into GITHUB_TOKEN permissions, read and write job splits, pull request risk, package publishing, OIDC, workload identity federation, cloud trust policies, environment-bound identities, GitLab token patterns, and verification evidence."
tags: ["devsecops", "tokens", "oidc", "ci-cd"]
order: 2
id: article-devsecops-pipeline-and-runner-security-permissions-token-boundaries
---

## Table of Contents

1. [A Small Key for One Job](#a-small-key-for-one-job)
2. [From One Package Push to Job Tokens](#from-one-package-push-to-job-tokens)
3. [Default Permissions and Job Permissions](#default-permissions-and-job-permissions)
4. [Read Jobs, Write Jobs, and Pull Requests](#read-jobs-write-jobs-and-pull-requests)
5. [Package Publishing Boundaries](#package-publishing-boundaries)
6. [OIDC and Workload Identity Federation](#oidc-and-workload-identity-federation)
7. [Cloud Role Trust Policies](#cloud-role-trust-policies)
8. [Environment-Bound Deployment Identities](#environment-bound-deployment-identities)
9. [GitLab Tokens in the Same Pattern](#gitlab-tokens-in-the-same-pattern)
10. [Verifying Token Boundaries](#verifying-token-boundaries)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)
13. [References](#references)

## A Small Key for One Job
<!-- section-summary: A token boundary is easiest to understand as giving one job the small key it needs for one task. -->

Imagine a package room in an office. A person needs to place one labeled box on one shelf. The safe version gives that person a key to that room and that shelf for the short time they need it, while the master key stays locked away.

A pipeline job has the same problem. One job might need to publish one container image. Another job might need to comment on a pull request. A deployment job might need to request a cloud role. Each job needs a small key for its own task.

Summit Retail's `checkout-api` has four ordinary jobs:

| Job | Job goal | Small key it needs |
|---|---|---|
| `test` | Run pull request tests | Read repository contents |
| `build-image` | Publish one container image | Read repository contents and write one package |
| `deploy-staging` | Update staging | Request a staging cloud identity |
| `deploy-production` | Update production | Request a production cloud identity after approval |

A **pipeline token** is a credential the CI/CD platform gives to a job so the job can call APIs. A **token boundary** is the limit around that credential. The boundary says which system accepts the token, which action the token can take, and which repository, package, environment, or cloud resource it can affect.

We will build the boundary from a tiny package publishing job first, then add pull requests, OIDC, cloud trust, and environment rules.

## From One Package Push to Job Tokens
<!-- section-summary: Built-in CI job tokens are convenient, but the workflow must still limit what each job token can do. -->

Start with the package push. `checkout-api` merges to `main`, the build job creates an image, and the job pushes that image to GitHub Container Registry.

Here is the small skeleton:

```yaml
name: checkout-api package

on:
  push:
    branches:
      - main

jobs:
  build-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ghcr.io/summit-retail/checkout-api:${{ github.sha }} .
      - run: docker push ghcr.io/summit-retail/checkout-api:${{ github.sha }}
```

`docker build` creates a container image from the repository. The tag uses `${{ github.sha }}`, which ties the image tag to the commit that triggered the workflow. `docker push` uploads the image to the registry. The missing detail is authentication: the registry needs to know this job has permission to publish that package.

GitHub Actions creates a built-in **GITHUB_TOKEN** for workflow runs. A job can use it to call GitHub APIs and GitHub package services for the repository. GitLab has a similar built-in **CI_JOB_TOKEN** for GitLab jobs. These platform-issued tokens are useful because teams avoid storing long-lived personal access tokens for routine CI work.

Convenience still needs a boundary. A third-party action in the same job may be able to use the job token through the GitHub context. A shell step can read environment variables made available to that step. A script from the repository can try to call APIs. The workflow should give the job only the token permissions needed for its task.

The package job is clearer with an explicit permission block:

```yaml
permissions:
  contents: read
  packages: write
```

`contents: read` lets the job read source code. `packages: write` lets the job publish to GitHub Packages or GitHub Container Registry. A test job stays on read access, and a package job stays away from production cloud access.

## Default Permissions and Job Permissions
<!-- section-summary: Repository defaults set the baseline, while workflow and job permissions narrow the built-in token for each job. -->

GitHub Actions has permission defaults at the organization or repository level, and workflows can also declare `permissions:` at the workflow or job level. Summit uses restricted defaults, then each workflow declares what it needs. This keeps broad write access visible during review.

The pattern starts with no permissions at the top:

```yaml
name: checkout-api delivery

on:
  pull_request:
  push:
    branches:
      - main
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
```

`permissions: {}` at the workflow level gives jobs no repository token permissions unless they ask. The `test` job asks for source and pull request metadata only. `persist-credentials: false` keeps the checkout token out of the local Git config after source checkout. `npm ci` installs dependencies from the lockfile, and `npm test` runs the project's test script.

Now add the package job:

```yaml
  build-image:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
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

The `if` line allows this job only for a push to `main`. The `docker build` command creates the image. The `docker login` command authenticates Docker to GitHub Container Registry by passing the job token through standard input, which keeps the token out of the command-line argument list. The `docker push` command uploads the tagged image.

Example registry output is usually shaped like this:

```bash
The push refers to repository [ghcr.io/summit-retail/checkout-api]
checkout-api:7c1a2ef: digest: sha256:9f3e6f3b1d7e... size: 2198
```

The digest in that output is the stable artifact identity. Later gates should prefer the digest over a movable tag.

## Read Jobs, Write Jobs, and Pull Requests
<!-- section-summary: Pull request jobs should stay mostly read-only because they execute code before the team accepts it into a trusted branch. -->

A **read job** uses the repository as input. It checks out code, installs dependencies, runs tests, scans files, and reports a result. A **write job** changes something outside the temporary runner workspace: a package registry, a release, a deployment environment, a cloud account, or a pull request comment.

Summit treats pull request jobs as read jobs. Pull requests can change scripts, tests, package manifests, and build configuration. If a pull request job receives package write permission or cloud identity permission, the pull request code can try to use that access while the job runs.

The read and write split gives reviewers a simple workflow map:

| Job behavior | Token boundary | Summit example |
|---|---|---|
| Test pull request code | Read repository token | `contents: read`, `pull-requests: read` |
| Publish after merge | Package write token | `packages: write` in `build-image` only |
| Deploy to cloud | OIDC token and cloud role | `id-token: write` in deploy jobs only |
| Comment on a pull request | Pull request write token | Separate comment job with `pull-requests: write` |

GitHub gives forked pull request workflows more restrictive token behavior by default, and repository settings can further limit what those workflows receive. Summit still writes the workflow as though any pull request code can try to misuse the job. The test job gets read permission. The package job runs only after merge. The deployment jobs use named environments and cloud trust policies.

`pull_request_target` needs special care. That event runs in the base repository context, which is useful for trusted metadata tasks such as labels or policy comments. Summit avoids checking out and executing the pull request head code with a write token or deployment identity. Untrusted test execution stays on `pull_request`, and trusted automation runs from code on the protected branch.

The package write boundary is the next place where a small mistake can travel far.

## Package Publishing Boundaries
<!-- section-summary: Package publishing is a write operation, so it deserves its own trigger, job, permission grant, package target, and artifact evidence. -->

**Package publishing** uploads a build output to a registry so other systems can download it. For `checkout-api`, the package is a container image at `ghcr.io/summit-retail/checkout-api`. If an attacker can publish under that name, a later deployment may pull the attacker's image.

Summit gives `packages: write` to the package job and nowhere else. The job runs from a trusted trigger, uses a commit SHA tag, records the pushed digest, and passes the digest to later release evidence.

The job can write the digest to the workflow summary:

```yaml
  build-image:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image: ${{ steps.image.outputs.image }}
      digest: ${{ steps.image.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Build image
        run: docker build -t ghcr.io/summit-retail/checkout-api:${{ github.sha }} .
      - name: Log in to GHCR
        run: echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
      - name: Push image
        id: image
        run: |
          docker push ghcr.io/summit-retail/checkout-api:${{ github.sha }}
          echo "image=ghcr.io/summit-retail/checkout-api" >> "$GITHUB_OUTPUT"
          echo "digest=sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6" >> "$GITHUB_OUTPUT"
```

The `Build image` step creates the image. The `Log in to GHCR` step authenticates to the registry with the job token. The `Push image` step uploads the image and writes two output values: the registry path and the digest. In a real workflow, Summit would parse the actual digest from the push or from `docker buildx` output instead of using the sample digest shown here.

Package write access stays separate from cloud deployment access. Publishing creates a candidate artifact. Deployment asks an environment to run that artifact. Summit keeps those decisions in different jobs so package publishing and cloud deploy power stay separated.

Cloud deployment uses a different kind of credential: short-lived identity federation.

![Job token boundary showing separate read, package write, and OIDC permissions for test, build, and deploy jobs](/content-assets/articles/article-devsecops-pipeline-and-runner-security-permissions-token-boundaries/job-token-boundary.png)

*Each pipeline job receives its own narrow token boundary, so a test job cannot inherit the write power used by publishing or deployment jobs.*

## OIDC and Workload Identity Federation
<!-- section-summary: OIDC lets a CI job request short-lived cloud credentials without storing a permanent cloud access key in CI secrets. -->

**OpenID Connect**, usually shortened to **OIDC**, is a standard way for one system to issue signed identity information that another system can verify. In CI/CD, the CI platform issues a short-lived identity token for a job. A cloud provider validates that token and then gives the job temporary cloud credentials for a specific role.

**Workload identity federation** is the broader pattern. The workload is the CI job. The identity token says where the job came from, such as repository, branch, workflow, environment, and run. The cloud provider checks those claims before it issues credentials.

For Summit's production deploy, the flow is:

1. The `deploy-production` job starts in GitHub Actions.
2. The job has `id-token: write`, so it can request a GitHub OIDC token.
3. GitHub issues a signed token with claims about the repository, ref, workflow, environment, and run.
4. AWS IAM validates that token through a configured GitHub OIDC provider.
5. AWS checks the IAM role trust policy.
6. AWS STS issues short-lived credentials for the production deploy role.
7. The job deploys `checkout-api` with those temporary credentials.

The job stores no AWS access key in GitHub secrets. It asks GitHub for a signed job identity, AWS checks the identity, and AWS returns temporary credentials with an expiration time.

The workflow line for this is small:

```yaml
permissions:
  contents: read
  id-token: write
```

`id-token: write` allows the job to request an OIDC token from GitHub. The cloud provider still has to trust the token claims and issue a role session before deployment can use cloud access.

![OIDC cloud identity flow showing a CI deploy job requesting an OIDC token, matching a cloud trust policy, receiving temporary credentials, and deploying checkout-api without a stored cloud key](/content-assets/articles/article-devsecops-pipeline-and-runner-security-permissions-token-boundaries/oidc-cloud-identity-flow.png)

*OIDC turns cloud access into a checked exchange: the job proves where it came from, the cloud trust policy verifies the claims, and the job receives temporary credentials instead of a stored cloud key.*

The cloud side of the boundary lives in a trust policy.

## Cloud Role Trust Policies
<!-- section-summary: A cloud trust policy decides which CI job identity can assume a role and which claims must match before credentials are issued. -->

An **AWS IAM role trust policy** controls who can assume a role. For GitHub OIDC, the principal is the GitHub OIDC provider registered in AWS, and the action is `sts:AssumeRoleWithWebIdentity`. The condition block checks token claims before AWS issues credentials.

Summit's production role trust policy checks the token audience and subject:

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

The `aud` claim says the token is meant for AWS STS. The `sub` claim says the job belongs to the `summit-retail/checkout-api` repository and the `production` environment. A workflow from another repository or another environment will not match this condition.

The role permission policy then controls what the temporary AWS credentials can do:

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

`ecs:UpdateService` lets the deploy job update one ECS service. `ecs:RegisterTaskDefinition` registers the new task definition. ECS task definition registration commonly uses `Resource: "*"`, so Summit compensates with a narrow deploy script, branch and environment gates, and a tight `iam:PassRole` statement. `iam:PassRole` allows the deploy job to pass only the known task role and execution role used by `checkout-api`.

After the role is assumed, the job prints the caller identity:

```bash
aws sts get-caller-identity
```

`aws sts get-caller-identity` shows which AWS account and role session the job received while keeping secret key values out of the log.

Example production output:

```json
{
  "UserId": "AROAXAMPLE:checkout-api-production-9142337112",
  "Account": "444455556666",
  "Arn": "arn:aws:sts::444455556666:assumed-role/summit-checkout-api-production-deploy/checkout-api-production-9142337112"
}
```

The account and role name should match production. If the staging job shows this production account, the token boundary is wrong.

## Environment-Bound Deployment Identities
<!-- section-summary: Environment-bound identities connect CI approval, OIDC claims, secrets, cloud trust, and deployment evidence into one production path. -->

A **deployment environment** is a named target such as `staging` or `production`. In GitHub Actions, a job can declare an environment with `environment: production`. That environment can have required reviewers, wait timers, secrets, variables, and deployment history.

For token boundaries, the environment name is also identity data. Summit's production AWS role trusts `repo:summit-retail/checkout-api:environment:production`. The staging role trusts `repo:summit-retail/checkout-api:environment:staging`. The two jobs may look similar in YAML, and they assume different cloud roles.

Here is the production job with the access lines kept together:

```yaml
deploy-production:
  needs: build-image
  if: github.event_name == 'workflow_dispatch' && inputs.target_environment == 'production'
  runs-on: ubuntu-latest
  environment: production
  permissions:
    contents: read
    id-token: write
  steps:
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: arn:aws:iam::444455556666:role/summit-checkout-api-production-deploy
        aws-region: us-east-1
        role-session-name: checkout-api-production-${{ github.run_id }}
    - run: aws sts get-caller-identity
    - run: ./scripts/deploy-ecs-service.sh production ghcr.io/summit-retail/checkout-api@${{ needs.build-image.outputs.digest }}
```

The `environment` line points at GitHub's production environment rules. `id-token: write` lets the job request the OIDC token. `role-to-assume` names the production AWS role. The `aws sts get-caller-identity` command prints the role session for the log. The deploy script receives the environment name and the image digest, so the deployment record can connect the job to the exact artifact.

Environment secrets and environment identity are related but separate. An environment secret is a stored value that GitHub releases after environment rules pass. An environment-bound identity is the cloud role the job receives after the cloud provider checks signed OIDC claims. Summit prefers OIDC for cloud deployment because AWS makes the final access decision from signed claims and short-lived credentials.

The same structure works in GitLab with different syntax.

## GitLab Tokens in the Same Pattern
<!-- section-summary: GitLab uses CI_JOB_TOKEN for GitLab operations and ID tokens for cloud federation, while the same read, write, and deploy split still applies. -->

GitLab's **CI_JOB_TOKEN** is the built-in token available to a running GitLab CI/CD job. It can call selected GitLab APIs, authenticate to supported GitLab registries, and access allowed projects depending on settings. GitLab also supports **ID tokens**, which are OIDC tokens a job can request for a specific audience.

A GitLab deploy job for `checkout-api` can request an ID token for AWS:

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

The `id_tokens` block asks GitLab for an OIDC token with the AWS STS audience. The `aws sts assume-role-with-web-identity` command exchanges that token for temporary AWS credentials. The three `export` commands place those temporary credentials in the shell environment for later AWS CLI commands. `aws sts get-caller-identity` confirms the account and role in the job log.

Example identity output should show the production account and role:

```json
{
  "Account": "444455556666",
  "Arn": "arn:aws:sts::444455556666:assumed-role/summit-checkout-api-production-deploy/checkout-api-18277"
}
```

`CI_JOB_TOKEN` still has useful jobs in this design. It can authenticate to GitLab Package Registry, download dependencies from allowed projects, or call GitLab APIs that accept it. Cloud deployment identity comes from the ID token because AWS needs signed job claims rather than a GitLab API token.

## Verifying Token Boundaries
<!-- section-summary: Verification checks workflow YAML, repository defaults, package permissions, cloud role claims, received identities, and missing permissions. -->

**Verification** means proving that a job received only the access the design intended. Summit does this during workflow review and during periodic audits.

The review starts with the workflow file. A reviewer checks for restricted defaults, then checks each job that asks for write access:

| Check | Expected evidence |
|---|---|
| Pull request job | `contents: read`, no package write, no OIDC permission |
| Package job | `packages: write`, trusted trigger, clear image name |
| Deploy job | `id-token: write`, environment name, cloud role ARN |
| AWS trust policy | `aud` and `sub` conditions match repository and environment |
| AWS permission policy | Actions and resources name the target service and allowed roles |

Repository settings should match the workflow. GitHub exposes Actions workflow permission settings through the API:

```bash
gh api repos/summit-retail/checkout-api/actions/permissions/workflow
```

`gh api` calls the GitHub REST API. This endpoint returns the repository setting for default workflow token permissions and whether GitHub Actions can approve pull requests.

Example output:

```json
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": false
}
```

Inside deployment jobs, the `aws sts get-caller-identity` output serves as evidence. It shows the actual AWS account and role session issued to the job. Summit also verifies the absence of permissions. The test job stays free of `packages: write`, `contents: write`, and `id-token: write`. The package job stays away from the production role. The deploy job stays separate from package publishing for `checkout-api`.

During OIDC setup, Summit tests token claims in a temporary safe workflow or a nonproduction repository, then removes token debugging from production workflows. Normal production logs can show the assumed role without printing raw identity tokens.

## Putting It All Together
<!-- section-summary: A secure pipeline gives every job a purpose-built token boundary and keeps cloud deployment access tied to short-lived federated identity. -->

The complete `checkout-api` permission story now has one path for each job. Pull request tests receive repository read access and run without package publishing or cloud identity. The build job runs only after merge to `main` and receives package write access for one image repository. Staging and production deploy jobs receive OIDC permission, declare their environments, and assume different cloud roles.

The boundary lives in several places at once. GitHub controls the job token permissions in YAML and repository settings. Environment rules control when production secrets and environment access are released. AWS controls which OIDC token claims can assume which role. The AWS permission policy controls which cloud actions the resulting temporary credentials can take.

![Least-power pipeline showing pull request tests, image publishing, staging role, production role, and log verification as separate permission steps](/content-assets/articles/article-devsecops-pipeline-and-runner-security-permissions-token-boundaries/least-power-pipeline.png)

*The finished token design lets each stage ask for the smallest useful permission, then verifies the received identity in logs before trusting the deploy path.*

The practical review sentence for Summit is: **every job gets the smallest useful token for its task, and cloud access uses short-lived federation tied to repository, ref, workflow, and environment claims**. That sentence gives reviewers a concrete way to check new pipeline changes.

## What's Next

Token boundaries answer what a job can do after it starts. The next article asks who can make the risky jobs start and who can approve them. We will connect protected branches, required checks, CODEOWNERS, merge queue, deployment environments, scan gates, release records, and bypass evidence.

## References

- [GitHub Actions: Use GITHUB_TOKEN for authentication in workflows](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) - Official guidance for using `GITHUB_TOKEN` and modifying token permissions.
- [GitHub Actions workflow syntax: permissions](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#permissions) - Documents the `permissions:` key at workflow and job levels.
- [GitHub Actions: Automatic token authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication) - GitHub guidance on `GITHUB_TOKEN`, permission scoping, and least privilege.
- [GitHub Actions: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - GitHub concept documentation for OIDC in Actions.
- [GitHub Actions: OpenID Connect reference](https://docs.github.com/actions/reference/openid-connect-reference) - Documents OIDC claims, subject formats, and `id-token: write`.
- [GitHub Actions: Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) - GitHub guide for AWS IAM OIDC configuration from Actions.
- [AWS IAM: Create a role for an OpenID Connect identity provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) - AWS documentation for roles that trust OIDC identity providers.
- [AWS IAM: AWS STS condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html) - AWS documentation for condition keys such as `iam:PassedToService`.
- [Amazon ECS: IAM policy examples](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security_iam_id-based-policy-examples.html) - ECS examples for service and task definition permissions.
- [GitLab: CI_JOB_TOKEN](https://docs.gitlab.com/ci/jobs/ci_job_token/) - GitLab documentation for CI job token usage and scoping.
- [GitLab: ID token authentication](https://docs.gitlab.com/ci/secrets/id_token_authentication/) - GitLab documentation for CI/CD ID tokens, audiences, and OIDC use cases.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) - OWASP guidance on handling and reducing long-lived secrets.

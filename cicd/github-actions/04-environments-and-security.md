---
title: "Environments and Security"
description: "Understand GitHub Actions secrets, environment protection rules, deployment approvals, GITHUB_TOKEN permissions, OpenID Connect, AWS trust policies, and secure deployment shape."
overview: "Deployment workflows handle credentials, approvals, and cloud access. This article connects GitHub secrets, environments, token permissions, and OIDC so a pipeline can deploy without spreading long-lived keys."
tags: ["security", "oidc", "environments", "secrets"]
order: 4
id: article-cicd-github-actions-environments-and-security
aliases:
  - environments-and-security
  - article-cicd-github-actions-environments-and-security
  - cicd/github-actions/environments-and-security.md
---

## Table of Contents

1. [Why Is a Workflow an Arbitrary-Code Security Boundary?](#why-is-a-workflow-an-arbitrary-code-security-boundary)
2. [How Do Secret Scopes, Environments, and Protection Rules Delay Authority?](#how-do-secret-scopes-environments-and-protection-rules-delay-authority)
3. [How Should GITHUBTOKEN Be Narrowed?](#how-should-githubtoken-be-narrowed)
4. [How Do OIDC and AWS Policies Replace a Shared Cloud Key?](#how-do-oidc-and-aws-policies-replace-a-shared-cloud-key)
5. [How Do id-token write, Environments, and OIDC Form One Authority Chain?](#how-do-id-token-write-environments-and-oidc-form-one-authority-chain)
6. [How Do Build Separation, Pull Requests, and Third-Party Actions Change Trust?](#how-do-build-separation-pull-requests-and-third-party-actions-change-trust)
7. [How Do Code, Identity, Permission, and Boundary Explain Security?](#how-do-code-identity-permission-and-boundary-explain-security)
8. [How Does the Complete Production Flow Fit Together?](#how-does-the-complete-production-flow-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The earlier articles built up the mechanics of GitHub Actions: events start workflows, runners execute jobs, and shared actions or reusable workflows reduce repeated YAML. Security sits on top of all of that because a pipeline can do real work outside GitHub.

The `node-service` test job only needs the repository and a Node.js runtime. A deployment job might push a container image, update Kubernetes, run a database migration, invalidate a CDN cache, or change cloud infrastructure. That job needs credentials, and those credentials can affect customers.

A **credential** is proof that the workflow is allowed to call another system. It might be a cloud access key, a package registry token, a database password, or a GitHub token. Once a workflow has a credential, any command in that job can try to use it.

Security in GitHub Actions therefore has a practical goal: give each job the smallest useful access for the shortest useful time, and place human approval where a mistake would be expensive. We will connect repository secrets, environment secrets, protection rules, `GITHUB_TOKEN` permissions, and OpenID Connect into one deployment shape.

Keep these questions in view as you work through the lesson:

1. **Why Is a Workflow an Arbitrary-Code Security Boundary?**
2. **How Do Secret Scopes, Environments, and Protection Rules Delay Authority?**
3. **How Should GITHUB_TOKEN Be Narrowed?**
4. **How Do OIDC and AWS Policies Replace a Shared Cloud Key?**
5. **How Do id-token write, Environments, and OIDC Form One Authority Chain?**
6. **How Do Build Separation, Pull Requests, and Third-Party Actions Change Trust?**
7. **How Do Code, Identity, Permission, and Boundary Explain Security?**
8. **How Does the Complete Production Flow Fit Together?**

## Why Is a Workflow an Arbitrary-Code Security Boundary?
<!-- section-summary: Deployment jobs can change real systems, so the credentials and approvals around them need tighter controls than ordinary test jobs. -->

The uncomfortable first principle is that a workflow executes programs. `npm test` can be changed to run a malicious JavaScript file. `npm ci` can execute dependency lifecycle scripts. A step using a third-party action downloads someone else's implementation and runs it on the job's runner. From the operating system's point of view, the sequence is simple:

```text
download code
give the job some authority
execute the code
```

That makes the central security question “what credentials can this code see?” If code receives a credential, assume it can use or exfiltrate it. Secret masking may prevent a recognized literal value from appearing plainly in a log, but it cannot stop a program from calling an API, encoding the value, or sending it across the network.

A credential is not merely a sensitive string. It is portable proof of authority. An AWS access key identifies an IAM principal whose policies allow actions. `GITHUB_TOKEN` represents a GitHub App installation whose permissions allow repository operations. Whoever possesses the credential can attempt to exercise those powers until the credential expires or is revoked.

This is why `NODE_VERSION=24` is configuration while an AWS key is authority. Writing a cloud key directly into workflow YAML would copy it into Git history, repository clones, backups, and possibly logs. Moving it to a GitHub secret protects storage before runtime, but once GitHub releases it to a runner, the executing code can still use it. Security therefore has to control scope, release time, lifetime, and permissions—not only storage.

## How Do Secret Scopes, Environments, and Protection Rules Delay Authority?
<!-- section-summary: Secrets store sensitive values for workflows, and their scope controls which repositories or environments can read them. -->

A **secret** is an encrypted value stored in GitHub for use by workflows. Common examples include registry tokens, API keys, database passwords, and webhook signing keys. A workflow reads a secret through the `secrets` context, then passes it to a step as an environment variable or action input.

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

GitHub masks secret values in logs when it recognizes them, but masking should be treated as a backstop. A script that prints environment variables, encodes a secret, splits it across multiple lines, or sends it to another service can still create exposure. The safer workflow design keeps secrets out of jobs that do not need them.

Secrets can live at different scopes. The scope controls which workflows can even ask for the value.

| Scope | What it means | Common use |
|---|---|---|
| Repository secret | Available to workflows in one repository | A token used only by `node-service` |
| Environment secret | Available only to jobs targeting a named environment | Production deployment credentials |
| Organization secret | Shared with selected repositories in an organization | A scanner token used by many services |

For `node-service`, a repository secret might be enough for a staging-only demo token. A production database password or deploy token belongs behind an environment because the environment can add approval and branch rules before the secret is available.

![Secrets need smaller scopes showing repository secret, environment secret, production gate, reviewer approval, deploy job, and secret released only inside the protected job](/content-assets/articles/article-cicd-github-actions-environments-and-security/secrets-environment-scope.png)

*Secret scope decides which workflow can ask for a value, while environment protection decides when a sensitive deployment job can actually receive it.*

Secrets are one part of the answer. The deployment target itself needs a name and rules, and that is what environments provide.

Scope reduces how many jobs can request a value. A repository secret is reachable only from one repository. An organization secret can be limited to selected repositories. An environment secret is available only to a job that declares that environment and passes its protection rules. Smaller scope reduces the blast radius of a mistaken reference, a compromised workflow, or an overly broad reusable pipeline.

An environment secret adds a more important property: **delayed authority**. A production credential does not need to exist in the runner during checkout, tests, or build. It can remain unavailable until the deployment job has named `production`, the permitted source has been checked, and an approval has been granted. The best production secret is not merely hidden; it is absent from every earlier job.

<!-- section-summary: An environment represents a deployment target such as staging or production and can hold its own secrets, variables, and protection rules. -->

A **GitHub environment** is a named deployment target, such as `staging`, `production`, or `customer-demo`. A job targets an environment with the `environment` key. Environment-level secrets and variables become available only to jobs that target that environment.

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: ./scripts/deploy.sh
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}

  deploy-production:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: ./scripts/deploy.sh
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

The same secret name can exist in both environments with different values. The staging job receives the staging value. The production job receives the production value. The workflow code stays the same while the environment decides which sensitive value appears.

This is powerful because test and lint jobs can run with no deployment environment at all. They can read the repository, install dependencies, and run checks without touching staging or production credentials. The deployment jobs then opt into the environment that matches their target.

Environments also create a place for deployment controls. Credentials answer "what can this job use?" Protection rules answer "when is this job allowed to start?" Together, they separate access from approval.

### How protection rules delay a job
<!-- section-summary: Protection rules add human approval, wait timers, branch restrictions, and custom checks before a deployment job receives environment access. -->

**Protection rules** are checks that must pass before a job can proceed into an environment. For production deployments, the most common rule is a required reviewer. GitHub pauses the job, shows the pending deployment, and waits for an approved reviewer before the job can continue.

This is useful because workflow automation moves fast. A merge to `main` might be safe for staging, while production needs a release manager or service owner to confirm timing. The environment gives that approval a natural home.

Protection rules can include required reviewers, wait timers, deployment branch rules, and custom protection rules depending on repository plan and configuration. A wait timer can create a deliberate delay before deployment. A branch rule can allow production deployments only from `main` or release branches. A custom protection rule can call an external system for change management or incident checks.

The workflow file stays simple. The repository settings hold the approval behavior, and the YAML still shows which job targets production.

```yaml
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy-production.sh
```

The approval behavior lives in the repository environment settings. That separation is helpful because the release process can be governed without hiding important deployment code inside the settings page.

A required reviewer performs human authorization: the workflow asks to enter production, and a permitted person decides whether this specific deployment may proceed now. A branch or tag restriction answers a different question: which source identities may request production at all. A wait timer introduces time between authorization and execution. A custom protection rule lets an external policy system participate.

These controls are complementary. A reviewer should not have to compensate for a workflow triggered from an arbitrary branch, and a trusted branch does not prove that the current time is operationally safe. Environment rules create a boundary before environment secrets are released and before the deployment step begins.

Credentials and approvals now have a shape. The next built-in credential to understand is the token GitHub gives each workflow run.

## How Should GITHUB_TOKEN Be Narrowed?
<!-- section-summary: GITHUB_TOKEN is the workflow's built-in GitHub credential, and the `permissions` key should narrow what each workflow or job can do with it. -->

`GITHUB_TOKEN` is a GitHub-provided token available to workflows for calling GitHub APIs and performing repository operations. It lets a workflow do things like read repository contents, write pull request comments, upload security results, create releases, or publish packages, depending on permissions.

The important control is the `permissions` key. It can be set at workflow level or job level. A workflow that only reads code should ask for read access. A job that uploads security results can ask for `security-events: write`. A deployment job that needs OIDC can ask for `id-token: write`, which we will cover soon.

```yaml
name: Pull Request Checks

on: pull_request

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

This workflow gives the token read access to repository contents and avoids broader write access. That is a good default for test jobs.

For a job that needs to publish a package, permissions can be scoped at the job. That keeps write access beside the job that actually needs it.

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Job-level permissions make review easier because the sensitive capability appears beside the job that uses it. They also stop one broad workflow-level permission from silently applying to every job.

Long-lived external secrets can still remain a problem. For cloud deployments, OpenID Connect gives a better pattern.

`GITHUB_TOKEN` and an external cloud credential are two different identity systems. The GitHub token controls operations inside GitHub, such as reading contents or publishing a package. An AWS role session controls AWS APIs. A job may need `contents: read` to check out code and a separate temporary AWS identity to update one service. Narrow both independently.

If no `permissions` block is declared, behavior can depend on repository defaults and GitHub's permission calculations. An explicit block makes the contract visible in review. Start from the minimum—often `contents: read`—then add a write capability only beside the job that uses it. A security-report job may need `security-events: write`; that does not mean its test sibling needs the same permission.

## How Do OIDC and AWS Policies Replace a Shared Cloud Key?
<!-- section-summary: OpenID Connect lets a workflow request a short-lived identity token so a cloud provider can issue temporary credentials without storing static cloud keys in GitHub. -->

**OpenID Connect**, often shortened to **OIDC**, is an identity protocol that lets GitHub prove facts about a workflow run to an external cloud provider. Instead of storing a long-lived AWS access key in GitHub secrets, the workflow requests a short-lived OIDC token from GitHub. The cloud provider validates that token and then issues temporary cloud credentials for the allowed role.

The flow has three parts. First, the workflow asks GitHub for an OIDC token. Second, the cloud provider verifies the token issuer, audience, repository, branch, environment, and other claims. Third, the cloud provider returns temporary credentials if the claims match a trusted role.

![OIDC deployment session showing workflow job, id-token permission, OIDC token, trust policy, claims match, short-lived role, and production deploy](/content-assets/articles/article-cicd-github-actions-environments-and-security/oidc-deployment-session.png)

*OIDC moves cloud access from a stored static key to a short-lived role session that exists only after the workflow identity matches the cloud trust policy.*

This changes the credential problem. A leaked static cloud key can work until someone rotates or deletes it. A temporary credential from OIDC expires. The cloud role can also require that the token came from a specific repository, branch, pull request, tag, or environment.

For `node-service`, the production deployment can use OIDC so GitHub stores no AWS access key. GitHub stores workflow code and environment rules. AWS stores the trust policy that decides which GitHub workflow runs can assume the deployment role.

The trust policy is where the cloud provider decides whether the GitHub identity is acceptable. That makes it one of the most important security documents in the deployment path.

An OIDC token is a signed identity document, usually a JSON Web Token. Its claims describe facts about the workload: the issuer is GitHub's token service, the audience identifies the intended recipient, and the subject describes a repository plus a branch, tag, pull request, or environment context. The signature lets AWS verify that GitHub issued the document and that its claims were not altered.

Follow the physical flow. The job receives permission to request an identity token. It asks GitHub's OIDC endpoint for a token with the expected audience. GitHub creates and signs the short-lived token from facts about this run. The AWS credentials action sends it to AWS Security Token Service. AWS validates the issuer, signature, audience, subject, and IAM trust conditions. Only then does STS return temporary role credentials to the runner. The deploy command uses that short-lived role session, and it expires after the session lifetime.

No shared AWS password crosses this path. The durable configuration is trust: GitHub knows how to describe the run, and AWS knows which descriptions it will accept.

<!-- section-summary: AWS trust policies should check the GitHub OIDC audience and subject so only the intended repository, branch, tag, or environment can assume the role. -->

In AWS, OIDC-based deployment usually means a GitHub workflow assumes an IAM role through AWS Security Token Service. The IAM role has a **trust policy**. A trust policy says who can assume the role and under which conditions.

For GitHub Actions, the trust policy should check the token audience and subject. The audience for the official AWS action is commonly `sts.amazonaws.com`. The subject, usually called `sub`, identifies the GitHub repository and the trusted context, such as a branch or environment.

Here is a simplified trust policy for a production deployment role. The account number, repository name, and role name are examples, but the condition shape is the important part.

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
          "token.actions.githubusercontent.com:sub": "repo:my-org/node-service:environment:production"
        }
      }
    }
  ]
}
```

This policy trusts tokens from the GitHub OIDC provider only when the audience and subject match the expected values. The `sub` value ties the role to the `my-org/node-service` repository and the `production` environment. A different repository or environment would produce a different subject and fail this trust check.

The role also needs permission policies that describe what it can do after assumption. A deployment role might update one ECS service, read one container registry path, or modify one CloudFormation stack. The trust policy controls who can assume the role. The permission policy controls what the assumed role can do.

This difference is easy to miss. The role's **trust policy** answers “may this external identity become the role?” Its conditions might accept only `repo:my-org/node-service:environment:production`. The role's **permissions policy** answers “after assumption, which AWS operations and resources may the role use?” It might allow one `ecs:UpdateService` action against one production service.

Authentication and authorization therefore happen in stages. The signed OIDC token authenticates the workload—who it is. The trust policy authorizes that workload to assume a role. The permissions policy authorizes the resulting role session to perform specific cloud operations. A precise trust policy paired with an administrator permission policy is still dangerous; a broad trust policy paired with narrow permissions still lets too many workloads receive those permissions. Both sides must be narrow.

The workflow side has one small but important permission setting. Without it, the job cannot request the OIDC token.

## How Do id-token write, Environments, and OIDC Form One Authority Chain?
<!-- section-summary: A workflow job must grant `id-token: write` before it can request an OIDC token from GitHub. -->

The `id-token: write` permission allows a job to request an OIDC token from GitHub. The wording can look surprising because it says `write`, but it means the job can request a signed identity token. It does not grant write access to the repository by itself.

Here is the workflow shape for AWS. The job asks GitHub for an OIDC token, and the AWS action exchanges it for temporary role credentials.

```yaml
name: Production Deploy

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/node-service-production-deploy
          aws-region: us-east-1
      - run: ./scripts/deploy-production.sh
```

The job targets the `production` environment, so environment protection rules can pause it before deployment. The job grants `id-token: write`, so the AWS credentials action can request the OIDC token. AWS validates the token against the role trust policy, then returns temporary credentials for the deploy script.

The workflow now stores no AWS access key. The long-lived trust lives in AWS IAM, and the short-lived credential appears only during the job.

`id-token: write` is deliberately narrow. It allows the job to ask GitHub to mint an OIDC identity token; it does not grant repository write permission, cloud permission, or the ability to assume any role by itself. The external provider still has to accept the token under its trust rules.

Production jobs commonly need both `contents: read` and `id-token: write` because the permissions solve different needs. Checkout uses GitHub repository authority. The credential action uses workload-identity authority. AWS then decides whether that identity may become the role.

<!-- section-summary: An environment delays the job until deployment policy passes, and its name can become an OIDC identity claim that the cloud trust policy verifies. -->

Environments and OIDC fit together because the environment can influence both **when** authority appears and **which identity** AWS sees. A job first requests the `production` environment. GitHub applies branch rules, required reviewers, timers, or custom checks. Only after those controls pass does the job proceed and gain access to environment-scoped data.

When the OIDC subject is environment-based, GitHub can describe the authorized job as:

```text
repo:my-org/node-service:environment:production
```

AWS can require that exact subject. The authority chain becomes compositional:

```text
trusted workflow trigger
  -> production environment requested
  -> source restriction and human approval pass
  -> job may request an OIDC token
  -> token proves repository and production environment
  -> AWS trust policy accepts that identity
  -> role permission policy allows a narrow deployment
```

No single check carries the whole design. The environment authorizes the GitHub deployment boundary. OIDC proves the resulting workload identity. IAM trust authorizes role assumption. IAM permissions bound the cloud actions. Each layer answers a different question.

This also explains why a GitHub branch restriction and an AWS subject condition are not redundant. One governs the workflow before it executes privileged steps. The other is an independent cloud-side check that still applies if the workflow YAML is changed incorrectly. Defense in depth means a mistake in one control does not automatically erase every other control.

Now we can combine secrets, environments, approvals, token permissions, and OIDC into one safer deployment shape. The goal is to make each job's access match its real responsibility.

## How Do Build Separation, Pull Requests, and Third-Party Actions Change Trust?
<!-- section-summary: A safer deployment separates validation, staging, and production jobs while keeping credentials scoped to the job and environment that needs them. -->

A practical `node-service` delivery flow has three different access levels. Pull request checks need repository read access and no deployment credentials. Staging deployment needs staging access after code reaches `main`. Production deployment needs approval, a protected environment, and temporary cloud credentials.

That separation might look like this. The same workflow can test every push while reserving production access for a manual, protected path.

```yaml
name: Delivery

on:
  push:
    branches:
      - main
  workflow_dispatch:
    inputs:
      production:
        description: "Deploy production"
        required: true
        type: boolean

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm test

  deploy-staging:
    needs: test
    if: ${{ github.event_name == 'push' }}
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/node-service-staging-deploy
          aws-region: us-east-1
      - run: ./scripts/deploy-staging.sh

  deploy-production:
    needs: test
    if: ${{ github.event_name == 'workflow_dispatch' && inputs.production }}
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: node-service-production
      cancel-in-progress: false
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/node-service-production-deploy
          aws-region: us-east-1
      - run: ./scripts/deploy-production.sh
```

The test job has no cloud identity. The staging job can assume only the staging role. The production job uses the production environment, which can require reviewers and branch rules. Production also has a concurrency group so two production deployments do not overlap.

This shape gives each job a smaller blast radius. A failing test job cannot deploy. A staging role cannot change production. A production deployment waits for the environment rules before it receives the credentials it needs.

Build and deployment authority should be separate even when the same workflow contains both. The build job executes dependency installation, tests, compilers, and other code from the repository. It usually needs read-only GitHub access and permission to publish an artifact or image, not production cloud access. The deployment job consumes the already-produced output and receives production authority only after its own boundary checks.

This creates several independent checks: the trigger chooses candidate code; tests and build verify it; the environment restricts source and timing; reviewers authorize the specific deployment; `permissions` narrows GitHub and OIDC capabilities; the AWS trust policy checks workload identity; and the role permission policy restricts production operations. A production credential is never present while arbitrary build scripts are still running.

Long-lived credentials are the wrong default when the external service supports workload federation. Static keys must be distributed, rotated, revoked, detected when leaked, and protected for their entire lifetime. OIDC replaces that shared password with a short-lived identity proof and temporary session. Stored secrets still remain appropriate for systems that cannot federate, such as a legacy vendor password, signing material, an npm token, or a database password. Use federation where possible and the smallest secret scope where necessary.

<!-- section-summary: Untrusted pull-request code and third-party actions must never inherit privileged credentials merely because they execute inside a familiar workflow. -->

A pull request from a fork makes the first principle visible. The contributor controls the proposed code, including package scripts and test behavior. If GitHub gave that code production secrets, the contributor could change the test command to transmit them. GitHub therefore withholds normal Actions secrets from fork-triggered pull request workflows and generally reduces `GITHUB_TOKEN` to read-only in that context; Dependabot pull requests receive similar restrictions.

The general rule matters more than memorizing event names: do not check out and execute untrusted pull-request code in a job that already possesses privileged tokens, environment secrets, or cloud credentials. If the code owner is “an external contributor” and the job authority is “production,” the boundary is unsafe regardless of how tidy the YAML looks.

Third-party actions belong in the same threat model. `uses: random-person/deploy-helper@main` means “download somebody else's program and execute it on this runner.” If the runner has a GitHub token, OIDC-derived AWS credentials, or environment secrets, that program has an opportunity to use them. Production workflows should prefer trusted publishers, restrict allowed actions where appropriate, give the job minimal permissions, and pin sensitive external actions to immutable commit SHAs.

Dependency installation is another supply-chain boundary. A harmless-looking `npm ci` may execute lifecycle hooks from packages or the repository. Keep production identity out of build jobs so a compromised dependency cannot inherit deployment authority merely because the build precedes deployment.

## How Do Code, Identity, Permission, and Boundary Explain Security?
<!-- section-summary: Four questions reveal most workflow security failures: whose code runs, which identity it gets, what that identity can do, and what boundary delays it. -->

Review a security-sensitive workflow along four axes:

| Axis | Question | Examples |
|---|---|---|
| Code | Whose program is executing? | Trusted main branch, forked PR, dependency hook, third-party action |
| Identity | Which credentials can the job obtain? | `GITHUB_TOKEN`, stored secret, OIDC token, AWS role session |
| Permission | What authority follows from those identities? | `contents: read`, `packages: write`, one ECS update, broad administrator access |
| Boundary | What must happen before privileged identity appears? | Successful build, branch rule, environment approval, IAM trust condition |

Most failures are a dangerous combination across those axes: untrusted code receives a powerful identity, a trusted identity has excessive permission, or production authority appears before any meaningful boundary. The table turns “is this secure?” into concrete questions a reviewer can answer.

It also keeps authentication separate from authorization. OIDC authenticates the workload by proving claims. An IAM trust policy authorizes that identity to become a role. The permissions policy authorizes what the assumed role may do. GitHub environment review provides an earlier human authorization decision. These are layers in one authority system, not interchangeable security features.

## How Does the Complete Production Flow Fit Together?
<!-- section-summary: GitHub Actions security works best when secrets, environments, token permissions, and cloud trust policies each control one clear part of the deployment path. -->

The full security picture connects the whole GitHub Actions module. Each earlier topic controls one part of the final deployment path.

**Workflows and events** decide when automation starts. Pull request checks can run early with low permissions. Deployment workflows can start from trusted branches, tags, manual input, or release processes.

**Runners** decide where code executes. Ordinary checks can use GitHub-hosted runners. Jobs that need private network access can use carefully scoped self-hosted runners. The runner choice should match the job's real access needs.

**Actions and reusable workflows** decide how logic is shared. Shared deployment workflows can standardize permissions, environments, and cloud authentication while service repositories keep their own service names and release inputs.

**Secrets and environments** decide when sensitive values appear. Repository secrets fit narrow repository-only needs. Environment secrets and protection rules fit staging and production. Approval gates belong close to the environment that needs protection.

**`GITHUB_TOKEN` permissions and OIDC** decide how jobs authenticate. The `permissions` key narrows GitHub access. OIDC lets cloud providers issue temporary credentials based on verified workflow identity, which removes the need to store long-lived cloud keys in GitHub for modern cloud deployments.

For `node-service`, the secure path is now clear. Pull requests run with read access. Shared workflows keep policy consistent. Staging and production use separate environments. Production waits for approval. AWS trusts only the expected repository and environment. The workflow receives temporary credentials only during the deployment job.

That is the practical goal of GitHub Actions security: small access, clear approval points, temporary credentials, and workflow files that a teammate can review without guessing where the dangerous parts are hidden. A secure pipeline should feel understandable in code review, not magical.

Follow one production release end to end. A commit reaches `main` and triggers a workflow. A low-authority build job checks out, tests, and produces an immutable artifact or image. The deployment job requests `environment: production`. GitHub verifies the permitted source and pauses for the required review. The authorized job receives `contents: read` and `id-token: write`, requests a signed token describing the repository and environment, and presents it to AWS STS. AWS checks the role trust policy and returns temporary credentials. The runner uses that role to perform only the operations allowed by its permission policy.

```text
commit on main
  -> build with read-only GitHub authority
  -> tested artifact or image
  -> production environment request
  -> source rule and reviewer approval
  -> GitHub OIDC identity token
  -> AWS trust-policy check
  -> temporary deployment role
  -> narrowly permitted production change
```

Notice what the flow omits: permanent `AWS_ACCESS_KEY_ID`, permanent `AWS_SECRET_ACCESS_KEY`, production credentials in test jobs, and an unrestricted GitHub token. The durable pieces are policy and trust; the powerful credential is created late and expires quickly.

The deepest model is an authority chain. Workflow code starts with little authority. `GITHUB_TOKEN` supplies narrow GitHub authority. An environment supplies deployment authorization. OIDC supplies a signed workload identity. IAM trust decides whether that identity may become a role. IAM permissions decide what the role can do. Secure design makes every transition explicit and as narrow as possible.

![Safer GitHub Actions deployment shape showing pull request checks, minimal token, protected environment, human approval, OIDC role, deploy, and audit trail](/content-assets/articles/article-cicd-github-actions-environments-and-security/safer-deployment-shape.png)

*The safer deployment shape keeps ordinary checks low privilege, puts production behind an environment approval, and uses OIDC so cloud credentials stay temporary and auditable.*

## Check Your Answers

:::expand[Why Is a Workflow an Arbitrary-Code Security Boundary?]{kind="recap"}
Workflow steps, repository scripts, dependency hooks, and actions are executable programs. If a credential reaches their runner, assume they can use or exfiltrate it. A credential is portable authority, so security must control its scope, release time, lifetime, and permissions.
:::

:::expand[How Do Secret Scopes, Environments, and Protection Rules Delay Authority?]{kind="recap"}
Secrets protect sensitive values before runtime; they cannot protect a value from code after release. Repository, organization, and environment scope limit who can request it. Environment secrets delay production authority until the targeted job passes the environment boundary.

An environment names a deployment target and can own secrets, variables, reviewers, source restrictions, timers, and custom checks. Reviewers authorize this deployment now, while branch or tag rules determine which code may request the environment at all.
:::

:::expand[How Should GITHUB_TOKEN Be Narrowed?]{kind="recap"}
`GITHUB_TOKEN` is the job's GitHub identity, not its cloud identity. Declare explicit workflow or job permissions, start with read-only access, and grant a write capability only to the job that uses it. External credentials must be scoped independently.
:::

:::expand[How Do OIDC and AWS Policies Replace a Shared Cloud Key?]{kind="recap"}
GitHub signs a short-lived token containing workload identity claims. AWS validates its issuer, audience, subject, signature, and trust conditions, then returns a temporary role session. The job proves who it is instead of presenting a permanent shared AWS password.

The trust policy decides which external identity may assume the role. The permissions policy decides which AWS actions and resources the assumed role may use. Narrow identity conditions and narrow operational permissions are both necessary.
:::

:::expand[How Do id-token write, Environments, and OIDC Form One Authority Chain?]{kind="recap"}
`id-token: write` lets a job request a GitHub OIDC identity token. It does not grant repository write access or cloud permission. The external provider must still accept the token, and the job often also needs `contents: read` for checkout.

The environment delays the job until deployment rules pass, then its name can appear in the OIDC subject. AWS can trust only that repository-and-environment identity. GitHub authorization, identity proof, IAM trust, and IAM permissions therefore reinforce one another.
:::

:::expand[How Do Build Separation, Pull Requests, and Third-Party Actions Change Trust?]{kind="recap"}
Build jobs execute broad repository and dependency code, so they should have no production authority. A later deployment job consumes the verified output and receives temporary production identity only after its own trigger, environment, permission, trust, and approval checks.

Fork contributors control proposed code, and third-party actions supply external programs. Never execute untrusted code in a job holding privileged credentials. Restrict action sources, pin sensitive actions immutably, and keep secrets and deployment identity out of untrusted pull-request jobs.
:::

:::expand[How Do Code, Identity, Permission, and Boundary Explain Security?]{kind="recap"}
Ask whose code runs, which identity it can obtain, what that identity can do, and what boundary delays privileged access. Then separate authentication from authorization: OIDC proves identity, trust permits role assumption, and role policy permits operations.
:::

:::expand[How Does the Complete Production Flow Fit Together?]{kind="recap"}
A low-authority job builds a tested output. A protected environment authorizes deployment. GitHub issues an OIDC token, AWS accepts the exact identity, and STS returns a temporary narrowly permitted role. Production credentials never appear in ordinary test work.
:::

## References

- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) - Documents repository, environment, and organization secrets, plus important limits around secret availability.
- [Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) - Explains environments, environment secrets, variables, required reviewers, wait timers, and deployment branch rules.
- [Use GITHUB_TOKEN for authentication in workflows](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) - Explains the built-in token and how to modify workflow or job permissions.
- [OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Introduces GitHub Actions OIDC and the short-lived token flow for external services.
- [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc) - Documents OIDC claims, subject formats, and the required `id-token: write` permission.
- [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) - Shows AWS-specific OIDC setup, IAM trust policy patterns, and the `configure-aws-credentials` workflow shape.

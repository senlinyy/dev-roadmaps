---
title: "Securing CI/CD Runners"
description: "Separate untrusted workflow code from trusted deployment machines, secrets, caches, artifacts, and private networks."
overview: "A CI/CD runner is the machine that executes pipeline jobs. This article follows Summit Retail's checkout-api pipeline through runner trust, hosted and self-hosted choices, pull request isolation, runner groups, clean environments, cache and artifact handling, network exposure, and a practical hardening checklist."
tags: ["devsecops", "ci-cd", "runners", "isolation"]
order: 1
id: article-devsecops-pipeline-security-securing-cicd-runners
---

## Table of Contents

1. [What a Runner Does](#what-a-runner-does)
2. [Why Runner Trust Matters](#why-runner-trust-matters)
3. [Hosted and Self-Hosted Runners](#hosted-and-self-hosted-runners)
4. [Untrusted Pull Request Workflows](#untrusted-pull-request-workflows)
5. [Runner Groups, Labels, and Job Routing](#runner-groups-labels-and-job-routing)
6. [Ephemeral and Clean Runner Patterns](#ephemeral-and-clean-runner-patterns)
7. [Caches, Artifacts, and Workspaces](#caches-artifacts-and-workspaces)
8. [Network and Secret Exposure](#network-and-secret-exposure)
9. [A Practical Runner Hardening Checklist](#a-practical-runner-hardening-checklist)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What a Runner Does
<!-- section-summary: A runner is the machine that receives a pipeline job, checks out code, and runs the commands written in the workflow. -->

A **runner** is the computer that executes a CI/CD job. The CI/CD platform decides that a job is ready to run, then the runner downloads the job instructions, prepares a workspace, checks out the repository, and runs each step. In GitHub Actions the machine is called a runner, in GitLab the same idea usually appears as a GitLab Runner, and in Jenkins the worker machines are usually called agents.

For Summit Retail, picture a service called `checkout-api`. It receives cart data, calls a payment provider, creates an order record, and returns the checkout result to the frontend. Every pull request to that repository runs tests, and every merge to `main` builds a container image for deployment. Those tasks sound harmless until you remember that tests, build scripts, package install hooks, Docker builds, and deployment commands all run real code on the runner.

Here is a small GitHub Actions workflow for `checkout-api`:

```yaml
name: checkout-api ci

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test -- --runInBand
```

The `runs-on: ubuntu-latest` line tells GitHub Actions which runner type runs the job. The `steps` are the work the runner performs. The runner checks out the source code, prepares Node.js, installs dependencies, and runs the test command. If a package has an install script, that script also runs on the runner during `npm ci`.

That last detail matters. A runner sits inside the production delivery system because it executes build and release code. Once we see the runner as a machine executing repository code, the next question is simple: which code deserves to run on which machine?

## Why Runner Trust Matters
<!-- section-summary: Runner trust matters because workflow code can read local files, call networks, write caches, and reach any secret exposed to the job. -->

**Runner trust** means how much sensitive access the runner has and how much we trust the code that will run on it. A runner with no secrets, no private network route, and a short-lived workspace has a small blast radius. A runner with production deploy credentials, a route to internal databases, and a persistent disk has a much larger blast radius.

The important idea is **workflow code execution**. The workflow file is code. The repository scripts are code. Third-party actions are code. Dependency install scripts are code. If Summit Retail lets a pull request run `npm ci`, then the pull request controls part of what executes, because it can change `package.json`, `package-lock.json`, test files, and build scripts.

Imagine someone opens a pull request to `checkout-api` that looks like a small coupon bug fix. Hidden inside the change is a new `postinstall` script that prints environment variables and sends them to a server on the internet. If the job has no secrets and no private network access, the damage is limited. If the same job runs on a self-hosted runner inside Summit Retail's network with deployment credentials available, the attacker has a path to secrets and internal systems.

This is why teams talk about a **trust boundary** around runners. A trust boundary is the line between code and systems with different levels of trust. External pull request code sits on the low-trust side. Main branch deployment jobs sit on the high-trust side. Runner security is the work of keeping those sides separated.

There is also a second problem: runners carry state. A job can write files to the workspace, populate a cache, create Docker images, change global tool configuration, or leave processes behind. If the next job lands on the same machine, that next job may inherit more than the team expected. This is where runner cleanup and ephemeral machines enter the story, but first we need to separate the two main runner types.

![Runner trust boundary showing untrusted pull request code limited to low-trust hosted runners while reviewed main-branch deploys use trusted runners with secrets and private network access](/content-assets/articles/article-devsecops-pipeline-security-securing-cicd-runners/runner-trust-boundary.png)

*The runner boundary keeps unknown pull request code on a low-trust path, while reviewed deployment work uses the runner tier that can reach secrets, private networks, and production systems.*

## Hosted and Self-Hosted Runners
<!-- section-summary: Hosted runners are operated by the CI/CD provider, while self-hosted runners are machines your team owns, patches, routes, and cleans. -->

A **hosted runner** is a runner operated by the CI/CD provider. In GitHub Actions, GitHub-hosted runners run on GitHub-managed infrastructure with common tools preinstalled. They are a strong default for ordinary pull request checks because the platform handles machine lifecycle, base image updates, and job isolation details.

A **self-hosted runner** is a machine that your team registers with the CI/CD platform. The runner application connects back to GitHub, GitLab, or Jenkins, waits for a matching job, and runs that job on your infrastructure. The platform schedules the work, but your team owns the operating system, network route, installed tools, credential exposure, cleanup, monitoring, and patching.

Summit Retail might use both. Hosted runners work well for `checkout-api` unit tests because those tests only need the repository and public package downloads. Self-hosted runners may make sense for a deployment job that needs private access to an internal Kubernetes API, a private package mirror, or a compliance-approved network segment.

| Question | Hosted runner answer | Self-hosted runner answer |
|---|---|---|
| Who operates the machine? | The CI/CD provider operates the machine and image lifecycle. | Summit Retail operates the machine, image, network, and cleanup. |
| What is the normal use case? | Pull request checks, unit tests, linting, and ordinary builds. | Private network access, custom hardware, special tools, larger machines, or regulated deployment paths. |
| What is the security job? | Small workflow permissions and no secret exposure for untrusted events. | Build isolation, host patching, separate runner groups, controlled network egress, and residue removal. |
| What can go wrong? | A workflow may still misuse tokens, actions, caches, or artifacts. | A malicious job may reach internal systems or leave state for later jobs if the runner persists. |

Self-hosted runners deserve special care because they are often placed close to valuable systems. A runner inside the same network as the checkout database, container registry, deployment cluster, and secret manager has a strong operational reason to exist. That same placement also means any code running on the runner may try to reach those systems unless the network and credentials block it.

Hosted versus self-hosted is only the first split. The next split is about event trust. A pull request from an unknown fork and a deployment from `main` need different paths through the pipeline.

## Untrusted Pull Request Workflows
<!-- section-summary: Pull request workflows test code without giving that code secrets, write tokens, private network routes, or privileged runner access. -->

An **untrusted pull request workflow** is a workflow that runs code from a branch the team has not reviewed and accepted yet. The source may be a fork, a new branch from a contractor, or a branch from an internal engineer who made a mistake. The code may be useful, broken, or malicious, so the pipeline treats it as code that can run tests but cannot touch deployment power.

For Summit Retail, pull request checks for `checkout-api` answer questions like "Do the unit tests pass?" and "Does the Dockerfile still build?" They stay away from questions like "Can this branch deploy to staging?" or "Can this branch read production-like secrets?" Deployment belongs to trusted events after review, merge, and environment approval.

This is a reasonable pull request shape:

```yaml
name: checkout-api pull request checks

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test -- --runInBand
```

The job runs on a hosted runner, receives only read access to repository contents, and checks out the pull request code without persisting the checkout credential into the local Git config. That last setting reduces accidental token reuse by later shell commands. The workflow still runs untrusted code, so the key control is that the runner has no production secret and no direct route into Summit Retail's private deployment network.

Now compare that with a risky shape Summit Retail would remove during review:

```yaml
name: risky privileged pull request check

on:
  pull_request_target:

permissions:
  contents: write

jobs:
  test-pr-head:
    runs-on:
      group: summit-prod-deploy
      labels: checkout-api-deploy
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: npm ci
      - run: npm test
```

The `pull_request_target` event runs in the context of the base repository. Teams sometimes use it for safe metadata tasks like labeling, commenting, or checking policy files from the base branch. The danger arrives when the workflow checks out and runs the pull request head code while also using a privileged token, secrets, or a trusted self-hosted runner group.

A safer pattern is to split the work. The untrusted pull request workflow runs tests with no secrets and publishes only low-risk results, such as a test summary. A separate trusted workflow handles labels, comments, deployment decisions, or environment approvals using code from the protected base branch. That separation keeps pull request code away from the runner and token paths used for delivery.

Once untrusted pull requests have their own low-trust path, the trusted jobs still need careful routing. That is where runner groups and labels help the platform choose the right machine.

## Runner Groups, Labels, and Job Routing
<!-- section-summary: Runner groups decide which repositories can use a set of self-hosted runners, and labels describe which capabilities a job needs. -->

A **runner group** is an access grouping for self-hosted runners. In GitHub Actions, runner groups let an organization or enterprise decide which repositories can use a set of runners. A production deployment runner group might be available only to the `checkout-api` repository and a small set of release repositories.

A **runner label** is routing metadata. Labels describe a runner's operating system, architecture, toolchain, or purpose. A job asks for labels, and the CI/CD platform finds a runner with matching labels. Labels help the scheduler choose a machine with the right capability, while runner group policy and repository settings carry the access decision.

Here is how Summit Retail might route an internal staging deployment:

```yaml
name: checkout-api staging deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  deploy-staging:
    runs-on:
      group: summit-staging-deploy
      labels: checkout-api-deploy
    environment: staging
    steps:
      - uses: actions/checkout@v6
      - run: ./scripts/deploy-staging.sh
```

The group name says which pool of self-hosted runners the job may use. The label says the job needs a runner prepared for `checkout-api` deployment. The environment setting gives Summit Retail another place to attach approval rules, deployment secrets, and audit trails.

A practical group design uses trust tiers:

| Runner tier | Example group or path | Jobs allowed there |
|---|---|---|
| Pull request checks | Hosted runners only for `pull_request` jobs | Unit tests, linting, static checks, and builds with no secrets. |
| Internal builds | `summit-internal-build` | Jobs from protected branches that build images, run scanners, and publish signed build outputs. |
| Staging deployment | `summit-staging-deploy` | Main branch jobs that deploy to staging after tests and scans pass. |
| Production deployment | `summit-prod-deploy` | Approved release jobs with short-lived deployment credentials and the narrowest network route. |

GitLab and Jenkins use similar ideas with different words. GitLab Runner uses tags to match jobs to runners, and protected runners can limit execution to protected branches and tags. Jenkins agents use labels for selection, while Jenkins permissions control who can configure agents, create jobs, and access build workspaces. The industry practice is consistent: the pipeline routes work by both capability and trust level.

Groups and labels help send the job to the right place, but a self-hosted runner can still carry state from old work. The next control is the runner lifecycle itself.

![Runner routing tiers showing pull request checks, internal builds, staging deploys, and production deploys routed by group policy and labels](/content-assets/articles/article-devsecops-pipeline-security-securing-cicd-runners/runner-routing-tiers.png)

*Runner groups and labels should describe trust level and capability together, so a pull request check never lands on the same runner tier as a production deployment.*

## Ephemeral and Clean Runner Patterns
<!-- section-summary: Ephemeral runners handle one job and then disappear, which reduces the chance that files, processes, credentials, or tool changes survive into later jobs. -->

An **ephemeral runner** is a runner that accepts one job and then leaves service. The usual pattern is simple: create a fresh virtual machine or container, register it with the CI/CD platform, run one job, collect logs, deregister the runner, and destroy the machine. The next job receives a fresh machine instead of a reused workspace.

This pattern is common because build jobs can change the machine. A Docker build can leave images and layers behind. A package install can modify tool caches. A test can write files under the repository checkout. A malicious script can create a background process or modify shell startup files. An ephemeral runner throws away the whole machine after the job, so cleanup relies on platform teardown instead of only a final shell script inside the same potentially compromised job.

In GitHub Actions, a self-hosted runner can be configured for ephemeral use. A simplified registration flow for an automated runner image looks like this:

```bash
./config.sh \
  --url https://github.com/summit-retail/checkout-api \
  --token "$RUNNER_REGISTRATION_TOKEN" \
  --ephemeral \
  --unattended

./run.sh
```

In production, Summit Retail would wrap that flow in automation. A controller, image pipeline, or autoscaling system requests a fresh registration token, starts a clean runner image, runs the job, uploads runner logs, and deletes the VM or container. GitHub Actions Runner Controller scale sets, GitLab Runner autoscaling executors, and Jenkins cloud agents all support this broad production pattern.

Persistent self-hosted runners still exist in many companies. They may be used for large hardware, legacy tools, or environments where autoscaling is still being built. For those runners, cleanup needs several layers: the runner uses a dedicated operating system account, runs one job at a time, clears the workspace after every job, prunes Docker images and volumes, rotates temporary credentials, removes leftover processes, and rebuilds from a trusted image on a schedule.

Here is a cleanup step that helps with ordinary residue on a persistent Linux runner:

```yaml
- name: Clean runner residue
  if: always()
  run: |
    rm -rf "$GITHUB_WORKSPACE"/*
    rm -rf "$GITHUB_WORKSPACE"/.[!.]* "$GITHUB_WORKSPACE"/..?* || true
    docker system prune -af --volumes || true
```

This step has limits. If hostile code already controls the job, it may interfere with later steps or hide files outside the workspace. For sensitive work such as production deployment, Summit Retail's production jobs use an ephemeral runner or a VM image rebuilt after each job.

The lifecycle cleans the machine. The next issue is the data that pipelines intentionally carry from one job to another: caches, artifacts, and workspace files.

## Caches, Artifacts, and Workspaces
<!-- section-summary: Caches speed up builds, artifacts move files between jobs, and workspaces hold checked-out code, so each one needs a trust rule. -->

A **workspace** is the directory where the runner checks out the repository and runs job commands. In GitHub Actions, the path is available through `GITHUB_WORKSPACE`. In GitLab CI and Jenkins, each runner or agent has an equivalent build directory. Any file created there may influence later steps in the same job, and on persistent runners it may influence later jobs if cleanup fails.

A **cache** stores files so future jobs can reuse them. Node package caches, Maven repositories, Gradle caches, and Docker layer caches all save time. The security issue is that caches are also a way to carry data from an earlier run into a later run. If untrusted pull request code can write a cache that a trusted `main` branch job restores, the cache turns into a supply chain path.

A **build artifact** is a file uploaded from one job and downloaded later, such as a test report, compiled binary, coverage result, or deployment package. Artifacts are useful because pipelines often need to pass outputs between stages. Summit Retail treats artifacts from untrusted code as data for review rather than scripts or packages that trusted jobs execute.

For `checkout-api`, Summit Retail can keep cache keys separated by event and branch:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ github.event_name }}-${{ github.ref_name }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-${{ github.event_name }}-${{ github.ref_name }}-
```

This cache key makes pull request caches and main branch caches land in different namespaces. The hash ties the cache to the lockfile, so dependency changes create a new cache. Teams with strict trust rules often go further by allowing untrusted jobs to restore a cache while saving caches only from trusted branches.

Artifacts deserve similar handling. A pull request job may upload `coverage.xml` or `junit.xml`, and a trusted workflow can display the result or comment on the pull request. A trusted deployment workflow keeps untrusted artifacts out of shell execution, binaries, and Docker images. If Summit Retail wants to promote an artifact to staging, the artifact comes from a protected branch build with a known workflow, signed provenance, and a recorded digest.

Workspace cleanup ties the section back to runners. Hosted runners reduce workspace persistence by design, while self-hosted runners need explicit cleanup or replacement. Caches and artifacts may survive outside the runner, so the team still needs naming rules, retention limits, and trust separation even with clean machines.

The files are one side of exposure. The other side is everything the runner can reach while a job is running.

## Network and Secret Exposure
<!-- section-summary: A runner exposes whatever the job can reach: environment secrets, tokens, private APIs, package registries, cloud metadata, Docker sockets, and outbound internet. -->

A **secret** is a sensitive value injected into a job, such as an API key, webhook token, database password, or signing key. A **token** is a credential that proves the job can call an API. GitHub's `GITHUB_TOKEN`, GitLab job tokens, Jenkins credentials, cloud access tokens, and package registry tokens all give workflow code some level of authority.

Network access matters as much as secrets. If a runner has a route to a private Kubernetes API, internal package registry, payment test environment, or production database subnet, code running on that runner can try to connect. A job can cause harm without an explicit secret if the network trusts the runner's IP address or if the runner host has a privileged Docker socket mounted.

Summit Retail separates `checkout-api` runner networks by job purpose. Pull request jobs can run on hosted runners with ordinary internet access for package downloads. Internal build runners can reach the private container registry and scanner services. Production deployment runners can reach only the deployment API and the minimum support services needed for that deployment.

Secrets follow the same separation. Pull request checks receive no deployment secrets. Main branch build jobs receive only build and publish credentials. Production deployment jobs receive short-lived deployment credentials through a trusted identity flow, such as GitHub Actions OpenID Connect with a cloud provider role, rather than static cloud keys stored on the runner disk.

The job permission block stays deliberate:

```yaml
permissions:
  contents: read
  id-token: write
```

For a deployment job, `contents: read` lets the workflow read repository contents, and `id-token: write` lets the workflow request an OIDC token for cloud identity federation. The cloud provider then exchanges that token for short-lived credentials if the repository, branch, environment, and workflow claims match the trust policy. The next article covers those token boundaries in detail.

Runner network hardening looks practical in production. The runner subnet has egress rules, so jobs can reach the package registry, container registry, deployment API, and logging endpoint, while direct database routes stay closed. Cloud metadata access is restricted where possible. The Docker socket stays away from untrusted jobs because access to the host Docker socket usually gives strong control over the host.

At this point the pieces are on the table: event trust, hosted versus self-hosted runners, groups and labels, clean machines, cache boundaries, artifact rules, network routes, and secrets. The next section turns those pieces into a checklist Summit Retail can actually use.

## A Practical Runner Hardening Checklist
<!-- section-summary: Runner hardening means making sure each job runs on a machine with the minimum trust, state, network, and credentials needed for that job. -->

**Hardening** means reducing the number of ways a runner can leak secrets, keep state, or give untrusted code access to trusted systems. It is ordinary engineering work: inventory, separation, configuration, cleanup, monitoring, and review. For `checkout-api`, the checklist stays simple enough that a reviewer can apply it during workflow review.

| Control | Summit Retail practice | Healthy signal |
|---|---|---|
| Runner inventory | Each self-hosted runner group has an owner, purpose, repository allow-list, labels, base image, and network segment. | Security can answer which jobs may land on each runner group. |
| Event separation | `pull_request` jobs use hosted runners, read-only permissions, and no deployment secrets. | A forked pull request cannot reach self-hosted deploy runners. |
| Group boundaries | Production runner groups are available only to release repositories and trusted workflows. | A random repository cannot target `summit-prod-deploy`. |
| Label discipline | Labels describe capability, such as `node-22`, `docker-build`, or `checkout-api-deploy`. | Labels help routing, while access control lives in groups and repository policy. |
| Ephemeral lifecycle | Sensitive self-hosted jobs use one-job runners that deregister and disappear after completion. | A compromised job has no long-lived machine to poison for the next job. |
| Persistent cleanup | Long-lived runners clear workspaces, prune containers, kill leftover processes, rotate local temporary files, and rebuild from images regularly. | Job residue gets removed during normal runs, and rebuilds reset hidden drift. |
| Cache separation | Cache keys include event and branch context, and untrusted jobs cannot feed trusted deployment caches. | A pull request cache cannot alter a `main` branch release build. |
| Artifact rules | Trusted workflows treat untrusted artifacts as reports, while deployable artifacts come from protected branch builds. | Production deployment consumes signed or digest-recorded outputs from trusted jobs. |
| Secret exposure | Secrets are scoped by environment and job purpose, and production credentials are short-lived. | Pull request logs and runner disks contain no deploy secrets. |
| Network exposure | Runner subnets allow only required endpoints, and deployment runners lack direct database routes. | A workflow compromise cannot freely explore the internal network. |
| Workflow permissions | Each workflow declares the smallest `permissions` block that fits the job. | The default token cannot write repository contents unless the job truly needs it. |
| Logging and updates | Runner logs, version updates, image rebuilds, and security patches are part of operations. | The team can investigate a suspicious job and patch runner fleets quickly. |

A good review question for Summit Retail is: "If this job ran hostile code, what could it read, write, call, cache, or leave behind?" That question connects every row of the checklist. The answer needs to match the purpose of the job instead of the convenience of the nearest available runner.

The checklist also helps during incidents. If a suspicious pull request ran on a hosted runner with no secrets and no private route, the response can focus on repository review and logs. If it ran on a persistent self-hosted runner with network access, the response expands to runner rebuilds, cache invalidation, credential rotation, and network investigation.

## Putting It All Together
<!-- section-summary: A secure runner design routes Summit Retail's checkout-api work through separate paths for pull requests, internal builds, staging deployments, and production releases. -->

Here is the full `checkout-api` flow Summit Retail is aiming for:

![Runner hardening summary with separate trust levels, ephemeral runners, clean workspaces, separate caches, limited network paths, and runner usage audit logs](/content-assets/articles/article-devsecops-pipeline-security-securing-cicd-runners/runner-hardening-summary.png)

*The full runner design combines routing, lifecycle, cleanup, network limits, and audit evidence instead of relying on one isolated setting.*

The pull request path runs unknown code with a narrow token and no secrets. The internal build path runs trusted branch code and produces a container image with a recorded digest. The staging path uses a self-hosted runner because it needs private deployment access. The production path adds approval, short-lived credentials, a narrow network route, and an ephemeral runner lifecycle.

Notice how each runner decision follows the same question: how much do we trust the code, and what can the machine reach? Hosted runners handle low-trust tests. Self-hosted runners handle trusted jobs that need private access. Ephemeral runners handle sensitive jobs where leftover state creates unacceptable risk.

GitLab Runner and Jenkins agents follow the same design even though the configuration syntax changes. GitLab teams use protected runners, tags, job tokens, and isolated executors. Jenkins teams use agent labels, node permissions, credentials binding, folder permissions, and disposable cloud agents. The tool names change, while the delivery security goal keeps untrusted code away from the runner, token, cache, artifact path, and network route used by trusted release work.

Runner security is the foundation for the rest of pipeline security. Once Summit Retail has the right code on the right runner, the next job is controlling the tokens available inside that job.

## What's Next

Runner boundaries decide where code can execute. Token boundaries decide what that code can do after the job starts, which is why the next article moves from machines to permissions.

Next, we will look at pipeline permissions and token boundaries for `checkout-api`: `GITHUB_TOKEN` scopes, OIDC claims, environment secrets, cloud role trust policies, and the difference between a useful automation token and an overpowered one.

---

**References**

- [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - Official guidance on secure workflow use, untrusted input, `pull_request_target`, secrets, tokens, and self-hosted runner hardening.
- [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) - GitHub documentation for hosted runner behavior and runner images.
- [Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) - Official setup flow for registering self-hosted runners.
- [Using self-hosted runners in a workflow](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow) - Official syntax for targeting self-hosted runners with labels and groups.
- [Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) - GitHub reference for self-hosted runner behavior, labels, routing, and ephemeral runner options.
- [Getting started with self-hosted runners for your enterprise](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-github-actions-for-your-enterprise/getting-started-with-github-actions-for-your-enterprise/getting-started-with-self-hosted-runners-for-your-enterprise) - Enterprise guidance for runner groups, runner management, and trust tiers.
- [Using secrets in GitHub Actions](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions) - Official guidance on secrets, forked pull requests, and OIDC as a secret-reduction pattern.
- [Compromised runners](https://docs.github.com/en/actions/concepts/security/compromised-runners) - GitHub guidance on the impact of compromised runners and response considerations.
- [GitLab token security](https://docs.gitlab.com/security/tokens/) - GitLab documentation for token types, token exposure, and token handling across CI/CD.
- [GitLab Runner security](https://docs.gitlab.com/runner/security/) - GitLab Runner guidance for executor choice, runner isolation, and job security.
- [Jenkins permissions](https://www.jenkins.io/doc/book/security/access-control/permissions/) - Jenkins documentation for agent, credential, job, and administration permissions.
- [Jenkins controller isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) - Jenkins guidance for isolating the controller and handling build execution risk.

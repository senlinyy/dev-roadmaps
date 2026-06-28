---
title: "Securing CI/CD Runners"
description: "Learn how to keep untrusted pull request code away from trusted delivery runners, secrets, private networks, caches, artifacts, and workspaces."
overview: "Start with a runner as the computer that runs the recipe in a CI log, then follow Summit Retail's checkout-api through hosted runners, self-hosted runners, trust zones, untrusted pull requests, ephemeral machines, cache and artifact boundaries, network routes, secret exposure, and incident review."
tags: ["devsecops", "ci-cd", "runners", "isolation"]
order: 1
id: article-devsecops-pipeline-security-securing-cicd-runners
---

## Table of Contents

1. [A Runner Is the Computer That Runs the Recipe](#a-runner-is-the-computer-that-runs-the-recipe)
2. [One Small CI Job](#one-small-ci-job)
3. [Runner Trust Zones](#runner-trust-zones)
4. [Hosted and Self-Hosted Runners](#hosted-and-self-hosted-runners)
5. [Pull Requests Stay on the Low-Trust Path](#pull-requests-stay-on-the-low-trust-path)
6. [Runner Groups, Labels, and Job Routing](#runner-groups-labels-and-job-routing)
7. [Ephemeral Runners and Clean Workspaces](#ephemeral-runners-and-clean-workspaces)
8. [Caches, Artifacts, and Workspaces](#caches-artifacts-and-workspaces)
9. [Network and Secret Exposure](#network-and-secret-exposure)
10. [Review and Incident Checklist](#review-and-incident-checklist)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)
13. [References](#references)

## A Runner Is the Computer That Runs the Recipe
<!-- section-summary: A runner is easiest to understand as the computer that reads a CI recipe and performs each step in order. -->

Picture a recipe on a kitchen counter. The recipe says: take the ingredients out, mix them, bake them, and put the finished tray on the pickup shelf. A CI/CD workflow is very similar. The workflow file is the recipe, and the **runner** is the computer that follows the recipe.

If you have ever opened a GitHub Actions log, a GitLab pipeline log, or a Jenkins build log, you have already seen a runner at work. The log shows a machine checking out code, installing packages, running tests, building a container, uploading an artifact, or deploying a service. The platform shows the friendly web page, but a real operating system ran the commands.

Summit Retail has a service called `checkout-api`. It receives carts, validates coupons, calls a payment provider, and creates orders. A normal pull request to that service runs a test job. A merge to `main` builds a container image. A production release updates the running checkout service. Those jobs share a pipeline name and need different levels of trust.

A runner can read files in its workspace, execute scripts from the repository, download dependencies, write caches, upload artifacts, call APIs, and use any secret the job receives. That is why runner security starts with a plain question:

| Question | What it means for `checkout-api` |
|---|---|
| Which code will this runner execute? | Pull request code, reviewed `main` code, or a production release job |
| What can the runner reach? | Public internet, private registries, Kubernetes APIs, databases, or secret managers |
| What credentials are present? | Read-only repository token, package publisher token, OIDC identity, or deployment secret |
| What state can survive? | Workspace files, caches, Docker layers, build artifacts, logs, or background processes |

We will start with one small test job, then add the production controls one layer at a time.

## One Small CI Job
<!-- section-summary: A tiny test workflow shows the runner, workspace, repository code, dependency install, and test command before we add deployment risk. -->

The first safe version of the `checkout-api` pipeline runs pull request tests for reviewers. It executes code from the proposed change and reports whether the test suite passed.

Here is the skeleton:

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

The `on.pull_request` block says this workflow runs when someone opens or updates a pull request against `main`. The `runs-on: ubuntu-latest` line asks GitHub Actions for a hosted Linux runner. `actions/checkout` copies the repository into the runner workspace. `npm ci` installs dependencies from the lockfile. `npm test` runs the test command defined by the project.

A beginner usually reads this as a test script. In production, this is also **code execution on a machine**. The pull request can change test files, build scripts, dependency versions, and sometimes package install hooks. If the job installs dependencies, then package lifecycle scripts may run on the runner during the install.

Now add the first permission boundary:

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test -- --runInBand
```

`permissions.contents: read` gives the job only repository read access through `GITHUB_TOKEN`. `persist-credentials: false` tells `actions/checkout` to avoid leaving the token in the local Git configuration for later shell commands. `actions/setup-node` installs Node.js and enables npm caching. `npm test -- --runInBand` asks the test runner to run tests in one process, which often makes CI logs easier to read for a small service.

That small job gives us the first rule for runners: **the more unknown the code is, the less the runner should be able to reach**. The next section turns that rule into trust zones.

## Runner Trust Zones
<!-- section-summary: Runner trust zones separate unreviewed code, reviewed builds, and approved deployments so each job lands on a machine with matching access. -->

A **trust zone** is a practical boundary around code, credentials, network access, and machine state. Pull request code sits in a low-trust zone because the team has not accepted it yet. Reviewed `main` code sits in a higher-trust zone because it passed review and required checks. Production deployment sits in the highest-trust zone because it can change what customers use.

For `checkout-api`, Summit Retail uses three zones:

| Zone | Example job | Runner access |
|---|---|---|
| Pull request checks | Unit tests and linting | Hosted runner, read-only token, no deployment secrets, no private network route |
| Internal builds | Build image after merge to `main` | Trusted build runner, package publishing permission, scanner access, no production deploy route |
| Deployment jobs | Staging and production deploys | Deployment runner, environment gate, short-lived cloud identity, narrow network route |

The dangerous design puts every job on one powerful runner pool. That runner can reach the private registry, the deployment cluster, the package mirror, and maybe the database subnet. If a forked pull request lands on that machine, the pull request code can probe everything the machine can reach.

A safer design keeps the first pull request job boring. The runner can fetch public packages, run tests, and upload a test result. The build job gets package publishing permission only after the change reaches `main`. The deployment job gets private network access only after the production environment gate has approved the job.

![Runner trust boundary showing untrusted pull request code limited to low-trust hosted runners while reviewed main-branch deploys use trusted runners with secrets and private network access](/content-assets/articles/article-devsecops-pipeline-security-securing-cicd-runners/runner-trust-boundary.png)

*The runner boundary keeps unknown pull request code on a low-trust path, while reviewed deployment work uses the runner tier that can reach secrets, private networks, and production systems.*

This split also helps during incidents. If a suspicious pull request ran only on a hosted runner with no secrets and no private route, the response is much smaller. If the same pull request ran on a persistent self-hosted runner inside the deployment network, the response includes runner rebuilds, cache review, credential rotation, and network log review.

The first design choice inside those zones is where the runner comes from.

## Hosted and Self-Hosted Runners
<!-- section-summary: Hosted runners are provider-operated machines, while self-hosted runners are machines your team owns, patches, routes, observes, and cleans. -->

A **hosted runner** is provided by the CI/CD platform. GitHub-hosted runners, GitLab SaaS shared runners, and similar managed worker pools give teams fresh machines with common tools already installed. They are a strong default for pull request tests because the platform handles a large part of the machine lifecycle.

A **self-hosted runner** is a machine your team registers with the CI/CD platform. The platform sends jobs to it, but your team owns the operating system, base image, patching, installed tools, network route, credentials, logs, cleanup, and rebuild process. In Jenkins, the same idea usually appears as agents connected to a controller.

Summit Retail uses hosted runners for ordinary `checkout-api` pull request checks. Those jobs need source code, npm packages, and test output. Summit uses self-hosted runners only where there is a clear reason: private package mirrors, internal scanners, special hardware, large builds, staging deployment, or production deployment.

| Question | Hosted runner | Self-hosted runner |
|---|---|---|
| Who operates the machine? | CI/CD provider | Summit Retail |
| Common use | Pull request tests, linting, simple builds | Private network access, custom tooling, regulated deployment |
| Main review area | Workflow permissions, event trust, secrets | OS patching, runner groups, network route, cleanup, monitoring |
| Common failure | Broad token in a low-trust job | Untrusted code reaching internal systems or leaving residue |

Self-hosted runners need extra attention because teams often place them close to valuable systems. A runner that can reach an internal Kubernetes API or private artifact registry can be useful. That same route also gives repository code a path toward those systems unless network policy and job identity block it.

GitLab and Jenkins use different words, but the design is the same. GitLab runners can use tags and protected-runner settings to control which jobs land on sensitive runners. Jenkins agents use labels and controller permissions, while credentials binding controls which secrets a stage can receive. The tool names change, and the trust question stays the same: **which job may run on this machine, and what can that machine reach?**

The highest-risk event for most repositories is the pull request. That is where the next control lands.

## Pull Requests Stay on the Low-Trust Path
<!-- section-summary: Pull request workflows should run tests without deployment secrets, write tokens, privileged self-hosted runners, or private network access. -->

An **untrusted pull request workflow** runs code before the team has accepted that code into the protected branch. The author may be a teammate, a contractor, a bot, or an external contributor from a fork. The code may be helpful, broken, or hostile, so the runner path has to assume the code can try to read anything the job exposes.

Summit's pull request job stays on a hosted runner with read-only repository access:

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read
  pull-requests: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test -- --runInBand
```

`pull-requests: read` lets the job read pull request metadata if a test helper needs it. The job still avoids package publishing, deployment identity, production secrets, and self-hosted deployment runners. The `npm` commands run the repository's install and test path, so they belong in the low-trust zone.

Now compare a risky pull request workflow:

```yaml
name: risky pull request workflow

on:
  pull_request_target:

permissions:
  contents: write
  id-token: write

jobs:
  test-pr-head:
    runs-on:
      group: summit-prod-deploy
      labels: checkout-api-deploy
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: npm ci
      - run: npm test
```

`pull_request_target` runs in the context of the base repository. That event can be useful for safe metadata work, such as applying labels from trusted workflow code. The risk arrives when the workflow checks out the pull request head commit and runs it with a write token, OIDC permission, or privileged self-hosted runner. The pull request code then executes in a context designed for trusted automation.

Summit splits those jobs. Pull request tests run on the low-trust path. Trusted metadata automation runs from the protected base branch and avoids executing pull request code. Package publishing runs after merge. Deployment runs after the environment gate. That separation keeps the pull request from borrowing the runner and identity used for delivery.

Once the events are separated, Summit still has to route trusted jobs to the correct self-hosted runner pool.

## Runner Groups, Labels, and Job Routing
<!-- section-summary: Runner groups carry access boundaries, labels describe capabilities, and jobs should request both deliberately. -->

A **runner group** controls which repositories can use a set of self-hosted runners. In GitHub Actions, organization and enterprise runner groups can restrict a runner pool to selected repositories. A production deployment group should be available only to repositories that actually deploy through that path.

A **runner label** describes a runner's capabilities. Labels can name an operating system, architecture, toolchain, hardware feature, or purpose. Labels help the scheduler find a runner that can perform the job. Groups carry the access boundary; labels carry the capability hint.

Here is a staging deployment job for `checkout-api`:

```yaml
name: checkout-api staging deploy

on:
  push:
    branches:
      - main

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
      - uses: actions/checkout@v4
      - run: ./scripts/deploy-staging.sh
```

The `group` value routes the job to the staging deployment runner pool. The `labels` value asks for a runner prepared for `checkout-api` deployment. The job declares `environment: staging`, so environment-level rules and secrets apply to that deployment target. The script `./scripts/deploy-staging.sh` should be reviewed like release code because it is the command that changes the staging service.

Summit keeps runner tiers visible in repository review:

| Tier | Routing | Jobs allowed |
|---|---|---|
| Pull request checks | Hosted runner | Unit tests, linting, static checks, no secrets |
| Internal builds | `summit-internal-build` group | Protected branch builds, image publishing, scanner access |
| Staging deploys | `summit-staging-deploy` group | Main branch deployments to staging |
| Production deploys | `summit-prod-deploy` group | Approved production deployments with short-lived credentials |

![Runner routing tiers showing pull request checks, internal builds, staging deploys, and production deploys routed by group policy and labels](/content-assets/articles/article-devsecops-pipeline-security-securing-cicd-runners/runner-routing-tiers.png)

*Runner groups and labels should describe trust level and capability together, so a pull request check never lands on the same runner tier as a production deployment.*

Routing solves placement. The next problem is residue. A job can leave files, containers, tools, caches, and processes behind on a machine.

## Ephemeral Runners and Clean Workspaces
<!-- section-summary: Ephemeral runners accept one job and then disappear, which limits leftover files, processes, credentials, and tool changes. -->

An **ephemeral runner** accepts one job and then leaves service. The usual lifecycle is: create a fresh VM or container, register the runner, run one job, upload logs, deregister the runner, and destroy the machine. The next job starts with a different machine.

This pattern is useful because build jobs can change their host. A test can write files outside the checkout. A package install can update tool caches. A Docker build can leave layers and images. A malicious script can start a background process. An ephemeral runner turns cleanup into machine teardown, which is stronger than asking a possibly compromised job to clean up after itself.

A simplified GitHub self-hosted runner registration for a one-job runner looks like this:

```bash
./config.sh \
  --url https://github.com/summit-retail/checkout-api \
  --token "$RUNNER_REGISTRATION_TOKEN" \
  --ephemeral \
  --unattended

./run.sh
```

`./config.sh` registers the runner with GitHub. `--url` names the repository or organization that will receive the runner. `--token` supplies a short-lived runner registration token created by automation. `--ephemeral` tells GitHub this runner should handle only one job. `./run.sh` starts the runner process.

Example startup output is usually similar to this:

```bash
Runner successfully added
Runner connection is good
Listening for Jobs
```

In production, automation runs this flow. An autoscaling controller requests registration tokens, starts hardened images, captures runner logs, and deletes the machine after the job. GitHub Actions Runner Controller, GitLab Runner autoscaling executors, and Jenkins cloud agents all support this broad one-job pattern.

Persistent runners still exist. They may handle large hardware, legacy toolchains, or transitional systems. For those runners, cleanup needs layers:

```yaml
- name: Clean runner residue
  if: always()
  run: |
    rm -rf "$GITHUB_WORKSPACE"/*
    rm -rf "$GITHUB_WORKSPACE"/.[!.]* "$GITHUB_WORKSPACE"/..?* || true
    docker system prune -af --volumes || true
```

`if: always()` asks GitHub Actions to run the cleanup step even when an earlier step failed. The `rm -rf` commands remove ordinary and hidden files from the workspace. `docker system prune -af --volumes` removes unused Docker images, containers, networks, build cache, and volumes. This cleanup helps with normal residue. Sensitive deployment jobs still use ephemeral runners or rebuilt images.

Machine cleanup covers local state. Pipelines also carry data intentionally through caches, artifacts, and workspaces.

## Caches, Artifacts, and Workspaces
<!-- section-summary: Caches speed up builds, artifacts move files between jobs, and workspaces hold checked-out code, so each needs its own trust rule. -->

A **workspace** is the directory where the runner checks out the repository and runs commands. In GitHub Actions, the path is available through `GITHUB_WORKSPACE`. In GitLab CI and Jenkins, each job has a similar build directory. Files in the workspace can influence later steps in the same job, and on persistent runners they can influence later jobs if cleanup fails.

A **cache** stores files so future jobs can reuse them. npm caches, Maven repositories, Gradle caches, pip caches, and Docker layers can save a lot of time. A cache also moves data from one run into another run. If untrusted pull request code can write a cache that a trusted `main` release job restores, the cache has crossed the trust boundary.

A **build artifact** is a file uploaded by one job and downloaded by another job or by a human. Test reports, coverage reports, compiled binaries, container metadata, and deployment manifests can all be artifacts. Summit treats artifacts from untrusted pull request jobs as review data. Trusted deployment jobs should not execute binaries or scripts produced by untrusted pull request artifacts.

Summit keeps cache keys separated by event, branch, and lockfile:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ github.event_name }}-${{ github.ref_name }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-${{ github.event_name }}-${{ github.ref_name }}-
```

The cache `path` names the npm cache directory. The `key` includes the runner operating system, event name, branch name, and lockfile hash. The `restore-keys` prefix lets GitHub restore a close cache for the same event and branch when the exact lockfile hash is absent. Strict teams often allow untrusted jobs to restore caches while saving caches only from protected branches.

Artifact rules follow the same idea:

| Artifact source | Safe use | Risky use |
|---|---|---|
| Pull request test job | Show coverage, publish JUnit XML, comment a summary | Execute uploaded scripts in a trusted job |
| Protected branch build | Publish image metadata, SBOM, attestation, test report | Deploy a mutable tag without digest evidence |
| Production deploy job | Store release record and logs | Store long-lived credentials in artifacts |

Caches and artifacts often survive outside a runner. Ephemeral machines help, but the cache service and artifact service still need naming rules, retention limits, and trust separation.

The last runner boundary is what the machine can reach while the job runs.

## Network and Secret Exposure
<!-- section-summary: A runner exposes whatever a job can reach, including tokens, secrets, private APIs, registries, metadata services, and Docker sockets. -->

A **secret** is a sensitive value passed into a job, such as an API key, webhook secret, database password, signing key, or registry token. A **token** is a credential that lets the job call an API. CI/CD tokens, cloud tokens, package registry tokens, and GitHub or GitLab job tokens all give workflow code some authority.

Network access can be as sensitive as a secret. A runner may have a route to a private Kubernetes API, a payment test network, an internal package registry, a cloud metadata endpoint, or a production database subnet. If a job can reach those systems, repository code can try to talk to them.

Summit separates runner networks by purpose:

| Runner path | Network route | Secrets or identity |
|---|---|---|
| Pull request hosted runner | Public internet for dependency downloads | Read-only repository token |
| Internal build runner | Private registry and scanner endpoints | Package publisher token or short-lived registry credential |
| Staging deploy runner | Staging deployment API | Staging OIDC role after environment rules |
| Production deploy runner | Production deployment API and logging endpoint | Production OIDC role after approval |

The production runner subnet can avoid any direct route to the checkout database. The deployment job updates a deployment API, and the running service talks to the database through its own runtime identity. This keeps a compromised deployment job from freely exploring customer data networks.

Docker socket access needs the same care. A job with access to the host Docker socket can often control the host. Summit keeps the host socket away from untrusted jobs and uses isolated builders or one-job runners for container builds. Where Docker is needed, the team treats the builder as part of the runner trust boundary.

Secret exposure should follow the event and environment. Pull request jobs receive no deployment secrets. Build jobs receive only package publishing access. Production deployment jobs request short-lived cloud credentials through OIDC after the environment gate approves the job. The next article goes deep on those token boundaries.

## Review and Incident Checklist
<!-- section-summary: Runner review asks what code runs, where it runs, what it can reach, what it can store, and what evidence remains after the job. -->

Runner security has to survive ordinary pull request review. A reviewer should be able to look at a workflow change and understand which runner path each job uses. Summit uses this checklist for `checkout-api` workflow reviews:

| Review area | Healthy signal |
|---|---|
| Event trust | `pull_request` jobs use low-trust hosted runners and read-only permissions |
| Runner group | Self-hosted groups are limited to approved repositories and trusted events |
| Labels | Labels describe capability, while groups and repository policy carry access control |
| Lifecycle | Sensitive jobs use ephemeral runners or rebuilt images |
| Workspace cleanup | Persistent runners clear workspaces and prune build residue |
| Cache boundary | Pull request caches cannot feed protected branch release jobs |
| Artifact boundary | Untrusted artifacts are reports, not executable release inputs |
| Network route | Runner subnets can reach only the endpoints the job needs |
| Secret exposure | Secrets are scoped by job and environment |
| Logging | Runner logs, workflow logs, and audit events can support an investigation |

The incident version of the checklist asks the same questions in past tense. Which runner handled the suspicious job? Was it hosted or self-hosted? Which repository and event sent the job there? Which secrets were exposed? Which networks were reachable? Which caches and artifacts did the job write? Was the runner persistent, and has it been rebuilt?

Summit also records runner inventory. Every self-hosted runner group has an owner, purpose, repository allow-list, labels, base image, network segment, update plan, and rebuild plan. That inventory gives responders a quick map during an incident.

## Putting It All Together
<!-- section-summary: A secure runner design routes checkout-api through separate paths for pull requests, internal builds, staging, and production. -->

The finished `checkout-api` runner design has a simple shape. Pull request jobs run on hosted runners with read-only access and no secrets. Internal build jobs run after merge on a trusted build path that can publish a candidate image and record the digest. Staging deployment uses a runner that can reach staging. Production deployment uses an approved environment, short-lived identity, narrow network route, and an ephemeral runner.

![Runner hardening summary with separate trust levels, ephemeral runners, clean workspaces, separate caches, limited network paths, and runner usage audit logs](/content-assets/articles/article-devsecops-pipeline-security-securing-cicd-runners/runner-hardening-summary.png)

*The full runner design combines routing, lifecycle, cleanup, network limits, and audit evidence instead of relying on one isolated setting.*

The design works because every runner choice follows the same practical question: **how much does Summit trust this code, and what can the machine reach while the code runs?** That question connects hosted runners, self-hosted runners, runner groups, labels, ephemeral machines, caches, artifacts, secrets, and network rules.

GitHub Actions, GitLab Runner, and Jenkins all support this pattern with different settings. GitHub uses hosted runners, self-hosted runners, runner groups, labels, environments, and workflow permissions. GitLab uses runner tags, protected runners, executor choices, job tokens, and protected environments. Jenkins uses agents, labels, folder permissions, credential binding, shared libraries, and disposable cloud agents.

Runner security sets the floor for pipeline security. Once the right code lands on the right machine, the next question is what identity the job receives after it starts.

## What's Next

The runner is the computer that runs the recipe. The token is the badge the job carries while it performs the recipe. The next article moves from machines to permissions: `GITHUB_TOKEN` scopes, read and write job separation, package publishing, OIDC, workload identity federation, and environment-bound deployment roles.

## References

- [GitHub Actions: GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) - Official GitHub documentation for hosted runner behavior and runner images.
- [GitHub Actions: Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) - GitHub reference for self-hosted runner behavior, updates, routing, and ephemeral runner options.
- [GitHub Actions: Managing access to self-hosted runners using groups](https://docs.github.com/actions/hosting-your-own-runners/managing-self-hosted-runners/managing-access-to-self-hosted-runners-using-groups) - Official runner group documentation for repository access control.
- [GitHub Actions: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - GitHub guidance on untrusted input, token permissions, script injection, and action security.
- [GitHub Actions: Compromised runners](https://docs.github.com/en/actions/concepts/security/compromised-runners) - GitHub guidance on runner compromise impact and response.
- [GitHub Actions: Using secrets in GitHub Actions](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions) - GitHub guidance on secrets, forked pull requests, and OIDC as a secret-reduction pattern.
- [GitLab Runner security](https://docs.gitlab.com/runner/security/) - GitLab guidance for self-managed runner risk, executor choice, and isolation.
- [GitLab: Configuring runners](https://docs.gitlab.com/ci/runners/configure_runners/) - GitLab documentation for runner tags, protected runners, and runner configuration.
- [Jenkins: Controller isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) - Jenkins guidance for isolating the controller from build execution risk.
- [Jenkins: Permissions](https://www.jenkins.io/doc/book/security/access-control/permissions/) - Jenkins documentation for permissions around administration, jobs, agents, and credentials.
- [OWASP CI/CD Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html) - OWASP guidance for reducing CI/CD pipeline risk.

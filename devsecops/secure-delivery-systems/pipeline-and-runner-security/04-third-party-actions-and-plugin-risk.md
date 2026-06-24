---
title: "Third-Party Actions and Plugin Risk"
description: "Learn how to treat CI/CD actions, reusable workflows, plugins, libraries, install scripts, and uploaders as executable supply-chain dependencies."
overview: "Summit Retail's checkout-api already has safer runners, clearer token boundaries, and deployment gates. This article finishes the module by showing how third-party pipeline code enters that trusted path, how to pin and review it, and how to roll updates without handing production secrets to code nobody inspected."
tags: ["devsecops", "third-party-actions", "plugins", "supply-chain"]
order: 4
id: article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk
---

## Table of Contents

1. [Why Pipeline Dependencies Deserve Review](#why-pipeline-dependencies-deserve-review)
2. [Actions, Reusable Workflows, Plugins, and Shared Libraries](#actions-reusable-workflows-plugins-and-shared-libraries)
3. [Tags, Branches, and Full-Length SHA Pinning](#tags-branches-and-full-length-sha-pinning)
4. [Action Allowlists and Default Permissions](#action-allowlists-and-default-permissions)
5. [Dependabot Updates for GitHub Actions](#dependabot-updates-for-github-actions)
6. [Reusable Workflow Review](#reusable-workflow-review)
7. [Jenkins Plugins and Shared Library Risk](#jenkins-plugins-and-shared-library-risk)
8. [Install Scripts, Uploaders, and the Codecov 2021 Incident](#install-scripts-uploaders-and-the-codecov-2021-incident)
9. [How to Review a New Action](#how-to-review-a-new-action)
10. [How to Roll Updates Safely](#how-to-roll-updates-safely)
11. [Putting It All Together](#putting-it-all-together)

## Why Pipeline Dependencies Deserve Review
<!-- section-summary: Third-party pipeline code runs inside the same job that builds, tests, signs, uploads, and deploys your software. -->

By this point in Summit Retail's secure delivery work, the `checkout-api` pipeline has better runner separation, scoped tokens, and approval gates around production. The team already fixed the obvious problems: pull requests from forks run without production secrets, deploy jobs use short-lived cloud credentials, and production promotion needs review. That work gives the pipeline a much safer shape.

Now a junior engineer asks a very reasonable question during a review: "Can I add this GitHub Action? It comments test coverage on the pull request for us." The action has a nice README, thousands of stars, and one line of YAML. It feels like a tiny convenience, but the pipeline sees something much larger: new executable code running inside a job that checks out the repository, reads environment variables, talks to GitHub, and may run before a release.

A **third-party pipeline dependency** is any outside code that the CI/CD system downloads or loads while a job runs. In GitHub Actions, that could be an action from another repository, a Docker-based action, a reusable workflow, or a setup action that installs tools. In Jenkins, that could be a plugin, a shared library, or a shell script that the pipeline downloads before a build. These things sit in the build path, so they deserve review like application dependencies.

This matters because CI/CD jobs often have a special mix of access. The job workspace contains source code and generated artifacts. The job environment may contain signing keys, package registry tokens, cloud federation variables, and repository tokens. The job output may upload containers, publish coverage, create releases, or trigger deployment. When outside code runs in that same job, it shares part of that trust boundary.

For Summit Retail, this means the `checkout-api` team should treat a coverage uploader, a Docker metadata action, a release publisher, and a Jenkins plugin as supply-chain dependencies. The review question moves past "does the YAML work?" and asks "what code did we invite into the delivery path, which permissions did it receive, and how will we update it later?"

![Pipeline code is code infographic showing actions, reusable workflows, plugins, and uploaders entering a CI workspace that can touch tokens, source, artifacts, and a registry](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/pipeline-code-is-code.png)

*Third-party pipeline code runs inside the same job workspace as source, tokens, artifacts, and registry operations, so it deserves review before it joins the delivery path.*

So first we need a clear vocabulary. GitHub Actions, reusable workflows, Jenkins plugins, and shared libraries all show up in pipeline files, but they enter the system in slightly different ways.

## Actions, Reusable Workflows, Plugins, and Shared Libraries
<!-- section-summary: These pipeline building blocks reduce repeated work, but each one can run code with access to build context. -->

A **GitHub Action** is a packaged unit of automation that a workflow job can run with a `uses:` line. Some actions run JavaScript. Some run a Docker container. Some are composite actions, which means they wrap multiple shell steps and other actions into one package. For example, `actions/checkout` gets source code into the runner workspace, and a third-party coverage action might upload test results after the unit tests finish.

A **reusable workflow** is a full workflow file that another workflow can call. Instead of repeating the same build, scan, sign, and deploy jobs across every service, Summit Retail can put those jobs in a central repository and call them from `checkout-api`, `cart-api`, and `inventory-api`. GitHub reusable workflows use `workflow_call`, and the caller chooses which inputs and secrets to pass.

In this small caller workflow from `checkout-api`, the service repository calls a workflow from the platform repository. The service repository chooses which input values and secrets travel into that shared workflow.

```yaml
name: checkout-api-ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  service-ci:
    uses: summit-retail/platform-workflows/.github/workflows/node-service-ci.yml@b5a1c8c9f7b0cdb8797e7b47b9b8139a46c8c1d0
    with:
      service-name: checkout-api
      node-version: "22"
    secrets:
      npm-token: ${{ secrets.NPM_READ_TOKEN }}
```

That one `uses:` line asks another repository to define the job behavior. The caller controls inputs and secrets, but the workflow in `platform-workflows` controls the steps that run. If that reusable workflow later adds an extra uploader step, every service that calls the updated reference may inherit that behavior.

A **Jenkins plugin** extends Jenkins itself. Plugins add source control integrations, pipeline steps, credential types, cloud agents, test report handling, and UI features. The important part is that plugins run inside the Jenkins controller or agent process, so a vulnerable or overpowered plugin can affect many jobs from one installation.

A **Jenkins shared library** is reusable Groovy code loaded by Jenkins Pipeline. Teams use shared libraries to avoid copying deployment logic into every `Jenkinsfile`. For Summit Retail, a library function like `deployService("checkout-api")` might build the container, push it to the registry, and update the Kubernetes deployment. That centralization helps, but a shared library sits very close to credentials and release logic.

In production, teams usually combine all four patterns. They use a few trusted marketplace actions, a central workflow repository for common CI logic, Jenkins plugins for platform integration, and shared libraries for house-style deployment steps. That setup can work well when the dependencies have ownership, versioning, review, and update rules. It creates risk when the pipeline accepts new automation because it looks popular.

Once the team understands these building blocks, the next review question is the exact version reference. That control is simple to explain and easy to miss in real pull requests.

## Tags, Branches, and Full-Length SHA Pinning
<!-- section-summary: A version reference decides which external code runs, and full-length commit SHA pins give reviewers an immutable target. -->

A **version reference** tells the CI/CD system which copy of external code to run. In GitHub Actions, it appears after the `@` in a `uses:` line. A branch reference such as `@main` follows whatever code the branch points to today. A tag reference such as `@v4` follows the commit currently attached to that tag. A full-length commit SHA reference points to one exact commit.

The YAML examples below compare a branch reference, a tag reference, and a full-length SHA reference. The action name stays the same, and only the reference after the `@` changes.

```yaml
steps:
  - name: Checkout with a moving branch reference
    uses: actions/checkout@main

  - name: Checkout with a major version tag
    uses: actions/checkout@v4

  - name: Checkout with a full-length commit SHA
    uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
```

The branch and tag references are easy to read, and many examples on the internet use them. The security issue is that the name can point to different code over time. A maintainer can move a tag. A compromised maintainer account can move a tag. A branch changes by design. That means a workflow review from last month may describe older code than the code that runs today.

A **full-length commit SHA pin** gives the reviewer a stable target. The workflow asks GitHub for exactly one commit, so the action code stays tied to that reference until the pin changes. GitHub recommends pinning actions to a full-length commit SHA for the strongest stability, especially for third-party actions. Short SHAs are less useful because they can be ambiguous as a repository grows.

The first release workflow shows the shape Summit Retail avoids for third-party actions. This job publishes a container package, so the team wants the code inside each action to match the code that reviewers inspected.

```yaml
name: release

on:
  push:
    tags:
      - "checkout-api-v*"

permissions:
  contents: read
  id-token: write
  packages: write

jobs:
  publish:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/summit-retail/checkout-api:${{ github.ref_name }}
```

This workflow uses major version tags for three actions. Some teams choose major tags for trusted first-party actions or low-risk jobs because tags are convenient and receive updates automatically. For a release job with package publishing and cloud identity access, Summit Retail uses a stricter rule: every external action reference gets pinned to a reviewed full-length SHA.

The reviewed version uses pinned references. The step names stay readable for humans, and the `uses:` references point to exact commits.

```yaml
name: release

on:
  push:
    tags:
      - "checkout-api-v*"

permissions:
  contents: read
  id-token: write
  packages: write

jobs:
  publish:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout source
        uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11

      - name: Log in to GHCR
        uses: docker/login-action@e92390c5fb421da1463c202d546fed0ec5c39f20
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@ca877d9245402d1537745e0e356eab47c3520991
        with:
          context: .
          push: true
          tags: ghcr.io/summit-retail/checkout-api:${{ github.ref_name }}
```

This does create update work. Someone has to move the pins forward when action authors release fixes. That work is intentional. A pinned dependency turns surprise change into a pull request, and the review can compare the old commit and the new commit before the release job trusts it.

Pinned references answer "which code runs?" The next control answers "which outside code can enter the repository at all?"

![Pin and allow infographic comparing moving tags that can change later with reviewed SHA pins, action allowlists, and update pull requests](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/pin-and-allow.png)

*A full-length SHA pin gives reviewers a stable target, while an allowlist decides which outside automation is allowed to enter the workflow in the first place.*

## Action Allowlists and Default Permissions
<!-- section-summary: Repository and organization settings reduce surprise actions, while job permissions keep each approved action inside a narrow token boundary. -->

An **action allowlist** is a policy that limits which actions and reusable workflows a repository can use. GitHub repository and organization settings can allow all actions, allow only actions from GitHub and verified creators, or allow only selected actions and reusable workflows. At a larger company, the organization-level policy usually sets the baseline, and individual repositories may receive tighter rules for sensitive services.

For Summit Retail, `checkout-api` handles payment-adjacent checkout traffic. The platform team allows first-party internal workflows, official GitHub actions, Docker's publishing actions after review, and a short list of security scanning actions. A new random action from a personal repository stays out of production pipelines until the team requests and reviews it.

The allowlist should match how the team really works. A starter policy can allow the sources the platform team already reviews and block everything else until someone asks for review.

| Source | Example | Why it is allowed |
|---|---|---|
| Internal reusable workflows | `summit-retail/platform-workflows/.github/workflows/node-service-ci.yml` | Platform security owns review and rollout |
| GitHub-owned actions | `actions/checkout`, `actions/setup-node` | Common baseline actions with broad community use |
| Reviewed vendor actions | `docker/login-action`, `docker/build-push-action` | Needed for image publishing and reviewed by platform |
| Blocked by default | Personal repos, one-off uploaders, unmaintained actions | Needs a request and review before use |

The allowlist handles the supply side. The workflow still needs a runtime permission boundary. In GitHub Actions, the `GITHUB_TOKEN` receives permissions based on workflow and job settings. A workflow that only runs tests can usually use `contents: read`. A workflow that comments on pull requests may need `pull-requests: write`. A workflow that publishes packages needs `packages: write`. Cloud federation through OpenID Connect usually needs `id-token: write` only in the job that requests the cloud token.

Summit Retail uses the following pattern for `checkout-api` pull request checks. The coverage comment job receives pull request write access, while the test job stays read-only and moves the coverage report through an artifact.

```yaml
name: pull-request-checks

on:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout source
        uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11

      - name: Set up Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "22"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test -- --coverage

      - name: Upload coverage report
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: checkout-api-coverage
          path: coverage/

  coverage-comment:
    needs: test
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Download coverage report
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: checkout-api-coverage
          path: coverage/

      - name: Publish coverage comment
        uses: summit-retail/actions/coverage-comment@8f4f2ad58b3b8bc3de77e70df25b04f7b41ddbbf
        with:
          report-path: coverage/summary.json
```

The workflow-level default starts at `contents: read`. The one job that needs pull request write access declares it at the job level. That keeps a future test helper action from receiving write access by accident. The team also keeps production secrets out of pull request jobs, so a third-party action in a PR path runs without deploy credentials available.

This is where the earlier module work connects to third-party code. Runner hardening gives outside code a cleaner machine. Token boundaries reduce what that code can call. Gates stop direct production promotion. Allowlists decide which outside code can enter the building in the first place.

After allowlists and pins, the team still needs updates. A frozen dependency can miss security fixes, runtime fixes, or platform deprecations.

## Dependabot Updates for GitHub Actions
<!-- section-summary: Dependabot turns action updates into reviewable pull requests instead of hidden changes inside moving tags. -->

**Dependabot** is GitHub's dependency update tool. It can watch package manifests such as `package.json`, Dockerfiles, and GitHub Actions workflow references. For actions, Dependabot scans workflow files and opens pull requests when it finds newer versions for the actions you use.

This matters more after SHA pinning. A full-length SHA pin gives control, but it also means the workflow stays on that exact commit until someone moves it. Dependabot can create the routine update pull request, and humans can review whether the new action commit makes sense for the job.

This `.github/dependabot.yml` works for `checkout-api`. The file tracks workflow dependencies and application dependencies on the same weekly maintenance rhythm.

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "08:00"
      timezone: "America/New_York"
    labels:
      - "dependencies"
      - "ci"
    commit-message:
      prefix: "ci"
    open-pull-requests-limit: 5

  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "08:30"
      timezone: "America/New_York"
    labels:
      - "dependencies"
      - "node"
```

The first block tells Dependabot to inspect GitHub Actions workflow files at the repository root. The second block watches Node dependencies. Keeping both in the same file helps the team see CI dependencies and application dependencies as part of the same maintenance habit.

A Dependabot action PR still needs review. For Summit Retail, the reviewer checks the upstream release notes, compares the old commit to the new commit, confirms the same owner still maintains the action, and runs the workflow in a low-risk path before approving. A patch release for `actions/setup-node` may be simple. A major release of a third-party deployment action gets a deeper review because it touches publishing and credentials.

Real teams often group action updates by risk. Build helper actions can update weekly. Release and deployment actions may update during a maintenance window. Security scanner actions usually update quickly, but the team still checks for breaking output changes so gates continue enforcing the right policy.

The same idea applies to reusable workflows, but the review target moves from one action repository to the central workflow repository. That shift matters because one central workflow can change the behavior of many services at once.

## Reusable Workflow Review
<!-- section-summary: Reusable workflows centralize CI logic, so their inputs, secrets, permissions, and rollout path need the same review as application code. -->

A **reusable workflow review** checks a workflow that other repositories call. The reviewer looks at the workflow file itself, the permissions it asks for, the inputs it accepts, the secrets it consumes, and the jobs it runs. This review matters because one central workflow can affect many services.

Summit Retail uses a central `platform-workflows` repository. The `checkout-api` repository calls `node-service-ci.yml` for tests and `container-release.yml` for releases. That design saves time because the platform team can fix one workflow and help every service. It also means a careless change in `container-release.yml` can change how many services build and publish containers.

The platform repository can hold this reusable workflow. This is the file that service repositories call when they want the standard Node test path.

```yaml
name: node-service-ci

on:
  workflow_call:
    inputs:
      service-name:
        required: true
        type: string
      node-version:
        required: true
        type: string
    secrets:
      npm-token:
        required: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout source
        uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11

      - name: Set up Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ inputs.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci
        env:
          NPM_TOKEN: ${{ secrets.npm-token }}

      - name: Run unit tests
        run: npm test
```

The review starts with inputs. `service-name` and `node-version` are harmless when the workflow uses them as data. Inputs get riskier when a workflow inserts them into shell commands without quoting or validation. A malicious or mistaken caller could turn a friendly input into command injection. For shell steps, reusable workflows should treat caller-provided strings as untrusted data.

Secrets come next. This workflow receives `npm-token`, and that token reaches only the install step through `env`. The workflow passes only the caller secret that the install step needs. That is important because every later action and shell command in the job can read environment variables available to that step.

Then the reviewer checks permissions. This workflow needs source checkout and package install, so `contents: read` is enough. A reusable test workflow keeps `id-token: write`, `packages: write`, and deployment environment permissions out of the test path. Release workflows may need those permissions, but only in the release job.

Finally, the reviewer checks rollout. If `checkout-api` calls a reusable workflow by a branch name, it receives every platform change immediately. If it calls by full SHA, it updates when the service moves the pin. Many organizations use branch references for internal reusable workflows because they trust the platform team and want central fixes to land quickly. A stricter organization can require SHA pins for reusable workflows too, especially for production release workflows. The key is that the choice must match the ownership and review process.

GitHub Actions covers one side of this article. Summit Retail also has older services on Jenkins, and the same supply-chain idea shows up through plugins and shared libraries.

## Jenkins Plugins and Shared Library Risk
<!-- section-summary: Jenkins plugins and shared libraries run close to credentials and controllers, so review has to include installation rights and trusted code paths. -->

Jenkins has a different shape from GitHub Actions. GitHub-hosted actions usually run inside a job on a runner. Jenkins plugins extend the Jenkins controller and agents. Shared libraries load Groovy code into Pipeline. The packaging differs, but the security question stays familiar: which outside code can affect builds, credentials, and releases?

A **Jenkins plugin** is installed into Jenkins to add features. A source control plugin may clone repositories. A credentials plugin may store or expose credential bindings. A Kubernetes plugin may create build agents. A test reporting plugin may parse build output. Plugins often need deep integration, which means plugin installation and update rights should belong to Jenkins administrators instead of every pipeline author.

Jenkins permissions matter here. The `Administer` permission gives broad control over the Jenkins instance. Job configuration permissions let users change pipeline definitions. Credential permissions control who can create, update, view, or use credentials depending on the configured security model. If a user can install plugins or configure trusted libraries, that user can affect more than one job.

A **shared library** is code that multiple Jenkins pipelines import. A normal untrusted library has sandbox limits. A trusted shared library can run methods outside the Groovy sandbox, which gives it powerful access inside Jenkins. That power is useful for central platform code, and it also means trusted libraries need the same review quality as production deployment tooling.

The next example shows a simple `Jenkinsfile` pattern for `checkout-api`. The important detail is the versioned shared library reference at the top, because that library owns part of the release behavior.

```groovy
@Library('summit-delivery-lib@2.8.3') _

pipeline {
  agent { label 'linux-container' }

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  stages {
    stage('Test') {
      steps {
        sh 'npm ci'
        sh 'npm test'
      }
    }

    stage('Build and Publish') {
      when {
        branch 'main'
      }
      steps {
        withCredentials([string(credentialsId: 'ghcr-checkout-api-publisher', variable: 'GHCR_TOKEN')]) {
          publishContainer(
            service: 'checkout-api',
            image: 'ghcr.io/summit-retail/checkout-api',
            tokenVariable: 'GHCR_TOKEN'
          )
        }
      }
    }
  }
}
```

The library version `2.8.3` is part of the release surface. If the library reference points to a moving branch, the next `main` build may run new deployment logic before the service team reviews it. If the library is trusted, that new logic may have broad Jenkins access. A safer pattern is a reviewed version reference, a changelog for library releases, and a staging Jenkins job that tests the new library version before production jobs move forward.

For plugins, Summit Retail keeps a plugin inventory with owners. Each plugin has a reason to exist, a current version, an update policy, and a rollback note. Jenkins administrators review plugin advisories, test plugin updates on a staging controller, and schedule production controller updates with backup and rollback steps. The service team asks the Jenkins administrators for review when a new plugin would make one `Jenkinsfile` shorter.

That might sound heavy, so connect it back to the business scenario. `checkout-api` needs reliable releases during holiday traffic. A Jenkins controller plugin failure can stop all release jobs. A malicious shared library update can publish a tampered container. A careless credential-binding helper can print tokens into logs. Treating plugins and libraries as dependencies is basic release hygiene that protects customers during the busiest traffic windows.

The next risk is even easier to overlook because it often arrives as one shell line in a README. That line can run with the same environment access as the rest of the job.

## Install Scripts, Uploaders, and the Codecov 2021 Incident
<!-- section-summary: Curl-based installers and uploaders run with job environment access, and the Codecov incident showed how one trusted uploader can expose many customers. -->

An **install script** is a script downloaded and executed during a build to install a tool, configure a scanner, or upload results. An **uploader** is a script or binary that sends build output to another service, such as coverage reports, test reports, mobile build artifacts, or security scan results. These tools often need network access, and they often run after tests when the workspace and environment contain useful information.

Many READMEs show patterns like this. The example is intentionally simple because the risky part is the habit, independent of the specific domain name.

```bash
curl -fsSL https://example.invalid/install.sh | bash
```

That line downloads code from the internet and runs it immediately inside the CI job. The job usually runs the script without saving a reviewed copy. The team may have no exact record of which version ran last Tuesday. If the remote script changes, the pipeline runs the new script the next time the job executes.

The Codecov 2021 incident is the production example teams still discuss for this reason. Codecov reported that an unauthorized party modified its Bash Uploader, a tool customers used in CI pipelines to upload coverage reports. The modified uploader could export information from customers' CI environments to an external server. Codecov advised affected customers to rotate credentials, tokens, or keys that may have been exposed through their CI environment.

For Summit Retail, this maps directly to `checkout-api`. A coverage uploader might run after tests and see environment variables, repository metadata, and generated reports. If that job also has package publishing tokens or cloud deployment variables, a compromised uploader could read them. A reputable uploader helps, and the pipeline also has to isolate the uploader from secrets outside its job.

The next workflow shows a risky shape. The uploader runs in the same job that holds release-related permissions.

```yaml
jobs:
  test-and-upload:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
      packages: write
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
      - run: npm ci
      - run: npm test -- --coverage
      - run: curl -fsSL https://coverage.example.invalid/uploader.sh | bash
```

The uploader runs in the same job that has package publishing and OIDC permissions. The script source also floats because the URL returns whatever the server serves at runtime. That combination gives too much power to unpinned, unreviewed code.

The safer shape separates testing from uploading. The test job produces the report, and a separate upload job receives only the coverage token it needs.

```yaml
jobs:
  test:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: checkout-api-coverage
          path: coverage/

  coverage-upload:
    needs: test
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: checkout-api-coverage
          path: coverage/
      - name: Verify uploader checksum
        run: |
          curl -fsSLo coverage-uploader https://coverage.example.invalid/downloads/uploader-linux-amd64
          echo "9b1f4c1d6f1d4ad7e8a5f0b2f9d4c5f7b8a1e6d0c3b2a1908e7d6c5b4a392817  coverage-uploader" | sha256sum -c -
          chmod +x coverage-uploader
      - name: Upload coverage
        run: ./coverage-uploader upload --file coverage/summary.json
        env:
          COVERAGE_TOKEN: ${{ secrets.COVERAGE_UPLOAD_TOKEN }}
```

This version separates the upload from build and release privileges. It downloads a binary with an expected checksum, uses a narrow upload token, and keeps cloud publishing permissions out of the job. Some vendors provide signed releases or official pinned actions, which can make this cleaner. The point is that uploaders need the same dependency review as other executable pipeline code.

Now we have enough pieces to review a new action in a practical way. The review can follow the same order every time, which keeps the conversation clear for service teams and platform reviewers.

## How to Review a New Action
<!-- section-summary: A new action review checks source, owner, permissions, scripts, network behavior, release history, and a safe first rollout path. -->

A **new action review** is the security and reliability check before a workflow depends on an action for regular builds or releases. The review can stay calm and practical. It needs to answer a set of plain questions with evidence.

Summit Retail uses a small request template for `checkout-api` teams. The template asks for the action name, the workflow job that will use it, the permissions that job has, the secrets available in the job, the exact commit SHA, the reason an existing internal workflow falls short, and the rollback plan if the action breaks builds.

The table below follows the review flow in the order the platform team uses it. Each row turns one security concern into a question the reviewer can answer with evidence.

| Check | What the reviewer looks for | Example decision |
|---|---|---|
| Purpose | The action solves a real pipeline problem | Coverage comments help reviewers see test impact |
| Owner | The repository owner is reputable and still active | Vendor-owned or organization-owned action preferred |
| Source | The action code is inspectable at the pinned commit | JavaScript/composite source can be reviewed before use |
| Pin | The workflow uses a full-length commit SHA | `owner/action@40-character-sha` |
| Permissions | The job grants only what the action needs | `pull-requests: write` only in the comment job |
| Secrets | The action receives only needed secrets | Upload token scoped to coverage service only |
| Install path | Avoids unpinned `curl | bash` or hidden installer | Downloaded binaries have signatures or checksums |
| Network | Expected outbound services are clear | GitHub API and coverage vendor endpoint |
| Maintenance | Recent releases, issue response, security policy | Active repository with documented release notes |
| Rollback | The old workflow state is recoverable | Revert PR or move pin back to previous SHA |

Then the reviewer reads the action definition. For GitHub Actions, the `action.yml` or `action.yaml` file explains how the action runs. A JavaScript action usually points to a built file such as `dist/index.js`. A composite action lists shell steps. A Docker action points to a Dockerfile or image.

The review can start with a lightweight repository audit. This gives the reviewer a list of current action references, current workflow permissions, and any places where the workflow still uses moving references. The reviewer then inspects the risky lines first.

```bash
REPO="summit-retail/checkout-api"
mkdir -p evidence/action-review

rg --line-number "uses:" .github/workflows \
  > evidence/action-review/workflow-uses-lines.txt

rg --line-number "uses: .*@(main|master|HEAD|v[0-9]+)$" .github/workflows \
  > evidence/action-review/moving-action-references.txt || true

gh api "repos/$REPO/actions/permissions" \
  > evidence/action-review/actions-permissions.json

gh api "repos/$REPO/dependabot/alerts?state=open" \
  > evidence/action-review/dependabot-open-alerts.json
```

The output is intentionally small. `workflow-uses-lines.txt` shows every external action and reusable workflow. `moving-action-references.txt` shows references that deserve a pinning conversation. The GitHub API exports show whether repository settings and open dependency alerts support the review decision.

For a composite action, a reviewer looks closely at shell usage. Composite actions often contain only a few lines, and they can still pass untrusted input into shell commands.

```yaml
runs:
  using: "composite"
  steps:
    - name: Publish coverage comment
      shell: bash
      run: |
        node "$GITHUB_ACTION_PATH/comment.js" \
          --report "${{ inputs.report-path }}" \
          --pr "${{ github.event.pull_request.number }}"
```

Inputs that flow into shell commands need careful quoting. Pull request data, branch names, commit messages, issue titles, and user-controlled file paths should never reach shell commands as raw text. GitHub also warns about script injection risks when workflows use untrusted context values directly in shell scripts. A safer design passes data through environment variables or arguments with clear quoting, and the script validates expected file paths.

For a Docker action, the reviewer checks the Dockerfile, base image, package installs, entrypoint, and network calls. A Docker action can hide a lot of behavior behind an image tag, so many teams prefer source-based actions or images pinned by digest for high-trust jobs. If the action downloads more tools during runtime, those downloads need the same pinning and verification questions.

For a JavaScript action, the reviewer checks generated `dist` files too. Many actions commit bundled JavaScript because the runner executes that bundle directly. The source TypeScript may look fine while the generated bundle contains something else. For higher-risk actions, the reviewer compares source changes, bundled output, release notes, and the exact commit that the workflow will pin.

The review ends with a first rollout plan. `checkout-api` tries the action in a pull request check before using it in release. The job starts with read-only permissions. The action receives no production secrets. Logs are reviewed for accidental secret output. After the action passes a few normal runs, the team can decide whether it belongs in the internal allowlist or central reusable workflow.

Reviews are one half of maintenance. Updates are the other half, and updates need a safe path because pinned code must move eventually.

## How to Roll Updates Safely
<!-- section-summary: Safe updates move pins through review, staging, monitoring, and rollback instead of waiting for a surprise failure in production release. -->

An **action update** changes the commit, tag, plugin version, shared library version, or uploader version that the pipeline runs. Updates carry two kinds of risk. The old version may contain a vulnerability or platform incompatibility. The new version may change behavior, permissions, output files, or runtime assumptions.

Summit Retail handles action updates as normal change management. Dependabot opens a PR for GitHub Actions. Jenkins administrators open a change request for plugin updates. The platform workflow repository publishes release notes for shared library and reusable workflow changes. Service teams review changes that affect their release jobs.

For a GitHub Actions update PR, the reviewer checks the dependency change and the pipeline permissions together. The update is a code review and a delivery-system review at the same time.

1. The old reference and new reference.
2. Upstream release notes and security notes.
3. The diff between the old commit and new commit.
4. Permission changes in the workflow.
5. Changes to install scripts, Dockerfiles, generated bundles, and network calls.
6. Test results from pull request checks.
7. A rollback plan that returns to the previous known working pin.

The next block shows how that looks in a real `checkout-api` pull request description. The goal is to leave enough evidence that the next reviewer can understand why the pin moved.

```markdown
## CI dependency update

- Action: docker/build-push-action
- Current pin: ca877d9245402d1537745e0e356eab47c3520991
- New pin: 7f3d81b6f7d5b09a6fd61e5a1c4f70f8e0eaf0a4
- Workflow: .github/workflows/release.yml
- Job permissions: unchanged, contents: read and packages: write
- Release notes reviewed: yes
- Diff reviewed: yes
- Staging release run: checkout-api-v0.0.0-update-test
- Rollback: revert this PR or restore the previous pin
```

For sensitive release workflows, Summit Retail runs the updated action through a staging tag before publishing a real release. The staging tag builds an image with a temporary version, pushes it to a non-production registry namespace, and runs the same signing and attestation steps. The team checks that the image name, labels, SBOM, provenance, and logs still match expectations.

For Jenkins plugins, the rollout path has a different shape. Administrators back up Jenkins configuration, test plugin updates on a staging controller with copies of representative jobs, read plugin advisory notes, and update production during a maintenance window. If a plugin update breaks pipeline syntax or credential binding, the rollback path may require restoring the previous plugin version and controller state.

For shared libraries, Summit Retail uses semantic versions and a small compatibility test job. The library release `2.9.0` runs against sample services before `checkout-api` moves from `2.8.3` to `2.9.0`. When a change affects deployment behavior, the release note includes the exact service team action: new input required, old helper removed, or permission change needed.

For uploaders and install scripts, the safest update flow downloads a new signed release or binary, updates the expected checksum, and runs the upload job without unrelated secrets. If a vendor supports only a floating remote script and lacks a stable version, checksum, signature, or source review path, Summit Retail treats that as a risk exception. The team either asks the vendor for a pinned distribution method, wraps the tool in an internal reviewed action, or chooses another tool.

This update process sounds like a lot of ceremony only until the first production release breaks because an action changed its default shell, a plugin changed a credential binding, or an uploader changed its endpoint. The process gives the team a known previous pin and a known path forward.

## Putting It All Together
<!-- section-summary: A secure delivery system treats pipeline extensions as code, pins what runs, limits what it can access, and updates through review. -->

Summit Retail's `checkout-api` pipeline now has a complete story for third-party actions and plugins. The team understands that actions, reusable workflows, Jenkins plugins, shared libraries, install scripts, and uploaders are executable supply-chain dependencies. They can help the delivery system, and they can also read files, use tokens, make network calls, publish artifacts, and affect releases.

The practical controls connect to each other. **Full-length SHA pins** give reviewers an exact GitHub Actions commit. **Allowlists** limit which outside code can run in the repository. **Job-level permissions** keep approved code inside a narrow GitHub token boundary. **Dependabot** turns updates into pull requests. **Reusable workflow reviews** protect central automation that many services call. **Jenkins plugin and shared library controls** keep controller-level code and trusted Groovy paths under administrator review. **Uploader controls** keep remote install scripts away from unnecessary secrets.

For day-to-day work, the review habit matters most. A new action request should explain why the action is needed, which job will run it, what secrets and permissions it can see, which commit is pinned, how the source was reviewed, and how the team will roll back. An update request should explain what changed, which release notes were checked, which staging run passed, and which previous pin remains available.

This is the final layer in the module. Runner security controls where jobs run. Token boundaries control what jobs can access. Gates control when production changes move forward. Third-party action and plugin review controls the outside code that joins those jobs. Together, those controls turn the `checkout-api` pipeline into a delivery system the team can operate, audit, and update with confidence.

![Third-party dependency loop showing request, review source, pin version, limit permissions, test in staging, and update or rollback around a central shield](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/third-party-dependency-loop.png)

*The review loop turns a new action, plugin, uploader, or workflow into a maintained dependency with a known version, narrow permissions, staging evidence, and a rollback path.*

---

**References**

- [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - Covers secure use guidance, script injection risks, least-privilege token permissions, and pinning actions to full-length commit SHAs.
- [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) - Documents repository settings for allowed actions and reusable workflows.
- [Keeping your actions up to date with Dependabot](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions) - Explains Dependabot configuration for the `github-actions` package ecosystem.
- [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) - Documents `workflow_call`, caller workflows, inputs, and secrets for reusable workflows.
- [Securing builds](https://docs.github.com/en/code-security/tutorials/implement-supply-chain-best-practices/securing-builds) - Gives GitHub supply-chain guidance for build systems and dependency integrity.
- [Jenkins Pipeline Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Explains global libraries, folder-level libraries, and trusted shared library behavior.
- [Jenkins permissions](https://www.jenkins.io/doc/book/security/access-control/permissions/) - Documents Jenkins permissions that control administration, job configuration, credentials, and related access.
- [Codecov April 2021 post-mortem](https://about.codecov.io/apr-2021-post-mortem/) - Describes the Bash Uploader incident and customer credential-rotation guidance.

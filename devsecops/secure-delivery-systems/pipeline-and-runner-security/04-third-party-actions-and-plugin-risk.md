---
title: "Third-Party Actions and Plugin Risk"
description: "Treat actions, reusable workflows, Jenkins plugins, shared libraries, install scripts, and uploaders as executable CI/CD supply-chain dependencies."
overview: "Start with workflow code as code someone runs on your runner, then follow Summit Retail's checkout-api through actions, reusable workflows, Jenkins plugins, shared libraries, SHA pinning, allowlists, Dependabot updates, install scripts, uploaders, review evidence, staging rollout, and rollback."
tags: ["devsecops", "third-party-actions", "plugins", "supply-chain"]
order: 4
id: article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk
---

## Table of Contents

1. [Workflow Code Is Code on Your Runner](#workflow-code-is-code-on-your-runner)
2. [The Small `uses` Line](#the-small-uses-line)
3. [Actions, Reusable Workflows, Plugins, and Shared Libraries](#actions-reusable-workflows-plugins-and-shared-libraries)
4. [Version References and SHA Pinning](#version-references-and-sha-pinning)
5. [Allowlists and Job Permissions](#allowlists-and-job-permissions)
6. [Dependabot and Update Pull Requests](#dependabot-and-update-pull-requests)
7. [Reusable Workflow Review](#reusable-workflow-review)
8. [Jenkins Plugin and Shared Library Risk](#jenkins-plugin-and-shared-library-risk)
9. [Install Scripts, Uploaders, and the Codecov 2021 Incident](#install-scripts-uploaders-and-the-codecov-2021-incident)
10. [Review a New Action](#review-a-new-action)
11. [Roll Updates Safely](#roll-updates-safely)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## Workflow Code Is Code on Your Runner
<!-- section-summary: Third-party pipeline code runs inside jobs that can see source, tokens, artifacts, logs, and network paths. -->

Workflow code is still code someone runs on your runner. It may look like one friendly YAML line, but the runner downloads or loads code and executes it inside a job that may contain source code, environment variables, artifacts, cache paths, network access, and job tokens.

Summit Retail has already improved the `checkout-api` delivery path. Pull requests use low-trust runners. Tokens are scoped by job. Production uses branch protections and environment gates. Now a developer asks a very normal question during review: "Can I add this coverage action so the pull request gets a nice coverage comment?"

The action has a polished README and many stars. The YAML line is short. The runner sees a larger change: new executable code enters a job that checks out the repository, reads coverage output, talks to GitHub, and may comment on a pull request. A similar one-line change could upload test results, publish a release, create an SBOM, install a scanner, or deploy a service.

A **third-party pipeline dependency** is outside code that CI/CD downloads, loads, or executes while a job runs. GitHub Actions, reusable workflows, Docker actions, Jenkins plugins, Jenkins shared libraries, shell installers, and uploaders all fit this idea. They can be useful, and they also join the delivery trust boundary.

![Pipeline code is code infographic showing actions, reusable workflows, plugins, and uploaders entering a CI workspace that can touch tokens, source, artifacts, and a registry](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/pipeline-code-is-code.png)

*Third-party pipeline code runs inside the same job workspace as source, tokens, artifacts, and registry operations, so it deserves review before it joins the delivery path.*

We will begin with the tiny `uses` line, then widen the view to reusable workflows, Jenkins plugins, pinning, allowlists, update flow, install scripts, and rollback.

## The Small `uses` Line
<!-- section-summary: A `uses` line can load external code, so reviewers should read it as a dependency declaration. -->

Here is the small pull request job Summit starts with:

```yaml
name: checkout-api pull request

on:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage
```

`actions/checkout` places the repository in the runner workspace. `actions/setup-node` prepares Node.js and npm caching. `npm ci` installs dependencies from the lockfile. `npm test -- --coverage` runs the test suite and writes coverage output.

Now add a coverage comment action:

```yaml
      - uses: vendor/coverage-comment@v2
        with:
          report-path: coverage/summary.json
```

That line asks the runner to load code from another repository. The action may be JavaScript, Docker-based, or composite shell steps. It can read the coverage file, and depending on job permissions, it may be able to call GitHub APIs. If the job has secrets or write permissions, the action can share the same job context.

The first review question is plain: **what exact code will run, and what access will it receive?** The rest of the article builds the review controls around that question.

## Actions, Reusable Workflows, Plugins, and Shared Libraries
<!-- section-summary: Pipeline building blocks reduce repeated work, and each one can run code close to credentials and release logic. -->

A **GitHub Action** is a packaged unit of automation that a workflow can run with a `uses:` line. JavaScript actions run Node code. Docker actions run containers. Composite actions wrap shell steps and other actions. `actions/checkout` and `actions/setup-node` are common examples. A third-party coverage uploader, release creator, or deployment helper follows the same basic pattern.

A **reusable workflow** is a full workflow file that another workflow can call. Summit can keep standard CI in a central `platform-workflows` repository, then call it from `checkout-api`, `cart-api`, and `inventory-api`. The caller chooses inputs and secrets, while the reusable workflow owns the steps that run.

Here is a caller workflow:

```yaml
name: checkout-api ci

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  service-ci:
    uses: summit-retail/platform-workflows/.github/workflows/node-service-ci.yml@b5a1c8c9f7b0cdb8797e7b47b9b8139a46c8c1d0
    with:
      service-name: checkout-api
      node-version: "22"
    secrets:
      npm-token: ${{ secrets.NPM_READ_TOKEN }}
```

The caller passes `service-name`, `node-version`, and one npm token. The referenced workflow controls the actual job steps. If that central workflow changes, every caller that points at the updated reference can inherit new behavior.

A **Jenkins plugin** extends Jenkins itself. Plugins add source control integration, credentials, agents, test reporting, cloud integrations, security scanning, and UI features. Plugins often run in the Jenkins controller or agent process, so plugin installation and update rights should belong to Jenkins administrators.

A **Jenkins shared library** is reusable Groovy code loaded by Jenkins Pipeline. A function such as `publishContainer(service: 'checkout-api')` may build an image, push it to a registry, and write release evidence. A trusted library can run outside the Groovy sandbox, which gives it strong access inside Jenkins.

These tools save time. The security work is to give each dependency an owner, exact version, allowed use, permission boundary, update path, and rollback path.

## Version References and SHA Pinning
<!-- section-summary: A version reference decides which external code runs, and full-length commit SHA pins give reviewers an immutable target. -->

A **version reference** is the part after `@` in a GitHub Actions `uses:` line. A branch reference follows a moving branch. A tag reference follows a tag. A full-length commit SHA points to one exact commit.

The same action can be referenced three ways:

```yaml
steps:
  - name: Checkout with a branch reference
    uses: actions/checkout@main

  - name: Checkout with a version tag
    uses: actions/checkout@v4

  - name: Checkout with a full-length commit SHA
    uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
```

Branch and tag references are readable, and many tutorials use them. A branch changes by design. A tag can move. A full-length commit SHA gives reviewers a stable target. The workflow runs that exact commit until the pin changes in a later pull request.

Summit allows version tags for some first-party, low-risk examples while teaching. For high-trust jobs, especially release and deployment jobs, Summit pins external actions to reviewed full-length SHAs.

A release job with moving tags might look like this:

```yaml
name: checkout-api release

on:
  push:
    tags:
      - "checkout-api-v*"

permissions:
  contents: read
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

The pinned version uses exact commits:

```yaml
name: checkout-api release

on:
  push:
    tags:
      - "checkout-api-v*"

permissions:
  contents: read
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

This creates maintenance work because pins have to move forward. That work is useful. An action update turns into a reviewable pull request instead of a surprise change during a release job.

![Pin and allow infographic comparing moving tags that can change later with reviewed SHA pins, action allowlists, and update pull requests](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/pin-and-allow.png)

*A full-length SHA pin gives reviewers a stable target, while an allowlist decides which outside automation may enter the workflow.*

Pinning answers which code runs. Allowlists answer which sources may enter the repository at all.

## Allowlists and Job Permissions
<!-- section-summary: Repository and organization settings limit which actions can run, while job permissions limit what approved actions can access. -->

An **action allowlist** is a policy that limits which actions and reusable workflows a repository can use. GitHub repository and organization settings can allow all actions, allow GitHub-owned and verified actions, or allow only selected actions and reusable workflows. Sensitive services usually use a stricter organization baseline plus repository-specific exceptions.

Summit allows these sources for `checkout-api`:

| Source | Example | Review reason |
|---|---|---|
| Internal reusable workflows | `summit-retail/platform-workflows/.github/workflows/node-service-ci.yml` | Platform security owns review and rollout |
| GitHub-owned actions | `actions/checkout`, `actions/setup-node` | Common baseline actions with official maintenance |
| Reviewed vendor actions | `docker/login-action`, `docker/build-push-action` | Needed for image publishing and reviewed before use |
| Blocked by default | Personal repositories and one-off uploaders | Requires a request and review before use |

The allowlist handles the supply side. The job permission block handles runtime access. A test job can usually use `contents: read`. A coverage comment job may need `pull-requests: write`. A package publish job needs `packages: write`. A cloud deploy job needs `id-token: write` only where it requests cloud identity.

Summit separates testing from commenting:

```yaml
name: checkout-api pull request

on:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
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

  coverage-comment:
    needs: test
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: checkout-api-coverage
          path: coverage/
      - uses: summit-retail/actions/coverage-comment@8f4f2ad58b3b8bc3de77e70df25b04f7b41ddbbf
        with:
          report-path: coverage/summary.json
```

`npm ci` installs from the lockfile, and `npm test -- --coverage` creates coverage output. `actions/upload-artifact` stores the coverage directory. The comment job downloads only that artifact and receives `pull-requests: write`, which keeps pull request write access out of the test job.

After pins and allowlists, updates still have to move. A frozen pin can miss bug fixes, security fixes, and platform deprecations.

## Dependabot and Update Pull Requests
<!-- section-summary: Dependabot turns action updates into reviewable pull requests instead of hidden changes behind moving references. -->

**Dependabot** is GitHub's dependency update tool. It can watch GitHub Actions workflow references and open pull requests for updated action versions. This pairs well with SHA pinning because the action stays fixed until an update PR moves it.

Summit's `.github/dependabot.yml` watches both workflow dependencies and Node dependencies:

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

The `github-actions` block asks Dependabot to inspect workflow files at the repository root. The `npm` block watches application dependencies. Keeping both in the same file helps the team treat CI dependencies and application dependencies as routine maintenance.

A Dependabot PR still needs a human review. For a low-risk setup action, the review may be quick. For a release action that publishes packages, the reviewer checks release notes, owner activity, the old commit, the new commit, generated bundles, Dockerfiles, permission changes, and the staging run.

Reusable workflows need their own review path because a central workflow can affect many service repositories.

## Reusable Workflow Review
<!-- section-summary: Reusable workflows centralize CI logic, so inputs, secrets, permissions, and rollout rules need review. -->

A **reusable workflow review** checks the workflow file that other repositories call. The reviewer looks at inputs, secrets, permissions, shell steps, action references, and rollout strategy.

Summit's central workflow for Node services looks like this:

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
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ inputs.node-version }}
          cache: npm
      - run: npm ci
        env:
          NPM_TOKEN: ${{ secrets.npm-token }}
      - run: npm test
```

The inputs are data from the caller. The workflow uses `node-version` as an input to `actions/setup-node`. If a reusable workflow passes caller-provided strings into shell commands, it should quote and validate them. The secret `npm-token` reaches only the install step through `env`, which limits exposure inside the job.

The permissions are also part of the review. This test workflow needs source checkout, so `contents: read` is enough. Release reusable workflows may need `packages: write` or `id-token: write`, and those permissions belong in the exact job that performs publishing or deployment.

Rollout needs a clear choice. If service repositories call an internal reusable workflow by branch, central fixes arrive quickly. If they call by full SHA, service teams move pins through review. Summit uses branch references only for low-risk internal test workflows with strong platform ownership. Release workflows use pinned references and planned rollouts.

Jenkins has the same dependency problem with plugins and shared libraries.

## Jenkins Plugin and Shared Library Risk
<!-- section-summary: Jenkins plugins and shared libraries run close to credentials, controllers, and agents, so installation and update rights need tight control. -->

Jenkins has a different shape from GitHub Actions. A GitHub Action usually runs inside a job on a runner. A Jenkins plugin extends the controller or agents. A shared library loads Groovy code into Pipeline. The packaging differs, and the risk question stays familiar: which outside code can affect builds, credentials, and releases?

A **Jenkins plugin** adds features such as source control integration, credential types, test reporting, cloud agents, deployment steps, or security scanning. Plugins often have deep integration with Jenkins internals, so plugin installation rights should stay with Jenkins administrators.

A **shared library** is reusable Pipeline code. A trusted library can run outside the Groovy sandbox, which gives it strong access. That power is useful for central platform logic, and it means trusted libraries need review quality similar to production deployment tooling.

Here is a `Jenkinsfile` pattern for `checkout-api`:

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

`@Library('summit-delivery-lib@2.8.3')` loads a versioned shared library. `sh 'npm ci'` installs dependencies from the lockfile, and `sh 'npm test'` runs tests. `withCredentials` exposes the registry token only inside the publish block. `publishContainer` comes from the shared library, so the library version owns part of the release behavior.

Summit keeps a Jenkins plugin inventory. Each plugin has an owner, reason, current version, update policy, advisory review path, staging test plan, backup step, and rollback note. Jenkins administrators test plugin updates on a staging controller before production. Service teams request review when a new plugin would shorten one `Jenkinsfile`.

The next dependency often hides as a shell one-liner in a README.

## Install Scripts, Uploaders, and the Codecov 2021 Incident
<!-- section-summary: Curl-based installers and uploaders run with job environment access, and the Codecov incident showed how a trusted uploader can expose CI secrets. -->

An **install script** is a script downloaded and executed during a build to install a tool, configure a scanner, or upload results. An **uploader** sends build output to another service, such as coverage reports, test results, mobile artifacts, or security scan results.

Many READMEs show this pattern:

```bash
curl -fsSL https://example.invalid/install.sh | bash
```

`curl -fsSL` downloads the remote script quietly and fails on HTTP errors. The pipe sends the downloaded script directly into `bash`, which executes it immediately. The job usually keeps no reviewed copy of the script, and the URL may serve different content tomorrow.

The Codecov 2021 incident is the classic pipeline example. Codecov reported that an unauthorized party modified its Bash Uploader, which customers used in CI pipelines to upload coverage reports. The modified uploader could export information from CI environments to an external server. Codecov advised affected customers to rotate credentials, tokens, or keys that may have been exposed.

For `checkout-api`, a risky uploader job looks like this:

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

The `npm` commands create the test and coverage output. The `curl | bash` step downloads and runs remote code in the same job that has package and OIDC permissions. That gives the uploader far more access than a coverage upload needs.

Summit separates the upload job and verifies the downloaded binary:

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

The `curl -fsSLo` command downloads the binary to a file. `sha256sum -c -` verifies the file hash against the expected checksum. `chmod +x` makes the verified file executable. The final upload command sends the coverage summary using a narrow coverage token. Package publishing and cloud identity permissions stay out of this job.

Some vendors provide signed releases or official pinned actions, which can make this cleaner. A vendor that offers only a floating remote script, with no version, checksum, signature, or reviewable source, creates a risk exception for Summit. The team then looks for a safer distribution path.

Now we can turn the review into a repeatable checklist.

## Review a New Action
<!-- section-summary: A new action review checks purpose, owner, source, pin, permissions, secrets, install behavior, network calls, maintenance, and rollback. -->

A **new action review** is the security and reliability check before a workflow depends on a new action for regular builds or releases. The review should be practical enough that service teams can complete it without guessing what platform security wants.

Summit's request asks for the action name, job name, reason, exact pinned commit, permissions, available secrets, expected network calls, owner, maintenance status, and rollback plan.

| Check | Reviewer question | Good evidence |
|---|---|---|
| Purpose | What pipeline problem does it solve? | Coverage comments help reviewers see test impact |
| Owner | Who maintains it? | Vendor-owned or organization-owned repository |
| Source | Can the code be inspected at the pin? | JavaScript, composite, Dockerfile, or release source visible |
| Pin | Is the reference immutable? | Full-length commit SHA or image digest |
| Permissions | What job permissions does it receive? | `pull-requests: write` only in the comment job |
| Secrets | Which secrets can it read? | Narrow coverage token, no deploy credentials |
| Install path | Does it download extra tools? | Checksums, signatures, or pinned releases |
| Network | Which endpoints can it call? | GitHub API and coverage vendor endpoint |
| Maintenance | Is the project active? | Releases, issue response, security policy |
| Rollback | How do we recover? | Revert PR or restore previous pin |

The review can start with a repository audit:

```bash
REPO="summit-retail/checkout-api"
mkdir -p evidence/action-review

rg --line-number "uses:" .github/workflows \
  > evidence/action-review/workflow-uses-lines.txt

rg --line-number "uses: .*@(main|master|HEAD|v[0-9]+)$" .github/workflows \
  > evidence/action-review/moving-action-references.txt || true

gh api "repos/$REPO/actions/permissions" \
  > evidence/action-review/actions-permissions.json
```

`REPO` stores the repository name. `mkdir -p` creates the evidence directory. The first `rg` command records every `uses:` line in workflow files. The second `rg` command records likely moving references such as `@main` or `@v4`. The `|| true` keeps the audit script from failing when no moving references are found. `gh api` exports the repository's Actions permission settings.

Example evidence files may look like this:

```bash
evidence/action-review/workflow-uses-lines.txt
evidence/action-review/moving-action-references.txt
evidence/action-review/actions-permissions.json
```

For a composite action, reviewers read `action.yml` and inspect shell usage:

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

The `node` command runs the action's JavaScript file and passes the report path and pull request number as arguments. Inputs and pull request values should be quoted and validated before they reach shell commands. Branch names, issue titles, commit messages, and user-controlled file paths are common places where script injection can enter a workflow.

For a Docker action, reviewers inspect the Dockerfile, base image, package installs, entrypoint, and runtime downloads. For a JavaScript action, reviewers inspect source and bundled `dist` output because the runner often executes the bundle directly.

The first rollout should use a low-risk path. Summit runs the action in a pull request job with read-only permissions first, reviews logs for accidental secret output, then decides whether the action belongs in the internal allowlist or a central reusable workflow.

## Roll Updates Safely
<!-- section-summary: Safe updates move pins through review, staging, monitoring, and rollback instead of waiting for a surprise release failure. -->

An **action update** changes the commit, tag, plugin version, shared library version, or uploader version that the pipeline runs. Updates carry two risks: the old version may have a vulnerability or deprecation, and the new version may change behavior, outputs, permissions, or network calls.

Summit handles updates as normal delivery changes. Dependabot opens GitHub Actions update PRs. Jenkins administrators open plugin update changes. The platform workflow repository publishes release notes for reusable workflow and shared library updates. Service teams review changes that affect release jobs.

A useful update PR description looks like this:

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

The reviewer checks old and new references, release notes, the diff, workflow permissions, generated bundles, Dockerfiles, install scripts, network calls, pull request results, staging release evidence, and rollback.

For sensitive release workflows, Summit tests the update with a staging tag. The staging run builds a temporary image, pushes it to a nonproduction registry namespace, and runs the same signing, SBOM, and attestation steps. The team checks image name, labels, digest, logs, and release evidence before approving the production workflow update.

For Jenkins plugins, administrators back up configuration, test updates on a staging controller, read plugin advisory notes, and schedule production updates during a maintenance window. Rollback may require restoring the previous plugin version and controller state.

For shared libraries, Summit uses semantic versions and compatibility jobs. A library release such as `2.9.0` runs against sample services before `checkout-api` moves from `2.8.3` to `2.9.0`. Release notes name service-team actions, such as new input required, old helper removed, or permission change needed.

For uploaders and install scripts, the update path should move to a signed release, checksum, pinned action, image digest, or internal wrapper. If no such path exists, the team records a risk exception or chooses a different tool.

## Putting It All Together
<!-- section-summary: Secure delivery treats pipeline extensions as code, pins what runs, limits access, and updates through review. -->

Summit Retail's `checkout-api` pipeline now has a complete third-party dependency story. Actions, reusable workflows, Jenkins plugins, shared libraries, installers, and uploaders are all code that can join the delivery path. They can read files, use tokens, make network calls, publish artifacts, and affect releases.

The controls connect. **Full-length SHA pins** give reviewers an exact action commit. **Allowlists** limit which sources may run. **Job permissions** keep approved code inside a narrow token boundary. **Dependabot** turns routine updates into pull requests. **Reusable workflow review** protects central automation. **Jenkins plugin and shared library controls** keep controller-level code and trusted Groovy paths under administrator review. **Uploader controls** keep remote scripts away from unnecessary secrets.

For day-to-day work, the habit is simple to state. A new action request should explain why the action is needed, which job runs it, what permissions and secrets it can see, which commit is pinned, how the source was reviewed, and how rollback works. An update request should explain what changed, which release notes were checked, which staging run passed, and which previous pin remains available.

![Third-party dependency loop showing request, review source, pin version, limit permissions, test in staging, and update or rollback around a central shield](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/third-party-dependency-loop.png)

*The review loop turns a new action, plugin, uploader, or workflow into a maintained dependency with a known version, narrow permissions, staging evidence, and a rollback path.*

Runner security controls where jobs run. Token boundaries control what jobs can access. Branch and environment gates control when production changes move forward. Third-party action and plugin review controls the outside code that joins those jobs. Together, those controls give Summit a delivery system the team can operate, audit, update, and recover.

## References

- [GitHub Actions: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - GitHub guidance for secure workflow use, script injection risks, token permissions, and pinning actions to full-length commit SHAs.
- [GitHub: Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) - Documents repository settings for allowed actions and reusable workflows.
- [GitHub: Keeping your actions up to date with Dependabot](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions) - Explains Dependabot configuration for the `github-actions` package ecosystem.
- [GitHub Actions: Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) - Documents `workflow_call`, caller workflows, inputs, secrets, and reusable workflow behavior.
- [GitHub Actions: Workflow syntax for reusable workflows](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_iduses) - Documents calling reusable workflows with `jobs.<job_id>.uses`.
- [GitHub: Securing builds](https://docs.github.com/en/code-security/tutorials/implement-supply-chain-best-practices/securing-builds) - GitHub supply-chain guidance for build integrity and dependency controls.
- [Jenkins: Pipeline Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Jenkins documentation for global libraries, folder libraries, and trusted shared library behavior.
- [Jenkins: Managing plugins](https://www.jenkins.io/doc/book/managing/plugins/) - Jenkins documentation for plugin installation, updates, and administrative handling.
- [Jenkins Security Advisories](https://www.jenkins.io/security/advisories/) - Official Jenkins advisories for plugin and core vulnerabilities.
- [Codecov April 2021 post-mortem](https://about.codecov.io/apr-2021-post-mortem/) - Codecov's post-mortem for the Bash Uploader incident and credential-rotation guidance.
- [OWASP CI/CD Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html) - OWASP guidance for CI/CD dependency, secret, and pipeline risks.
- [OpenSSF Scorecard](https://scorecard.dev/) - OpenSSF tool and guidance for assessing open source project security signals.

---
title: "Actions and Reusability"
description: "Understand custom actions, composite actions, reusable workflows, inputs, outputs, local paths, secrets passing, versioning, and the boundary between shared steps and shared jobs."
overview: "Shared building blocks keep repeated GitHub Actions setup and policy manageable. This article shows when to use composite actions, when to use reusable workflows, and how to design their inputs and outputs clearly."
tags: ["actions", "reusability", "composite", "compliance"]
order: 3
id: article-cicd-github-actions-reusability
aliases:
  - actions-and-reusability
  - article-cicd-github-actions-reusability
  - cicd/github-actions/actions-and-reusability.md
---

## Table of Contents

1. [Why Pipeline Copy-Paste Hurts](#why-pipeline-copy-paste-hurts)
2. [What an Action Is](#what-an-action-is)
3. [Composite Actions](#composite-actions)
4. [Inputs and Outputs](#inputs-and-outputs)
5. [Local Action Paths](#local-action-paths)
6. [Reusable Workflows](#reusable-workflows)
7. [Passing Inputs and Secrets](#passing-inputs-and-secrets)
8. [Choosing the Right Boundary](#choosing-the-right-boundary)
9. [Versioning Shared Automation](#versioning-shared-automation)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Pipeline Copy-Paste Hurts
<!-- section-summary: Reusability matters because copied workflow YAML slowly drifts across repositories and makes simple changes expensive. -->

The `checkout-api` workflow now has a good shape. It checks out code, sets up Node.js, installs dependencies, runs tests, and uses the right runner. That is a nice moment for one repository.

Then the organization grows. The team adds `catalog-api`, `pricing-api`, `email-api`, and `customer-api`. Each service uses Node.js, npm, the same lint command, the same security scanner, and the same build step. The first instinct is to copy the working YAML from `checkout-api` into every repository.

That copy-paste feels fast on day one. Six months later, the platform team needs every service to use Node.js 22, add a supply chain scanner, and upload test reports. Now the team has to change five repositories. In a larger company, that could be fifty repositories.

The real problem is **configuration drift**. Configuration drift means copies that started identical become slightly different over time. One service pins an older action version. Another skips the scanner. Another changes a cache key. Nobody meant to create a weaker pipeline, but the repeated YAML made it easy.

GitHub Actions gives you two main ways to reduce this drift: **custom actions** and **reusable workflows**. They solve different problems, so we will build up the difference carefully.

![From copy-paste to shared automation showing copied YAML drifting across repositories and a shared action restoring consistent checks](/content-assets/articles/article-cicd-github-actions-reusability/shared-automation-drift.png)

*Shared automation gives the platform team one place to fix repeated setup, scanners, and cache behavior instead of chasing drift across many copied workflow files.*

## What an Action Is
<!-- section-summary: An action is a reusable step package that a workflow calls with `uses`, and it can be maintained separately from the workflow that calls it. -->

An **action** is a reusable package of automation that runs as a step inside a job. A workflow calls an action with `uses`. You have already seen official actions such as `actions/checkout@v6` and `actions/setup-node@v4`.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v4
    with:
      node-version: 22
```

The workflow does not need to know every internal command these actions run. `actions/checkout` knows how to fetch repository contents. `actions/setup-node` knows how to find or install Node.js and put it on `PATH`. The workflow provides inputs, and the action performs the step-level work.

GitHub supports different action types. A **JavaScript action** runs JavaScript code. A **Docker action** runs inside a Docker container. A **composite action** groups several workflow steps into one reusable action. For shared pipeline setup, composite actions are often the most beginner-friendly because they look like normal workflow steps packaged into `action.yml`.

The team has copied the same Node.js setup block into every service. That is a perfect place to start with a composite action.

## Composite Actions
<!-- section-summary: A composite action packages several steps so many workflows can call them as one step inside an existing job. -->

A **composite action** collects multiple steps and exposes them as one action. It runs inside the caller's job, on the caller's runner, with the caller's checked-out workspace and environment. This is useful for shared setup, validation, formatting, or small deployment helper steps.

Imagine every Node.js service has this repeated block. The commands are reasonable in one repository, but the repetition starts to hurt once many repositories copy them.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: npm
  - run: npm ci
  - run: npm run lint
  - run: npm test
```

The platform team can place a composite action in a shared repository, for example `platform/actions-node-checks`. The action metadata file must be named `action.yml` or `action.yaml`.

```yaml
name: Node Checks
description: Prepare Node.js, install dependencies, lint, and test

inputs:
  node-version:
    description: Node.js version to use
    required: false
    default: "22"

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: npm
    - run: npm ci
      shell: bash
    - run: npm run lint
      shell: bash
    - run: npm test
      shell: bash
```

Then each service workflow is smaller. The service still owns the checkout and the job, while the shared action owns the repeated validation steps.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: platform/actions-node-checks@v1
        with:
          node-version: 22
```

The checkout step stays in the caller workflow because the caller owns the repository being tested. The composite action handles the repeated Node.js validation steps after the files are present.

Composite actions are good when you want to reuse steps inside a job. The next layer is designing the small interface those steps expose.

## Inputs and Outputs
<!-- section-summary: Inputs let callers configure shared automation, and outputs let later steps read values produced by that automation. -->

An **input** is a value the caller passes into an action. Inputs make a shared action flexible without asking callers to edit the action internals. In the Node.js example, `node-version` is an input because different services may move runtime versions at different times.

An **output** is a value an action produces for later steps. Outputs are useful when the shared action computes something the workflow needs, such as an image tag, artifact name, package version, or deployment URL.

Here is a composite action that computes a Docker image tag from the Git SHA. The action writes the value to `$GITHUB_OUTPUT` so later steps can read it by name.

```yaml
name: Image Tag
description: Create a short image tag from the current commit

outputs:
  image-tag:
    description: Short image tag
    value: ${{ steps.tag.outputs.image-tag }}

runs:
  using: composite
  steps:
    - id: tag
      run: echo "image-tag=${GITHUB_SHA::12}" >> "$GITHUB_OUTPUT"
      shell: bash
```

The caller can read that output through the step ID. The step ID gives the caller a handle for the values the action publishes.

```yaml
steps:
  - id: image
    uses: platform/actions-image-tag@v1
  - run: docker build -t ghcr.io/acme/checkout-api:${{ steps.image.outputs.image-tag }} .
```

Inputs and outputs should stay boring and explicit. A good input name tells the caller what decision they are making. A good output name tells later steps what value they receive.

The action now has a clean interface. The next common bug is file paths, especially when a composite action includes scripts.

## Local Action Paths
<!-- section-summary: Composite actions should use the action path when running bundled scripts because the caller workspace and action directory are different places. -->

A composite action often includes shell scripts. For example, `platform/actions-node-checks` might include `scripts/print-summary.sh` next to `action.yml`. The action needs to run that script from the action's own directory, not from the caller repository's root.

This distinction matters because the caller workspace contains `checkout-api`, while the action files live in the downloaded action directory. A command like `./scripts/print-summary.sh` points at the caller repository, not necessarily at the action package.

GitHub exposes the action package path through `github.action_path`. A composite action can use that value to run scripts bundled with the action, and the environment variable keeps the command easier to scan.

```yaml
name: Node Checks
description: Prepare Node.js, install dependencies, lint, test, and print a summary

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
      shell: bash
    - run: npm test
      shell: bash
    - run: "$ACTION_PATH/scripts/print-summary.sh"
      shell: bash
      env:
        ACTION_PATH: ${{ github.action_path }}
```

This makes the script path stable. The action can be used from many repositories because the script lookup follows the action package, not the caller's folder layout.

Composite actions solve repeated steps. Some repeated automation needs a bigger boundary: whole jobs, runner choices, permissions, environments, and policy gates. That is the reusable workflow boundary.

## Reusable Workflows
<!-- section-summary: A reusable workflow shares one or more jobs, so teams can centralize complete pipeline stages instead of only shared steps. -->

A **reusable workflow** is a workflow that another workflow calls as a job. It uses the `workflow_call` event and can define inputs, secrets, and outputs. This is a better fit when the shared unit is a whole pipeline stage rather than a few steps.

For example, the security team may require every service to run the same dependency review, secret scanning, and container policy checks. Those checks should use approved permissions, a known runner, and standard reporting. A composite action can package steps, but it cannot own the entire job boundary in the same way.

A reusable workflow might live in `.github/workflows/service-security.yml` in a shared repository. The `workflow_call` trigger marks it as something another workflow can call.

```yaml
name: Service Security

on:
  workflow_call:
    inputs:
      service-name:
        required: true
        type: string

jobs:
  security:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v6
      - run: ./scripts/security-scan.sh "${{ inputs.service-name }}"
```

A service repository calls it like this. The caller sees one job, while the shared repository owns the detailed security steps.

```yaml
jobs:
  security:
    uses: acme/platform-workflows/.github/workflows/service-security.yml@v1
    with:
      service-name: checkout-api
```

Notice the job uses `uses` directly. That is the reusable workflow call. The called workflow owns its internal jobs, runner choices, permissions, and steps. The caller passes the values the shared workflow asks for.

This is a larger boundary than a composite action. That larger boundary is useful for policy, but it also means inputs and secrets must be designed carefully.

## Passing Inputs and Secrets
<!-- section-summary: Reusable workflows receive inputs and secrets through an explicit interface, which makes shared pipeline trust easier to review. -->

Reusable workflows use typed inputs. Each input can be a `string`, `number`, or `boolean`. If a caller passes an input the reusable workflow has not declared, GitHub treats that as an error. This protects the shared workflow interface from accidental misspellings and mystery values.

Secrets also need explicit handling. A secret is a sensitive value such as a token, password, or signing key. Reusable workflows do not automatically receive every secret from the caller, so the caller must pass the secret intentionally or use a supported inheritance pattern inside the same organization or enterprise trust boundary.

Here is a reusable deployment workflow that declares one secret. The declaration tells callers exactly which sensitive value the shared workflow expects.

```yaml
name: Service Deploy

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
    secrets:
      deploy-token:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - run: ./scripts/deploy.sh "${{ inputs.environment }}" "${{ inputs.image-tag }}"
        env:
          DEPLOY_TOKEN: ${{ secrets.deploy-token }}
```

The caller passes the inputs and maps the secret. This keeps the trust boundary visible in the caller workflow.

```yaml
jobs:
  deploy:
    uses: acme/platform-workflows/.github/workflows/service-deploy.yml@v1
    with:
      environment: staging
      image-tag: ${{ needs.build.outputs.image-tag }}
    secrets:
      deploy-token: ${{ secrets.STAGING_DEPLOY_TOKEN }}
```

This interface makes review easier. A maintainer can see which values cross from the service repository into the shared workflow. That is especially important for deployments because secrets and environments are part of the security boundary.

Now we can compare the two reuse tools directly. The right choice depends on whether the shared unit is a group of steps or a complete job boundary.

## Choosing the Right Boundary
<!-- section-summary: Composite actions are best for shared steps inside one job, while reusable workflows are best for shared jobs, permissions, environments, and policy. -->

The simplest question is scope. A **composite action** shares steps inside the caller's job. A **reusable workflow** shares one or more whole jobs. That one difference explains most design choices.

| Need | Better fit | Why |
|---|---|---|
| Install dependencies and run the same lint command | Composite action | The caller already owns the job and runner |
| Compute an image tag for later steps | Composite action | The output belongs inside the caller job |
| Run a standard organization security scan | Reusable workflow | The platform team should own job permissions and reporting |
| Deploy through a protected environment | Reusable workflow | The shared workflow can own environment and approval shape |
| Share a helper script used by many workflows | Composite action | The script is a step-level tool |
| Share a full release process with build, attest, and publish jobs | Reusable workflow | The process spans jobs and policy boundaries |

For the service team, a good pattern is to keep product-specific choices in the service workflow and centralize repeated mechanics. The service workflow can say, "this repository is `checkout-api`, and it deploys to `staging`." The shared action or workflow can say, "this is how we install dependencies, scan code, build images, and deploy safely." That division keeps ownership clear.

The boundary should make responsibility clearer. Composite actions help developers avoid repeated commands. Reusable workflows help platform teams enforce shared delivery standards.

![Composite action versus reusable workflow decision map showing shared steps inside a caller job and shared jobs with permissions and secrets](/content-assets/articles/article-cicd-github-actions-reusability/composite-action-vs-reusable-workflow.png)

*Composite actions are a step-level reuse tool, while reusable workflows are the better boundary for shared jobs, permissions, environments, and deployment policy.*

Shared automation now exists. The last practical question is how callers should reference it over time.

## Versioning Shared Automation
<!-- section-summary: Shared actions and workflows should be referenced by stable versions so teams can upgrade intentionally and avoid surprise behavior changes. -->

When a workflow calls `platform/actions-node-checks@v1`, the part after `@` is the ref. It can point to a branch, tag, or commit SHA. That reference controls when callers receive changes.

A branch reference such as `@main` gives callers the newest changes immediately. That can be convenient during early development, but it can also break many repositories at once. A tag such as `@v1` gives a stable release line. A commit SHA gives the strongest immutability because it points to one exact commit.

For internal platform automation, many teams use semantic tags such as `v1`, `v1.2.0`, or pinned SHAs depending on risk. A low-risk formatting helper may be fine on `@v1`. A production deployment workflow may deserve a specific release tag or SHA so the service team upgrades in a controlled pull request.

The platform team should publish release notes for shared automation. A small change like "Node.js 22 is now the default" affects build behavior. A bigger change like "deployment now requires an environment input" affects every caller's YAML.

Reusability is powerful because one fix can help many repositories. The same power means one mistake can reach many repositories, so versioning is part of the design.

## Putting It All Together
<!-- section-summary: A mature service workflow can call a composite action for local setup and a reusable workflow for shared security or deployment policy. -->

Here is a practical `checkout-api` workflow after the team introduces shared automation. The service workflow stays short, but the important decisions are still visible.

```yaml
name: Service Checks

on:
  pull_request:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.image.outputs.image-tag }}
    steps:
      - uses: actions/checkout@v6
      - uses: acme/platform-actions/node-checks@v1
        with:
          node-version: 22
      - id: image
        uses: acme/platform-actions/image-tag@v1

  security:
    uses: acme/platform-workflows/.github/workflows/service-security.yml@v1
    with:
      service-name: checkout-api

  staging-deploy:
    needs:
      - test
      - security
    uses: acme/platform-workflows/.github/workflows/service-deploy.yml@v1
    with:
      environment: staging
      image-tag: ${{ needs.test.outputs.image-tag }}
    secrets:
      deploy-token: ${{ secrets.STAGING_DEPLOY_TOKEN }}
```

The `test` job uses composite actions because it is still one job owned by the service repository. The `security` and `staging-deploy` jobs call reusable workflows because they represent shared organization stages with their own permissions, reporting, and environment behavior.

This keeps the service repository readable. It also gives the platform team one place to improve repeated logic. When the scanner changes, the shared workflow changes. When the Node.js setup improves, the shared composite action changes. Service teams consume those improvements through versioned references.

![Reusable automation release path showing build shared step, define inputs, return outputs, pin version, test in one repo, roll out gradually, and audit consumers](/content-assets/articles/article-cicd-github-actions-reusability/reusable-automation-release-path.png)

*A safe shared-automation rollout starts with a clear interface, pins versions, tests one service first, and expands gradually so many repositories do not all break at once.*

## What's Next
<!-- section-summary: The next article focuses on secrets, environments, approvals, token permissions, and keyless cloud authentication. -->

You now have a way to share repeated automation. That gives us a new responsibility: shared pipelines often handle secrets, deployments, and cloud access.

The next article focuses on **environments and security**. We will look at repository secrets, environment secrets, approval gates, `GITHUB_TOKEN` permissions, OpenID Connect, and how a workflow can deploy to cloud infrastructure without storing long-lived cloud keys.

---

**References**

- [About custom actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/custom-actions) - Explains JavaScript, Docker, and composite actions, plus the action metadata file.
- [Creating a composite action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action) - Shows composite action structure, inputs, outputs, and `github.action_path`.
- [Metadata syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax) - Documents `action.yml` fields, inputs, outputs, and `runs` syntax.
- [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) - Explains reusable workflows, `workflow_call`, inputs, secrets, outputs, and nesting.
- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Documents `on.workflow_call`, typed inputs, reusable workflow jobs, and secrets mapping.
- [Sharing actions and workflows with your organization](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization) - Covers sharing reusable automation across organization repositories.

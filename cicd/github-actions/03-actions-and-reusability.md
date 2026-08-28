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

1. [Why Does Copying YAML Create Drift, and What Does an Action Abstract?](#why-does-copying-yaml-create-drift-and-what-does-an-action-abstract)
2. [How Do Composite Actions Expose Inputs and Outputs?](#how-do-composite-actions-expose-inputs-and-outputs)
3. [How Do Local and Shared Action Paths Work?](#how-do-local-and-shared-action-paths-work)
4. [How Do Reusable Workflows Pass Inputs, Secrets, and Outputs?](#how-do-reusable-workflows-pass-inputs-secrets-and-outputs)
5. [How Do Reuse Boundaries Separate Mechanism from Policy?](#how-do-reuse-boundaries-separate-mechanism-from-policy)
6. [How Should Shared Automation Be Versioned and Owned?](#how-should-shared-automation-be-versioned-and-owned)
7. [What Should Stay in Scripts Instead of One Universal Action?](#what-should-stay-in-scripts-instead-of-one-universal-action)
8. [How Does a Complete Shared-Automation Design Fit Together?](#how-does-a-complete-shared-automation-design-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The `node-service` workflow now has a good shape. It checks out code, sets up Node.js, installs dependencies, runs tests, and uses the right runner. That is a nice moment for one repository.

Then the organization grows from five Node services to twenty. Each service uses Node.js, npm, the same tests, the same security scanner, and the same build and deployment sequence. The first instinct is to copy the working YAML into every repository.

That copy-paste feels fast on day one. Six months later, the platform team needs every service to use Node.js 24, add a supply chain scanner, and upload test reports. Now the team has to change five repositories. In a larger company, that could be fifty repositories.

The real problem is **configuration drift**. Configuration drift means copies that started identical become slightly different over time. One service pins an older action version. Another skips the scanner. Another changes a cache key. Nobody meant to create a weaker pipeline, but the repeated YAML made it easy.

Keep these questions in view as you work through the lesson:

1. **Why Does Copying YAML Create Drift, and What Does an Action Abstract?**
2. **How Do Composite Actions Expose Inputs and Outputs?**
3. **How Do Local and Shared Action Paths Work?**
4. **How Do Reusable Workflows Pass Inputs, Secrets, and Outputs?**
5. **How Do Reuse Boundaries Separate Mechanism from Policy?**
6. **How Should Shared Automation Be Versioned and Owned?**
7. **What Should Stay in Scripts Instead of One Universal Action?**
8. **How Does a Complete Shared-Automation Design Fit Together?**

## Why Does Copying YAML Create Drift, and What Does an Action Abstract?
<!-- section-summary: Reusability matters because copied workflow YAML slowly drifts across repositories and makes simple changes expensive. -->

GitHub Actions gives you two main ways to reduce this drift: **custom actions** and **reusable workflows**. They solve different problems, so we will build up the difference carefully.

![From copy-paste to shared automation showing copied YAML drifting across repositories and a shared action restoring consistent checks](/content-assets/articles/article-cicd-github-actions-reusability/shared-automation-drift.png)

*Shared automation gives the platform team one place to fix repeated setup, scanners, and cache behavior instead of chasing drift across many copied workflow files.*

<!-- section-summary: An action is a reusable step package that a workflow calls with `uses`, and it can be maintained separately from the workflow that calls it. -->

An **action** is a reusable package of automation that runs as a step inside a job. A workflow calls an action with `uses`. You have already seen official actions such as `actions/checkout@v4` and `actions/setup-node@v4`.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24
```

The workflow does not need to know every internal command these actions run. `actions/checkout` knows how to fetch repository contents. `actions/setup-node` knows how to find or install Node.js and put it on `PATH`. The workflow provides inputs, and the action performs the step-level work.

GitHub supports different action types. A **JavaScript action** runs JavaScript code. A **Docker action** runs inside a Docker container. A **composite action** groups several workflow steps into one reusable action. For shared pipeline setup, composite actions are often the most beginner-friendly because they look like normal workflow steps packaged into `action.yml`.

The function analogy is useful because it exposes the whole interface:

| Ordinary software | GitHub Actions |
|---|---|
| Function | Action |
| Function arguments | Inputs |
| Return value | Outputs |
| Function body | Action implementation |
| Library directory or package | Action directory or repository |
| Library version | Tag, branch, or commit after `@` |

When a workflow says `uses: my-org/build-node-app@v3`, GitHub does not execute the action somewhere unrelated to the job. The job already has a runner. The runner obtains the referenced action implementation and runs it in that job's execution environment. A JavaScript action supplies packaged Node-based code, a Docker action supplies a containerized implementation, and a composite action expands into a sequence of steps. The caller sees one operation even though the implementation may contain many operations.

That is the first design test for an action: can the caller name the useful behavior without knowing how it is implemented? `checkout` means “materialize this repository.” A company action might mean “authenticate to the cloud,” “build a Node service,” “publish an image,” or “run the approved security scans.”

The team has copied the same Node.js setup block into every service. That is a perfect place to start with a composite action.

## How Do Composite Actions Expose Inputs and Outputs?
<!-- section-summary: A composite action packages several steps so many workflows can call them as one step inside an existing job. -->

A **composite action** collects multiple steps and exposes them as one action. It runs inside the caller's job, on the caller's runner, with the caller's checked-out workspace and environment. This is useful for shared setup, validation, formatting, or small deployment helper steps.

Imagine every Node.js service has this repeated block. The commands are reasonable in one repository, but the repetition starts to hurt once many repositories copy them.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24
      cache: npm
  - run: npm ci
  - run: npm run lint
  - run: npm test
```

The platform team can place a composite action in a shared repository, for example `my-org/node-checks`. The action metadata file must be named `action.yml` or `action.yaml`.

```yaml
name: Node Checks
description: Prepare Node.js, install dependencies, lint, and test

inputs:
  node-version:
    description: Node.js version to use
    required: false
    default: "24"

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
      - uses: actions/checkout@v4
      - uses: my-org/node-checks@v1
        with:
          node-version: 24
```

The checkout step stays in the caller workflow because the caller owns the repository being tested. The composite action handles the repeated Node.js validation steps after the files are present.

Composite actions are good when you want to reuse steps inside a job. The next layer is designing the small interface those steps expose.

The value is not merely a lower YAML line count. Before the action, callers reason about “set up Node, restore npm data, install packages, test, and build.” After the action, they reason about “build the Node application.” That higher-level name gives the implementation room to change without forcing every caller to learn its internal sequence.

An action called `run-command` with a free-form `command` input would not create that abstraction. It would turn a clear `run: npm test` step into a less clear indirect call. Useful actions package stable concepts such as `configure-company-npm`, `generate-version`, or `publish-container-image`; they do not wrap syntax merely to make it look shared.

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
    uses: my-org/image-tag@v1
  - run: docker build -t ghcr.io/my-org/node-service:${{ steps.image.outputs.image-tag }} .
```

Inputs and outputs should stay boring and explicit. A good input name tells the caller what decision they are making. A good output name tells later steps what value they receive.

Treat those names as a public API. A weak interface exposes every internal command, cache path, shell, and implementation toggle. Callers then depend on details the action was supposed to hide. A stronger interface exposes the few choices that are truly variable, such as `node-version` and `run-tests`, supplies safe defaults, and lets the action own the rest.

Outputs follow the same rule. If an image-building action calculates `2026.08.23-a3cf912`, it can publish that value once as `image-tag`. The caller assigns an `id` to the action step and reads `${{ steps.build.outputs.image-tag }}` later. That is the workflow equivalent of assigning a function's return value to a variable.

The action now has a clean interface. The next common bug is file paths, especially when a composite action includes scripts.

## How Do Local and Shared Action Paths Work?
<!-- section-summary: Composite actions should use the action path when running bundled scripts because the caller workspace and action directory are different places. -->

A composite action often includes shell scripts. For example, `my-org/node-checks` might include `scripts/print-summary.sh` next to `action.yml`. The action needs to run that script from the action's own directory, not from the caller repository's root.

This distinction matters because the caller workspace contains `node-service`, while the action files live in the downloaded action directory. A command like `./scripts/print-summary.sh` points at the caller repository, not necessarily at the action package.

GitHub exposes the action package path through `github.action_path`. A composite action can use that value to run scripts bundled with the action, and the environment variable keeps the command easier to scan.

```yaml
name: Node Checks
description: Prepare Node.js, install dependencies, lint, test, and print a summary

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: 24
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

A local action uses a different reference shape:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/build
```

The `./` means the implementation comes from the current repository's filesystem. Checkout must happen first because the local action does not exist in the runner workspace until the repository has been materialized. This is a good boundary for behavior shared by several workflows in one repository, including a monorepo with frontend, backend, and worker directories.

When many repositories need the same behavior, move the action to a shared repository and call a versioned path such as `my-company/github-actions/build-node@v3`. That arrangement resembles a shared library: each service depends on one maintained implementation and adopts fixes through an intentional version update. It also turns CI/CD automation into a platform product with consumers, releases, compatibility promises, and owners.

Composite actions solve repeated steps. Some repeated automation needs a bigger boundary: whole jobs, runner choices, permissions, environments, and policy gates. That is the reusable workflow boundary.

## How Do Reusable Workflows Pass Inputs, Secrets, and Outputs?
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
      - uses: actions/checkout@v4
      - run: ./scripts/security-scan.sh "${{ inputs.service-name }}"
```

A service repository calls it like this. The caller sees one job, while the shared repository owns the detailed security steps.

```yaml
jobs:
  security:
    uses: my-org/platform-workflows/.github/workflows/service-security.yml@v1
    with:
      service-name: node-service
```

Notice the job uses `uses` directly. That is the reusable workflow call. The called workflow owns its internal jobs, runner choices, permissions, and steps. The caller passes the values the shared workflow asks for.

This is a larger boundary than a composite action. That larger boundary is useful for policy, but it also means inputs and secrets must be designed carefully.

A reusable workflow can create a graph of jobs. It may define `test` and `security` in parallel, make `build` depend on both, and expose the result to its caller. A composite action cannot create that graph because it executes as steps within one job. This is why a reusable workflow is closer to a higher-order function that can schedule work, choose runners, assign permissions, and apply environments.

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
    uses: my-org/platform-workflows/.github/workflows/service-deploy.yml@v1
    with:
      environment: staging
      image-tag: ${{ needs.build.outputs.image-tag }}
    secrets:
      deploy-token: ${{ secrets.STAGING_DEPLOY_TOKEN }}
```

This interface makes review easier. A maintainer can see which values cross from the service repository into the shared workflow. That is especially important for deployments because secrets and environments are part of the security boundary.

Secrets are separate from ordinary inputs on purpose. A caller passes a declared secret under `secrets`, and the called workflow reads it from the `secrets` context. The value is not automatically turned into an ordinary input, and a called workflow does not receive every caller secret by default. `secrets: inherit` can deliberately forward the caller's available secrets in supported organization or enterprise relationships, but explicit mapping is easier to audit when only one or two credentials are required.

Passing a secret to a reusable workflow also does not make it globally available to every possible nested call. Each boundary must deliberately forward what the next boundary needs. That rule limits accidental credential propagation through a chain of reusable automation.

Reusable workflows can return values as well. A job first publishes an output, and `on.workflow_call.outputs` maps it into the reusable workflow's public interface. The caller can then use `${{ needs.build.outputs.image-tag }}` just as it would consume output from a local job. The levels matter: a step writes a step output, a job maps the step output to a job output, and the reusable workflow maps the job output to a workflow output.

Now we can compare the two reuse tools directly. The right choice depends on whether the shared unit is a group of steps or a complete job boundary.

## How Do Reuse Boundaries Separate Mechanism from Policy?
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

For the service team, a good pattern is to keep product-specific choices in the service workflow and centralize repeated mechanics. The service workflow can say, "this repository is `node-service`, and it deploys to `staging`." The shared action or workflow can say, "this is how we install dependencies, scan code, build images, and deploy safely." That division keeps ownership clear.

The boundary should make responsibility clearer. Composite actions help developers avoid repeated commands. Reusable workflows help platform teams enforce shared delivery standards.

![Composite action versus reusable workflow decision map showing shared steps inside a caller job and shared jobs with permissions and secrets](/content-assets/articles/article-cicd-github-actions-reusability/composite-action-vs-reusable-workflow.png)

*Composite actions are a step-level reuse tool, while reusable workflows are the better boundary for shared jobs, permissions, environments, and deployment policy.*

Shared automation now exists. The last practical question is how callers should reference it over time.

<!-- section-summary: Composite actions often package reusable mechanisms, while reusable workflows can combine those mechanisms into an organization-owned policy. -->

The action-versus-workflow decision also separates **mechanism** from **policy**. A mechanism is a reusable capability: authenticate, scan, build, compute a version, or upload an image. Policy describes which capabilities must run, in what order, with which permissions and approvals.

A composite action is often a good mechanism boundary:

```text
scan-container(image)
authenticate-cloud(role)
build-node-service(version)
```

A reusable workflow can compose those mechanisms into a policy:

```text
required-release-policy
  -> test
  -> scan
  -> build
  -> attest
  -> deploy through protected environment
```

This split prevents two opposite mistakes. If every repository assembles all policy itself, the organization gets drift. If one enormous action hides the entire release, callers lose useful job boundaries, permissions, approvals, and observability. Smaller actions remain composable, while the reusable workflow declares the standard job graph.

Composition is what makes the model powerful. A reusable release workflow can call a build action, a scan action, and an authentication action. Another workflow can reuse the same scan action without adopting the entire release policy. Teams therefore share the smallest stable capabilities and centralize only the higher-level rules that truly need consistent ownership.

The practical design question is not “which feature is more advanced?” It is “what should the caller be able to see and control?” Keep product decisions at the service boundary. Centralize implementation details and organization policy at the boundary that owns them.

## How Should Shared Automation Be Versioned and Owned?
<!-- section-summary: Shared actions and workflows should be referenced by stable versions so teams can upgrade intentionally and avoid surprise behavior changes. -->

When a workflow calls `my-org/node-checks@v1`, the part after `@` is the ref. It can point to a branch, tag, or commit SHA. That reference controls when callers receive changes.

A branch reference such as `@main` gives callers the newest changes immediately. That can be convenient during early development, but it can also break many repositories at once. A tag such as `@v1` gives a stable release line. A commit SHA gives the strongest immutability because it points to one exact commit.

For internal platform automation, many teams use semantic tags such as `v1`, `v1.2.0`, or pinned SHAs depending on risk. A low-risk formatting helper may be fine on `@v1`. A production deployment workflow may deserve a specific release tag or SHA so the service team upgrades in a controlled pull request.

The platform team should publish release notes for shared automation. A small change like "Node.js 24 is now the default" affects build behavior. A bigger change like "deployment now requires an environment input" affects every caller's YAML.

Reusability is powerful because one fix can help many repositories. The same power means one mistake can reach many repositories, so versioning is part of the design.

Third-party actions deserve especially careful pinning because the referenced code runs on the job's runner and may see its token, workspace, or secrets. A floating branch can change without a review in the consuming repository. A full commit SHA identifies immutable content; a major tag such as `@v3` is easier to update but can move within that release line. The organization can choose the balance by risk, but it should make the choice consciously.

Reusable workflows follow the same versioning model. Calling `my-org/platform-workflows/.github/workflows/node-ci.yml@v4` selects both a path and a revision. A breaking input, permission, runner, or output change should become a new major interface rather than silently surprising existing callers.

Centralization also creates ownership work. Someone must review changes, test releases, document inputs and outputs, respond to failures, publish upgrade notes, support old versions for a defined period, and identify consumers. Without that product ownership, a “shared” repository becomes a bottleneck that everyone depends on and nobody confidently changes.

A safe rollout starts with the new implementation pinned in one repository. After it passes there, expand to a small group, observe failures, and then update the wider consumer set. The ability to fix once is valuable only when versioning and rollout prevent one mistake from breaking every repository at once.

## What Should Stay in Scripts Instead of One Universal Action?
<!-- section-summary: Scripts remain useful for executable domain logic, while actions and workflows provide the GitHub-specific interface and orchestration around them. -->

Not every reusable command needs to become an action. A script can remain the best home for substantial executable logic because developers can run and test it locally, other CI systems can invoke it, and ordinary language tooling can validate it.

A useful division is:

| Logic | Natural home |
|---|---|
| Portable build or validation algorithm | Script or program |
| GitHub step interface with inputs and outputs | Action |
| Job graph, runners, permissions, environments, and gates | Reusable workflow |

For example, `scripts/verify-release.sh` can contain the portable verification logic. A composite action can translate GitHub inputs into script arguments and publish outputs. A reusable workflow can decide when that action runs, which permissions it receives, and which jobs must succeed first. These layers complement one another.

Avoid a gigantic universal action with dozens of mode flags such as `do-build`, `do-scan`, `do-deploy`, `cloud-provider`, `environment`, and `skip-tests`. That interface exposes every possible branch and makes behavior difficult to predict. It also couples unrelated release mechanisms so changing one risks all consumers.

Prefer focused, composable units with clear names. `build-node-service`, `scan-container`, and `publish-image` can evolve separately. A release workflow can arrange them into a standard path. If a repository needs only the scan, it can call only the scan. The result resembles well-designed software: small APIs, explicit composition, and a clear layer for orchestration.

## How Does a Complete Shared-Automation Design Fit Together?
<!-- section-summary: A mature service workflow can call a composite action for local setup and a reusable workflow for shared security or deployment policy. -->

Here is a practical `node-service` workflow after the team introduces shared automation. The service workflow stays short, but the important decisions are still visible.

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
      - uses: actions/checkout@v4
      - uses: my-org/platform-actions/node-checks@v1
        with:
          node-version: 24
      - id: image
        uses: my-org/platform-actions/image-tag@v1

  security:
    uses: my-org/platform-workflows/.github/workflows/service-security.yml@v1
    with:
      service-name: node-service

  staging-deploy:
    needs:
      - test
      - security
    uses: my-org/platform-workflows/.github/workflows/service-deploy.yml@v1
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

## Check Your Answers

:::expand[Why Does Copying YAML Create Drift, and What Does an Action Abstract?]{kind="recap"}
Repeated pipelines are repeated programs. Copies start equal, then diverge as teams upgrade runtimes, scanners, authentication, and deployment logic at different times. Reuse creates one maintained abstraction that consumers adopt through an explicit version.

An action is a reusable unit of executable workflow behavior with inputs, outputs, an implementation, and a version. The job's runner obtains and executes that implementation. JavaScript, Docker, and composite actions package the implementation differently but present a step-like call to the workflow.
:::

:::expand[How Do Composite Actions Expose Inputs and Outputs?]{kind="recap"}
A composite action groups several steps inside the caller's job and runner. Its value is semantic: callers ask to “build the Node application” instead of repeating setup, install, test, and build details. A wrapper that adds only indirection is not a useful abstraction.

Inputs are function-like parameters and outputs are return values. Expose only stable caller decisions, use safe defaults, hide internal commands, and give outputs clear names. The caller assigns the action step an ID to read its published outputs later.
:::

:::expand[How Do Local and Shared Action Paths Work?]{kind="recap"}
A local `./.github/actions/...` reference needs checkout first because its files live in the current repository. A versioned owner/repository/path reference downloads shared behavior from another repository. Local actions serve one codebase; shared actions act like organization libraries.
:::

:::expand[How Do Reusable Workflows Pass Inputs, Secrets, and Outputs?]{kind="recap"}
Use a reusable workflow when the abstraction needs whole jobs, dependencies, runners, permissions, environments, or policy gates. It declares `workflow_call` and is invoked with `uses` at the job level. A composite action cannot create a multi-job graph.

Reusable workflows declare typed inputs and separate secrets. Callers deliberately map sensitive values, and nested boundaries must deliberately forward them. Outputs move from step to job to called-workflow interface before the caller can consume them through `needs`.
:::

:::expand[How Do Reuse Boundaries Separate Mechanism from Policy?]{kind="recap"}
Choose a composite action for a shared operation inside an existing job. Choose a reusable workflow for a shared job or graph that owns orchestration and policy. The best boundary clarifies who controls runner choice, permissions, environment, and product-specific decisions.

Focused actions often package mechanisms such as building, scanning, or authenticating. Reusable workflows compose those mechanisms into organization policy with ordering, permissions, and gates. This keeps capabilities reusable without forcing every consumer to reconstruct policy.
:::

:::expand[How Should Shared Automation Be Versioned and Owned?]{kind="recap"}
Branches float, tags provide release lines, and full commit SHAs provide immutable references. Select by risk, publish breaking interfaces as new versions, and roll changes out gradually. Owners must test releases, document contracts, support consumers, and retire old versions deliberately.
:::

:::expand[What Should Stay in Scripts Instead of One Universal Action?]{kind="recap"}
Portable executable logic can stay in a script or program. An action adapts it to GitHub inputs and outputs, while a reusable workflow orchestrates jobs and policy. Prefer several focused units over one universal action with many unrelated flags and modes.
:::

:::expand[How Does a Complete Shared-Automation Design Fit Together?]{kind="recap"}
The service workflow retains product choices, calls composite actions for step-level mechanisms, and calls reusable workflows for organization-owned security or deployment stages. Explicit inputs, outputs, secrets, permissions, and pinned versions make every boundary reviewable.
:::

## References

- [About custom actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/custom-actions) - Explains JavaScript, Docker, and composite actions, plus the action metadata file.
- [Creating a composite action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action) - Shows composite action structure, inputs, outputs, and `github.action_path`.
- [Metadata syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax) - Documents `action.yml` fields, inputs, outputs, and `runs` syntax.
- [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) - Explains reusable workflows, `workflow_call`, inputs, secrets, outputs, and nesting.
- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Documents `on.workflow_call`, typed inputs, reusable workflow jobs, and secrets mapping.
- [Sharing actions and workflows with your organization](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization) - Covers sharing reusable automation across organization repositories.

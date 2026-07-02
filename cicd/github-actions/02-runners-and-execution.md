---
title: "Runners and Execution"
description: "Understand GitHub-hosted runners, self-hosted runners, runner labels, checkout behavior, system dependencies, language setup actions, containers, and runner security."
overview: "A workflow file describes what should happen, but a runner is the machine that does the work. This article follows a real job from queue to execution so runner choice, workspace setup, dependency installation, and security boundaries make sense."
tags: ["runners", "containers", "execution", "security"]
order: 2
id: article-cicd-github-actions-runners-and-execution
aliases:
  - runners-and-execution
  - article-cicd-github-actions-runners-and-execution
  - cicd/github-actions/runners-and-execution.md
---

## Table of Contents

1. [Commands Need a Machine](#commands-need-a-machine)
2. [What a Runner Is](#what-a-runner-is)
3. [GitHub-Hosted Runners](#github-hosted-runners)
4. [Self-Hosted Runners](#self-hosted-runners)
5. [Runner Labels and Targeting](#runner-labels-and-targeting)
6. [The Workspace and Checkout](#the-workspace-and-checkout)
7. [Installing System Dependencies](#installing-system-dependencies)
8. [Language Setup and Tool Caches](#language-setup-and-tool-caches)
9. [Containers and Services](#containers-and-services)
10. [Security Boundaries for Runners](#security-boundaries-for-runners)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## Commands Need a Machine
<!-- section-summary: Workflow YAML describes commands, but every command still needs CPU, memory, disk, network access, and an operating system. -->

The first article showed how events start workflow runs and how jobs contain steps. Now we need to follow the job after GitHub queues it. The YAML says `npm test`, but those words still need a real place to run.

A **runner** is that place. It is the machine that receives a job, prepares a working directory, runs the steps, streams logs back to GitHub, and reports the final result. The machine might be a fresh GitHub-hosted virtual machine, a larger managed runner, or a server your organization owns.

This matters because many CI/CD failures are ordinary system failures wearing a workflow costume. A test can fail because the code is broken, but it can also fail because the runner has the wrong Node.js version, a missing Linux package, a full disk, blocked network access, or stale files left from a previous job.

We will keep using `checkout-api`. The team already has pull request checks. The next step is making those checks reliable by understanding the machine that executes them.

## What a Runner Is
<!-- section-summary: A runner is the worker process and machine that accepts one job and executes its steps in order. -->

A **runner** is both a machine and the runner application installed on that machine. GitHub's orchestration layer decides that a queued job should run on a matching runner. The runner application receives the job payload, executes each step, uploads logs, and returns success or failure.

In a simple job, the flow looks like this. GitHub handles the orchestration, while the runner handles the actual command execution.

![Runner job execution flow showing job queued, runner accepts, workspace prepared, checkout code, run commands, upload logs, and return result](/content-assets/articles/article-cicd-github-actions-runners-and-execution/runner-job-execution-flow.png)

*A runner turns a queued job into a prepared workspace, ordered command execution, uploaded logs, and a result that GitHub can show beside the commit.*

Each job gets its own runner assignment. If a workflow has two independent jobs, GitHub can place them on two different machines. This explains why files created in one job are unavailable in another job unless you pass them through artifacts, caches, packages, or another shared system.

Steps inside one job share the runner. If `actions/checkout` downloads the repository in step one, `npm test` in step two can read those files. If a setup step adds a tool to `PATH`, later steps in the same job can use it.

Now that the job needs a runner, the next choice is who manages that runner. That choice affects maintenance, network access, performance, and security.

## GitHub-Hosted Runners
<!-- section-summary: GitHub-hosted runners are managed machines that start with a prepared image and usually give each job a clean environment. -->

A **GitHub-hosted runner** is a runner machine GitHub provides for you. For standard Linux, Windows, and macOS jobs, GitHub prepares the machine image, installs common tools, applies maintenance, and gives your job a runner when capacity is available. For most projects, this is the best starting point.

The workflow asks for one with `runs-on`. This key is the job's request for a runner type or runner label.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm test
```

The label `ubuntu-latest` selects a GitHub-hosted Ubuntu runner image. The exact image changes over time because GitHub updates hosted runner images, so a serious workflow should install or pin important tools through setup actions instead of assuming the image already contains exactly the right version.

For `checkout-api`, GitHub-hosted runners are attractive because every pull request receives a clean place to run. One developer cannot accidentally leave a local file behind for the next developer's run. The team also avoids patching runner operating systems, rotating runner registration tokens, and monitoring runner disks.

The tradeoff is control. If the project needs a private network route to an internal database, a special hardware device, a proprietary compiler license, or a very large machine shape, a standard hosted runner may be the wrong fit. That is where self-hosted runners enter the picture.

## Self-Hosted Runners
<!-- section-summary: Self-hosted runners give an organization control over the machine, network, and installed tools, while also giving that organization responsibility for security and maintenance. -->

A **self-hosted runner** is a machine your organization deploys and manages. It can be a virtual machine in your cloud account, a server in a private data center, a Kubernetes-backed runner scale set, or a workstation-like machine with special tooling. The common idea is simple: you own the runner environment.

The big reason teams use self-hosted runners is access. A deployment job might need to reach a private Kubernetes API server, a staging database, or an internal package registry that GitHub-hosted runners cannot reach. A build job might need a licensed compiler, a custom base image, or a huge local cache that would be expensive to rebuild every run.

```yaml
jobs:
  integration-test:
    runs-on:
      - self-hosted
      - linux
      - private-network
    steps:
      - uses: actions/checkout@v6
      - run: npm run test:integration
```

That `runs-on` array targets a self-hosted runner with matching labels. The workflow is saying that this job needs Linux and private network access, not just any available machine.

Self-hosting changes the responsibility line. Your team now patches the operating system, controls who can use the runner, rotates secrets available on the machine, clears workspaces safely, monitors disk usage, and decides how jobs are isolated from each other. Those tasks are normal infrastructure work, so self-hosted runners should solve a real problem before they become the default.

![Hosted runner versus self-hosted runner comparison showing fresh managed machines for pull requests and private-network custom machines for controlled jobs](/content-assets/articles/article-cicd-github-actions-runners-and-execution/hosted-vs-self-hosted-runners.png)

*Hosted runners are usually the clean starting point for pull request checks, while self-hosted runners make sense when a job truly needs private network access, custom tools, or special capacity.*

Runner selection is controlled through labels, so we should slow down on that part. Labels are where a workflow turns a vague machine need into a concrete scheduling request.

## Runner Labels and Targeting
<!-- section-summary: Labels describe runner capabilities, and `runs-on` uses those labels to match a job to a suitable runner. -->

A **runner label** is a name attached to a runner. Labels describe the runner's operating system, architecture, location, network access, hardware, or purpose. `runs-on` uses labels to choose a runner that can satisfy the job.

GitHub-hosted runners use labels such as `ubuntu-latest`, `windows-latest`, and `macos-latest`. Self-hosted runners commonly include the `self-hosted` label plus custom labels such as `linux`, `arm64`, `gpu`, `private-network`, or `large-cache`.

```yaml
jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm test

  build-private:
    runs-on:
      - self-hosted
      - linux
      - private-network
    steps:
      - uses: actions/checkout@v6
      - run: npm run test:database
```

The first job can run on a managed Ubuntu runner. The second job needs a self-hosted runner that can reach private systems. Keeping those jobs separate makes the security boundary clearer because only the job that needs private network access receives it.

A common mistake is making labels too broad. A label called `prod` can mean many things: production network, production deploy permission, production-like CPU size, or production package registry access. Labels such as `private-network`, `deploy-prod`, and `x64-linux` explain the runner capability more directly.

After the job lands on a runner, it still needs files. That is where the workspace and checkout step matter.

## The Workspace and Checkout
<!-- section-summary: A job starts with a workspace, and the repository appears there only after a checkout step downloads it. -->

The **workspace** is the directory where a job usually works with repository files. The runner prepares a workspace path for the job, but the repository contents are available only after a checkout step fetches them. GitHub exposes the workspace path through the `GITHUB_WORKSPACE` environment variable.

This beginner bug shows up all the time. The workflow has a runner, but the runner has not downloaded the repository yet.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
```

The job starts, but `npm test` cannot find `package.json` because the repository was never checked out. The runner received the job instructions, not a magical copy of the repository.

The fixed workflow includes `actions/checkout` before commands that need files. After that step finishes, later steps in the same job can read the repository.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm test
```

On a GitHub-hosted runner, the workspace usually starts clean for each job. On a long-lived self-hosted runner, careful cleanup matters because the same machine can run many jobs over time. A stale file in a workspace can make a test pass or fail for the wrong reason.

With the repository available, the next failure often comes from a missing system package. That kind of failure usually means the workflow relied on something from a developer laptop instead of declaring it in CI.

## Installing System Dependencies
<!-- section-summary: CI jobs should install the operating system packages they rely on instead of assuming the runner image matches a developer laptop. -->

A **system dependency** is software installed at the operating system level, such as a compiler, a database client library, `jq`, `libpq-dev`, or a package manager. Application package managers often depend on these tools when they compile native modules or talk to external services.

Imagine `checkout-api` adds a Node.js dependency that builds a native PostgreSQL adapter. The developer's laptop works because PostgreSQL headers were installed months ago. The GitHub-hosted Ubuntu runner starts clean, runs `npm ci`, and fails during compilation because the needed Linux package is missing.

The workflow should make the dependency explicit. The runner should receive every operating system package the build needs before the application install starts.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Install PostgreSQL headers
        run: |
          sudo apt-get update
          sudo apt-get install -y libpq-dev
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
```

This is less glamorous than a clever pipeline trick, but it is what makes CI reliable. The workflow declares the machine state it needs. A future runner image update or a new team member's laptop state has less power to surprise the build.

For repeated setup across many repositories, a shared action can package the installation logic. For one repository, writing the steps directly is often the clearest starting point.

System packages prepare the operating system. Language setup actions prepare the runtime.

## Language Setup and Tool Caches
<!-- section-summary: Setup actions select language versions and add them to the runner path, which keeps builds consistent across runner image updates. -->

A **setup action** configures a tool or language runtime for a job. Examples include `actions/setup-node`, `actions/setup-python`, `actions/setup-go`, and `actions/setup-java`. These actions usually find a requested version from the runner tool cache or download it, then add it to `PATH` for the rest of the job.

For `checkout-api`, the team should choose the Node.js version in YAML. That keeps the runtime version visible in code review and repeatable across runners.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
```

The `node-version` input makes the runtime explicit. The `cache: npm` setting lets the setup action restore and save dependency cache entries for npm, which can reduce install time while keeping `npm ci` as the source of truth for dependency installation.

The important idea is that `ubuntu-latest` is an operating system image, not a promise that your preferred Node.js version will always be ready exactly as you expect. Setup actions turn "whatever happens to be on the image" into "this job asked for Node.js 22." That is the point of the setup step.

Runtime setup solves one kind of mismatch. Some jobs need an even stronger boundary around the execution environment, and containers can provide that shape.

## Containers and Services
<!-- section-summary: Job containers run steps inside a chosen container image, while service containers give the job nearby dependencies such as databases. -->

A **job container** runs the job's steps inside a container image instead of directly on the runner host. The runner still manages the job, but the shell commands execute inside the container. This is useful when the application expects a specific Linux userland or when the team wants the CI environment to resemble the production container.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:22-bookworm
    steps:
      - uses: actions/checkout@v6
      - run: npm ci
      - run: npm test
```

Here, the runner is Ubuntu, but the job commands run inside the `node:22-bookworm` container. This gives the project a predictable Node.js environment that comes from the container image.

A **service container** runs a supporting service beside the job, such as PostgreSQL or Redis. For integration tests, this can be cleaner than connecting to a shared staging database.

```yaml
jobs:
  integration-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: checkout_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run test:integration
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/checkout_test
```

Containers help make tests repeatable, but they do not erase runner security concerns. The runner still executes code from the workflow, and that code may come from a branch, a pull request, or a shared action.

## Security Boundaries for Runners
<!-- section-summary: Runner security depends on what code can run there, what network it can reach, and what secrets or credentials are available during the job. -->

A runner executes code. That simple fact drives the security model. If a workflow runs commands from a pull request, those commands can read files in the workspace, start processes, make network calls, and interact with any credentials exposed to that job.

GitHub-hosted runners are useful for untrusted pull request checks because the machine is temporary and managed by GitHub. The job still needs careful permissions and secrets handling, but the runner itself is not a long-lived server sitting inside your private network.

Self-hosted runners need stricter boundaries. GitHub recommends careful use of self-hosted runners with public repositories because pull requests can potentially run dangerous code on the runner machine. Even in private repositories, a self-hosted runner with broad network access can become a bridge into internal systems if the workflow executes unreviewed code.

For `checkout-api`, a practical split might look like this. The table separates ordinary validation from jobs that need stronger access.

| Workload | Runner choice | Reason |
|---|---|---|
| Pull request lint and unit tests | GitHub-hosted runner | Fresh machine and no private network access needed |
| Integration tests against an internal database | Self-hosted runner with `private-network` label | The job needs a private route, so access is tightly scoped |
| Production deployment | Dedicated runner group or hosted runner with OIDC | Deployment should have the narrowest possible credentials and approvals |

Runner security is also connected to workflow permissions. A job with no deployment responsibility should receive no deployment secrets. A job that only reads code should not receive broad repository write access. We will go deeper on secrets and identity in the security article.

For now, the main runner rule is practical: give a job the machine it needs, and keep private network access away from jobs that do not need it. That one habit prevents many runner security problems before they become incident response work.

## Putting It All Together
<!-- section-summary: A reliable runner setup declares the machine, checks out code, installs system dependencies, pins language runtime behavior, and separates private-network work from ordinary checks. -->

Here is a pull request workflow for `checkout-api` that shows the runner decisions in one place. Unit tests run on a GitHub-hosted runner. Integration tests run only when the team chooses the self-hosted label that has private database access.

```yaml
name: Runner-Aware Checks

on: pull_request

jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Install system packages
        run: |
          sudo apt-get update
          sudo apt-get install -y libpq-dev
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test

  integration-test:
    runs-on:
      - self-hosted
      - linux
      - private-network
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run test:integration
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
```

The workflow names the machine shape through `runs-on`. It checks out the repository before reading project files. It installs the system package needed for native builds. It uses a setup action to select Node.js. It keeps private network access inside the one job that needs it.

This is the execution layer behind the workflow structure from the first article. Events and YAML decide what should happen. Runners decide where it happens and what the job can reach while it runs.

![Reliable runner checklist showing labels, checkout workspace, installing tools, cache care, secret isolation, and artifact upload](/content-assets/articles/article-cicd-github-actions-runners-and-execution/reliable-runner-checklist.png)

*A reliable runner setup declares the machine, prepares the workspace, installs tools, handles caches carefully, isolates secrets, and preserves useful artifacts.*

## What's Next
<!-- section-summary: The next article turns repeated workflow steps into shared actions and reusable workflows so multiple repositories can use the same automation without copy-paste. -->

You now understand the machine side of GitHub Actions. That gives us the base for the next problem: repeated YAML.

The next article looks at **actions and reusability**. We will take common setup steps from `checkout-api`, package them into composite actions, compare them with reusable workflows, and decide when shared automation should be a step-level tool or a full job-level policy.

---

**References**

- [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) - Explains GitHub-hosted runner machines, images, preinstalled tools, and hosted runner behavior.
- [Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) - Defines self-hosted runners and the responsibility model for machines you manage.
- [Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) - Documents setup flow and security guidance for self-hosted runner registration.
- [Customizing GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/customize-runners) - Shows how to install additional software on hosted runner images.
- [Running jobs in a container](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container) - Documents job containers and container behavior in workflows.
- [Building and testing Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/building-and-testing-nodejs) - Explains `actions/setup-node`, tool cache behavior, and Node.js workflow examples.

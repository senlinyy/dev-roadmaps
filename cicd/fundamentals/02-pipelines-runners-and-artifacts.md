---
title: "Pipelines, Runners, and Artifacts"
description: "Understand how CI/CD pipelines turn a code change into jobs, how runners execute those jobs, and how artifacts and caches move files through the workflow."
overview: "A pipeline is the delivery path your code follows after someone pushes a change. This article follows one pull request through jobs, runners, workspaces, service containers, artifacts, and caches so the moving pieces feel connected instead of mysterious."
tags: ["pipelines", "runners", "artifacts", "caching", "ci-cd"]
order: 2
id: article-cicd-fundamentals-pipelines-runners-and-artifacts
aliases:
  - pipelines-and-runners
  - artifacts-and-caching
  - article-cicd-fundamentals-pipelines-and-runners
  - article-cicd-fundamentals-artifacts-and-caching
  - cicd/fundamentals/pipelines-and-runners.md
  - cicd/fundamentals/artifacts-and-caching.md
---

## Table of Contents

1. [The Delivery Path at a Glance](#the-delivery-path-at-a-glance)
2. [Pipelines, Jobs, Stages, and Steps](#pipelines-jobs-stages-and-steps)
3. [Runners and the Controller](#runners-and-the-controller)
4. [Hosted Runners and Self-Hosted Runners](#hosted-runners-and-self-hosted-runners)
5. [The Job Workspace](#the-job-workspace)
6. [Shell Jobs, Container Jobs, and Service Containers](#shell-jobs-container-jobs-and-service-containers)
7. [Artifacts](#artifacts)
8. [Caches](#caches)
9. [Passing Evidence Between Jobs](#passing-evidence-between-jobs)
10. [Common Failure Mode: Missing Files Between Jobs](#common-failure-mode-missing-files-between-jobs)
11. [Common Failure Mode: Dirty Self-Hosted Runners](#common-failure-mode-dirty-self-hosted-runners)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Delivery Path at a Glance
<!-- section-summary: A pipeline connects a code change to repeatable checks, package outputs, and later release decisions. -->

A small team is working on a service called `checkout-api`. Mira changes the code that calculates tax, opens a pull request, and waits for the green check before anyone reviews the change. Behind that little green check, the CI/CD system has to clone the repository, install packages, run tests, start a temporary database, build a deployable package, and keep enough evidence for the team to trust the result.

A **pipeline** is that automated path. It is the set of checks and packaging work that runs after a trigger, such as a push, pull request, tag, manual button click, or scheduled time. A pipeline gives the team the same answer every time: this exact version of the code passed these exact steps on a clean machine, or it failed with these logs.

This article connects the main pieces in the order they appear during a real run. First the controller reads the pipeline file and turns it into jobs. Then runners pick up those jobs and execute commands. Each job gets a workspace on disk, and some jobs run inside containers or start temporary service containers. After that, artifacts and caches decide which files survive after the runner disappears.

That `checkout-api` pull request will stay as the thread through the article. The team wants fast feedback on every change, but they also want a build package they can deploy later. Those two goals create the need for jobs, runners, artifacts, and caches.

## Pipelines, Jobs, Stages, and Steps
<!-- section-summary: A pipeline is made from jobs, jobs contain steps, and dependencies decide which jobs can run together. -->

A **job** is one unit of work in a pipeline. In GitHub Actions, a workflow contains one or more jobs. In GitLab CI/CD, jobs are the fundamental pieces of a pipeline. In Jenkins, a Pipeline often organizes work into stages and steps. The names move around a little by platform, but the idea stays the same: each unit has commands to run and a result to report.

A **step** is one action inside a job. A step might check out the repository, install Node.js packages, run `npm test`, upload a file, or print a diagnostic command. Steps inside one job usually run in order on the same runner workspace, so a file created by one step can be read by a later step in that same job.

A **stage** is a named group in many CI/CD tools. Teams use stages to make the pipeline readable: `validate`, `test`, `build`, `package`, and `deploy`. Some platforms treat stages as strict ordering rules, while others use explicit job dependencies like `needs`. Either way, the stage names should tell a human what kind of work is happening.

For `checkout-api`, a beginner-friendly pipeline might have three jobs. The `lint` job checks formatting and obvious code problems. The `test` job runs the unit and integration tests. The `package` job builds a Docker image tarball or a compiled archive only after the checks pass.

```yaml
name: checkout-api

on:
  pull_request:
    branches: ["main"]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm test

  package:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
```

The important line is `needs: [lint, test]`. This tells the controller that `package` should wait until both earlier jobs finish successfully. `lint` and `test` can run at the same time because neither one waits for the other. That parallel shape gives fast feedback without letting packaging happen after broken checks.

People sometimes call this dependency shape a **DAG**, which means directed acyclic graph. In plain English, it is a map of which jobs must happen before other jobs, with no circular waiting. `package` can wait for `test`, but `test` cannot also wait for `package`, because then both jobs would wait forever.

![Pipeline job graph showing a pull request fan out to lint and test jobs, then a package job waiting for both](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/pipeline-job-graph.png)

*A job graph lets independent checks run together while later jobs wait for the exact prerequisites they need.*

Now the controller knows the plan. The next question is where those commands actually run, because the web page showing the pipeline is usually not the machine running `npm test`.

## Runners and the Controller
<!-- section-summary: The controller plans and tracks the pipeline, while runners execute the commands on real compute. -->

The **controller** is the CI/CD service that receives the event, reads the pipeline file, schedules jobs, stores logs, and reports status back to the pull request. In GitHub Actions, GitHub provides that orchestration layer. In GitLab, the GitLab instance coordinates pipelines and sends jobs to runners. In Jenkins, the controller manages the build queue and the Pipeline state.

A **runner** is the machine or container environment that executes a job. The runner checks out code, runs shell commands, starts containers if the job needs them, streams logs back to the controller, and returns an exit code. A successful command usually exits with code `0`; a failed command returns a non-zero code, and the controller marks the job as failed.

This split matters because a pipeline can run untrusted or partly trusted code. A pull request can change build scripts, package scripts, and test commands. The CI/CD system reduces the blast radius by sending those commands to isolated runners instead of running them directly on the controller that stores repository metadata, secrets, users, billing, and pipeline history.

For `checkout-api`, the controller sees Mira's pull request and creates the `lint`, `test`, and `package` jobs. Two runners may pick up `lint` and `test` at the same time. Each runner gets a job payload, prepares a workspace, runs the steps, and sends logs back so Mira can see exactly where the pull request passed or failed.

The runner is also where many beginner surprises happen. If the runner lacks the right language version, the job fails. If the workspace has no repository files because checkout never happened, the job fails. If two jobs run on two different runners, files created in one job do not magically appear in the other one. Those surprises all connect to the first runner design choice: the runner can be hosted by the CI/CD provider, or it can run on infrastructure your team owns.

## Hosted Runners and Self-Hosted Runners
<!-- section-summary: Hosted runners reduce maintenance, while self-hosted runners give control over hardware, network access, and installed tools. -->

A **hosted runner** is compute provided and maintained by the CI/CD platform. GitHub-hosted runners, for example, are machines GitHub provides to execute jobs. The provider maintains the base images, preinstalled tools, runner software, and cleanup process. For many teams, hosted runners are the easiest way to start because the team writes YAML instead of operating build machines.

Hosted runners fit the early `checkout-api` team well. Their Node.js service needs ordinary Linux tools, public npm packages, and a temporary PostgreSQL container for tests. The team can ask for `ubuntu-latest`, set up Node.js in the job, run the tests, and let the provider throw away the runner after the job finishes.

A **self-hosted runner** is compute your team deploys and connects to the CI/CD platform. It might be an EC2 instance, a virtual machine in a private data center, a Kubernetes pod, or a powerful workstation with specialized hardware. The runner application connects to the controller, receives jobs, executes them, and reports the result.

Self-hosted runners become useful when the pipeline needs something hosted runners cannot provide. A mobile app team might need macOS machines with a specific Xcode setup. A data platform team might need private network access to an internal package mirror. A machine learning team might need GPUs. A monorepo team might want large runners with more CPU, memory, or disk than the default hosted machines.

The tradeoff is operational responsibility. The team now owns patching, disk cleanup, runner registration, network rules, tool versions, and isolation between jobs. GitHub warns teams to be careful with self-hosted runners and public repositories because pull requests from forks can run dangerous code on the runner machine. That warning is a good practical rule for every platform: self-hosted runners are powerful, so they need tighter trust boundaries.

For `checkout-api`, the team can start on hosted runners and move only specific jobs to self-hosted runners later. For example, normal pull request checks can stay hosted, while a nightly performance test can run on a self-hosted runner inside the company's private network. The pipeline can use labels or tags to route each job to the right kind of runner.

Now that a job has landed on a runner, the next thing to understand is the job workspace. Most "my file is missing" pipeline bugs come from misunderstanding that workspace.

## The Job Workspace
<!-- section-summary: A job workspace is the temporary directory where the runner checks out code and runs the job steps. -->

A **workspace** is the directory on the runner where the job works with files. The runner starts with a clean place to run commands, then a checkout step downloads the repository at the exact commit that triggered the pipeline. After checkout, the job steps run from that directory unless the pipeline config chooses another working directory.

The checkout step matters because a runner does not automatically know your source code. In GitHub Actions, teams usually use `actions/checkout`. In GitLab, the runner normally fetches the repository as part of the job setup unless configuration changes that behavior. In Jenkins, a Pipeline often uses `checkout scm` or another source checkout step.

For `checkout-api`, the workspace is where `package.json`, `package-lock.json`, `src/`, and `tests/` appear. When `npm ci` runs, the dependency manager reads the lockfile from the workspace and creates files like `node_modules/`. When `npm test` runs, the test framework reads application code and test files from that same workspace.

Many teams add a small diagnostic step while learning a pipeline. The output shows what the runner can see before the real build commands run.

```yaml
- name: Show workspace
  run: |
    pwd
    ls -la
    node --version
    npm --version
```

This step prints the current directory, the files in it, and the installed runtime versions. It gives beginners a concrete view of the runner instead of guessing. If `ls -la` does not show the repository files, the checkout step is missing or the job is running in a different directory.

The workspace belongs to one job. Another job gets another workspace, often on another runner. If `test` creates `coverage/coverage.xml`, the `package` job cannot read it unless the pipeline uploads it somewhere after `test` and downloads it again in `package`. That is why artifacts exist, and we will get there soon.

Before files leave the workspace, the team has one more execution choice. Commands can run directly on the runner's shell, or they can run inside a container with a pinned toolchain.

## Shell Jobs, Container Jobs, and Service Containers
<!-- section-summary: Shell jobs use the runner host directly, container jobs pin the job environment, and service containers provide temporary dependencies. -->

A **shell job** runs commands directly on the runner host. On Linux, that usually means Bash or another shell. On Windows, it may mean PowerShell. Shell jobs are simple and fast, but they depend on what the runner image has installed or what the job installs before running the application commands.

For `checkout-api`, a shell job works fine if the pipeline sets up Node.js first. The runner might start as a generic Ubuntu machine, then `actions/setup-node` installs the requested Node.js version. After that, `npm ci`, `npm test`, and `npm run build` use the version the job configured.

A **container job** runs the job steps inside a Docker container. The runner host still exists, but the commands execute inside an image such as `node:20-bookworm` or `python:3.12-slim`. This helps when the team wants the CI environment to match a known image instead of depending on the hosted runner's preinstalled tools.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container: node:20-bookworm
    steps:
      - uses: actions/checkout@v4
      - run: node --version
      - run: npm ci
      - run: npm test
```

This job still uses an Ubuntu runner, but the Node.js commands run inside the `node:20-bookworm` container. The repository workspace is mounted into the container, so the commands can read the checked-out files. The team gets a repeatable Node.js environment without manually installing Node.js in every run.

A **service container** is a helper container that runs beside the job for the duration of the job. Databases, queues, caches, and fake external services often run this way. The service exists only for the job, which keeps test data isolated between pull requests.

The `checkout-api` service needs PostgreSQL for integration tests. Connecting every pull request to one shared staging database would create random failures because two test runs could modify the same rows at the same time. A service container gives each job its own clean database.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: checkout_test
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/checkout_test
```

The test job now has a private PostgreSQL instance listening on `localhost:5432`. The health check gives the database time to become ready before tests try to connect. When the job finishes, the runner cleanup removes the service container and the test data disappears with it.

![Runner execution boundary showing workspace, host shell, container job, service container, and cleanup](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/runner-execution-boundary.png)

*A job can run directly on the host shell, inside a pinned container image, or beside a temporary service container while sharing one job workspace.*

At this point, the job can run real checks. The next problem is what to do with files produced by those checks, because the runner will not keep them forever.

## Artifacts
<!-- section-summary: Artifacts preserve files produced by a specific pipeline run so later jobs and humans can use them. -->

An **artifact** is an output file saved from a job. Build archives, compiled binaries, coverage reports, screenshots, test logs, packaged Terraform plans, and Docker image tarballs can all be artifacts. The key idea is that artifacts belong to a specific pipeline run and explain what that run produced.

For `checkout-api`, the `test` job can upload a coverage report when tests finish. A reviewer can download that report from the pipeline page, or another job can download it to publish a combined coverage summary. The file started inside one runner workspace, then the artifact system moved it into CI/CD storage.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: checkout-coverage
          path: coverage/
          retention-days: 14
```

This artifact has a name, a path, and a retention period. The name tells humans and later jobs what to request. The path tells the upload step which files to preserve. The retention period says how long the platform should keep the files before automatic cleanup.

Artifacts also help separate **validation** from **promotion**. A build job can create one package and upload it as an artifact. Later jobs can deploy that exact package to development, staging, and production. This avoids rebuilding three slightly different packages and pretending they are the same release.

There is a simple rule here: artifacts are evidence and outputs. They answer questions like "What did this run build?", "What logs did this failed test produce?", and "Which package should the next job deploy?" They should be named clearly because humans often inspect them during an incident or release review.

The team also wants fast pipelines. Downloading every package from the internet on every run wastes time, and that problem needs a different storage tool.

## Caches
<!-- section-summary: Caches preserve reusable inputs such as dependency downloads so later jobs can run faster. -->

A **cache** is reusable storage for files that speed up future jobs. Dependency downloads are the classic example: npm packages, Gradle modules, Maven files, pip wheels, Rust crates, Go module downloads, and package manager indexes. A cache usually works across runs, while an artifact explains one specific run.

GitLab's documentation makes this distinction very directly: caches are for dependencies, while artifacts pass build results between stages. That distinction is useful even outside GitLab. If the file came from the internet and can be recreated, it probably belongs in a cache. If the file was produced by this run and proves what happened, it probably belongs in an artifact.

For `checkout-api`, caching the npm download folder can save time. The job still runs `npm ci`, which creates a clean `node_modules/` from the lockfile. The cache speeds up the package downloads that `npm ci` needs.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: actions/cache@v4
        with:
          path: ~/.npm
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            npm-${{ runner.os }}-
      - run: npm ci
      - run: npm test
```

The cache key includes the operating system and a hash of `package-lock.json`. A **hash** is a fingerprint of a file's contents. When the lockfile changes, the hash changes, and the pipeline naturally creates a new cache instead of reusing packages for an old dependency tree.

The `restore-keys` line gives the cache action a fallback prefix. If the exact key does not exist, the action can look for a nearby cache, such as the most recent npm cache for the same operating system. That fallback can help a first run on a new branch, but it also means the job should still run the package manager command afterward so the workspace matches the lockfile.

Caches are helpful, but they should never become the only source of truth. A correct pipeline can survive a cache miss because it can download dependencies again. If deleting the cache breaks the build permanently, the pipeline is relying on hidden state, and the dependency setup needs to be fixed.

Now we can connect artifacts and caches to job boundaries. The most practical pipeline design skill is knowing which files need to move forward and which files can be recreated.

## Passing Evidence Between Jobs
<!-- section-summary: Jobs do not share workspaces, so teams pass run outputs forward with artifacts and recreate inputs with caches. -->

The `checkout-api` pipeline now needs a more realistic release path. The `test` job produces coverage and test logs. The `build` job produces a compiled package. The `deploy-preview` job should deploy the exact package from `build`, not rebuild from scratch with a slightly different environment.

That means the package should be an artifact. The package came from this exact pipeline run, and later jobs need that exact output. The npm download folder should stay a cache because it only speeds up installation and can be recreated from the lockfile.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run build
      - run: tar -czf checkout-api.tar.gz dist package.json package-lock.json
      - uses: actions/upload-artifact@v4
        with:
          name: checkout-api-package
          path: checkout-api.tar.gz

  deploy-preview:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: checkout-api-package
      - run: ls -la
      - run: ./scripts/deploy-preview.sh checkout-api.tar.gz
```

The `deploy-preview` job does not depend on the build workspace. It downloads the artifact by name and deploys that downloaded file. This is the basic pattern behind reliable promotion: one job builds a thing, later jobs move that same thing through environments.

The same idea applies to test evidence. If Playwright creates screenshots for failed browser tests, the job can upload those screenshots as artifacts even when the test step fails. If a security scanner creates a SARIF or JSON report, the job can upload it for later review. If a Terraform plan job creates a plan summary for reviewers, the job can upload that plan as an artifact before any apply step happens.

Artifacts should be scoped and intentional. Uploading the whole repository, the whole home directory, or every dependency folder creates storage cost and makes downloads slow. A good artifact has a clear name, a clear path, and a reason a person or later job will need it.

This is where many first pipeline bugs happen. A file exists in one job, then the next job cannot find it. The file did exist, but it lived in the previous runner workspace.

## Common Failure Mode: Missing Files Between Jobs
<!-- section-summary: Files created inside one job disappear unless the pipeline uploads them as artifacts or recreates them later. -->

Mira's team sees a failure in `deploy-preview`. The log points at the package file the job expected to deploy.

```console
./scripts/deploy-preview.sh: line 12: checkout-api.tar.gz: No such file or directory
Error: Process completed with exit code 1.
```

The build logs show that `checkout-api.tar.gz` was created successfully in the `build` job. The deploy logs show a different runner, a fresh workspace, and no package file. Both logs are true because each job has its own workspace.

The fix is to decide what kind of file `checkout-api.tar.gz` is. It is a run output, so it should be uploaded as an artifact by `build` and downloaded by `deploy-preview`. Adding `needs: [build]` controls job order, but it does not move files. The artifact upload and download steps move the file.

The same bug appears with coverage reports, generated OpenAPI files, packaged Helm charts, and built frontend assets. A later job can only read files that it checks out, downloads as artifacts, creates again, or receives from another explicit storage system. Job dependencies control timing; artifacts control file transfer.

A practical debugging pattern is to print the working directory and list files at the start of the failing job. If the file is missing, the next question is simple: should this job recreate the file, or should an earlier job upload it as an artifact? That question usually points straight to the fix. Once file movement makes sense, the other common pain comes from self-hosted runners that keep too much state between jobs.

## Common Failure Mode: Dirty Self-Hosted Runners
<!-- section-summary: Persistent runners need cleanup because old files, containers, processes, and credentials can affect later jobs. -->

A **dirty runner** is a runner whose old state leaks into a new job. This mostly affects self-hosted runners because they are often long-lived machines. Hosted runners usually give each job a fresh virtual machine or container environment, so old Docker layers, background processes, and temporary files vanish more predictably.

The first dirty-runner problem is disk space. A Docker build can leave layers behind. A test job can create large screenshots, coverage folders, or database dumps. A monorepo can create gigabytes of dependencies and build output. After enough jobs, a later pipeline fails with `no space left on device` even though the code change has nothing to do with disk usage.

```console
failed to copy files: write /var/lib/docker/overlay2/temp/file: no space left on device
Error: Process completed with exit code 1.
```

The fix is operational rather than YAML-only. Self-hosted runner owners usually add cleanup between jobs, scheduled pruning for Docker resources, disk monitoring, and alerts before the disk reaches a dangerous level. Some teams run each job in a disposable virtual machine or Kubernetes pod so cleanup comes from destroying the environment instead of trusting every job script.

The second dirty-runner problem is leftover processes. A test script might start a local server with `npm run start &`, run browser tests, and then fail before stopping the server. On a persistent runner, that server can keep running and hold port `3000`. The next job tries to start its own server on the same port and fails with an address-in-use error.

The safer pattern is to make cleanup part of the script lifecycle. In Bash, teams often use `trap` so the cleanup command runs when the script exits, including failure exits. The exact script depends on the stack, but the idea is consistent: start the background process, remember its process id, and stop it before the job ends.

```bash
npm run start &
APP_PID=$!

cleanup() {
  kill "$APP_PID"
}

trap cleanup EXIT
npm run test:e2e
```

Dirty runners can also leak credentials and network access. A self-hosted runner inside a private subnet may reach internal databases, deployment targets, package registries, and cloud metadata endpoints. That power is useful for trusted deployment jobs, but it is risky for untrusted pull request code. Runner groups, labels, protected branches, environment gates, and separate runner pools help keep high-trust jobs away from low-trust code.

This is why hosted runners are a good default for ordinary pull request validation. Self-hosted runners are valuable, but they behave like production infrastructure. They need ownership, monitoring, patching, cleanup, and a clear answer to which repositories and branches may run on them.

## Putting It All Together
<!-- section-summary: A reliable pipeline plans jobs clearly, runs them on suitable runners, and treats artifacts and caches as different kinds of storage. -->

The full `checkout-api` pull request now has a clear path from commit to package. Mira opens a pull request, and the controller reads the pipeline file. It sees `lint`, `test`, and `build` jobs. The dependency rules allow `lint` and `test` to run together, while `build` waits for both.

The controller sends the jobs to runners. Hosted runners are enough for the pull request checks, so the team avoids maintaining machines for everyday validation. Each runner prepares a workspace, checks out the exact commit, installs Node.js, restores dependency caches where possible, and runs the declared steps.

The `test` job starts a PostgreSQL service container so integration tests get a clean database. It uploads coverage and failed-test evidence as artifacts. The `build` job creates `checkout-api.tar.gz` and uploads that package as an artifact so later jobs can deploy the same output.

The cache and artifact choices are now clear. The npm cache speeds up future installs and can be recreated after a miss. The package artifact belongs to this pipeline run and moves forward into preview or release jobs. One storage system improves speed; the other preserves evidence and outputs.

The runner choice is also clear. Hosted runners fit public pull request checks and low-maintenance validation. Self-hosted runners fit trusted jobs that need private network access, special hardware, or custom environments. The more powerful the runner, the more carefully the team controls who can send work to it.

![Pipeline storage summary comparing artifacts as run outputs with caches as reusable inputs across separate job workspaces](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/pipeline-storage-summary.png)

*Artifacts move evidence and packages from one job to another, while caches speed up repeated inputs that the pipeline can recreate.*

That is the practical foundation for CI/CD pipeline mechanics. The pieces form a small distributed workflow: the controller plans, runners execute, workspaces hold temporary files, containers shape the runtime, artifacts preserve outputs, and caches make repeatable work faster.

## What's Next

Pipelines, runners, artifacts, and caches explain how automated work runs. The next article moves from validation to delivery and deployment, where those pipeline outputs become releases moving through development, staging, and production.

---

**References**

- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Defines workflows as automated processes made of jobs and documents job dependencies, containers, services, and steps.
- [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) - Explains hosted runner machines, runner images, operating systems, and maintenance responsibilities.
- [Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) - Documents self-hosted runner setup and warns about dangerous code from forked public pull requests.
- [Running jobs in a container](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) - Shows how GitHub Actions jobs can run inside a Docker container with the workspace mounted into the container.
- [Communicating with Docker service containers](https://docs.github.com/en/actions/tutorials/communicating-with-docker-service-containers) - Describes service containers for databases, caches, and other helper services in workflows.
- [Store and share data with workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) - Documents artifact upload, download, retention, and passing data between workflow jobs.
- [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) - Explains cache keys, restore keys, cache hits, cache misses, and cache matching behavior.
- [GitLab Runner](https://docs.gitlab.com/runner/) - Defines GitLab Runner as the application that executes CI/CD jobs and reports results back to GitLab.
- [Caching in GitLab CI/CD](https://docs.gitlab.com/ci/caching/) - Distinguishes caches from artifacts and documents cache key strategies and artifact behavior.
- [Recording tests and artifacts in Jenkins](https://www.jenkins.io/doc/pipeline/tour/tests-and-artifacts/) - Shows how Jenkins records test results and archives build artifacts from a Pipeline.

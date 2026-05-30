---
title: "Pipelines, Runners, and Artifacts"
description: "Master the mechanics of pipeline orchestrations, split-brain executions, container contexts, ephemeral database services, and dependency caches."
overview: "CI/CD pipelines operate as distributed computing systems. This article details Directed Acyclic Graph dependencies, split-brain runner fleets, Docker service containers, and cryptographic cache configurations."
tags: ["runners", "artifacts", "caching", "docker", "dags"]
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

1. [Pipelines as Distributed Computing Systems](#pipelines-as-distributed-computing-systems)
2. [The Split-Brain Architecture: Controller vs. Runner](#the-split-brain-architecture-controller-vs-runner)
3. [Hosted Cloud Runners vs. Self-Hosted Fleets](#hosted-cloud-runners-vs-self-hosted-fleets)
4. [Anatomy of the Runner Job Workspace](#anatomy-of-the-runner-job-workspace)
5. [Execution Contexts: Shell vs. Container](#execution-contexts-shell-vs-container)
6. [Managing State: The Ephemeral Database Pattern](#managing-state-the-ephemeral-database-pattern)
7. [The Persistence Split: Caching vs. Artifacts](#the-persistence-split-caching-vs-artifacts)
8. [Cache Invalidation: Cryptographic Hashing and Keys](#cache-invalidation-cryptographic-hashing-and-keys)
9. [Common Failure Mode 1: Disk Space Exhaustion](#common-failure-mode-1-disk-space-exhaustion)
10. [Common Failure Mode 2: Zombie Background Processes](#common-failure-mode-2-zombie-background-processes)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## Pipelines as Distributed Computing Systems

When developers say "the pipeline failed," they are describing the execution of an automated sequence. Technically and structurally, a pipeline is a Directed Acyclic Graph (DAG). 

A DAG is a mathematical model representing a collection of vertices (jobs) connected by directional edges (dependencies) with no loops. This graph-based structure allows modern CI/CD engines to build parallel paths, fan out workloads, and fan them back in, guaranteeing that a job never depends on itself or creates an infinite loop.

Consider a pipeline consisting of four jobs:

First, `Lint`.

Second, `Unit Tests`.

Third, `Integration Tests` (depends on `Lint` and `Unit Tests`).

Fourth, `Build Docker Image` (depends on `Integration Tests`).

```mermaid
flowchart TD
    Lint["1. Lint<br/>(Parallel Node)"] --> Integration["3. Integration Tests<br/>(Dependency Gate)"]
    Unit["2. Unit Tests<br/>(Parallel Node)"] --> Integration
    Integration --> Build["4. Build Image<br/>(Artifact Target)"]
```

When a commit triggers the pipeline, the controller parses this DAG. It identifies that `Lint` and `Unit Tests` have no prerequisite dependencies and immediately dispatches them to run in parallel on separate runners. 

Once both finish successfully, the controller schedules `Integration Tests`. If `Unit Tests` fails, the execution tree halts. The controller cancels `Integration Tests` and `Build Docker Image`, marking them as skipped. 

Understanding pipelines as a DAG is the key to pipeline optimization. By separating monolithic test sequences into independent, parallel jobs, you reduce the total build duration.

## The Split-Brain Architecture: Controller vs. Runner

A common misconception is that the server displaying the pipeline dashboard is the same machine executing the terminal build commands. Modern CI/CD platforms separate execution into a split-brain architecture: the **Controller** and the **Runner**.

The **Controller** (also known as the Control Plane, Coordinator, or Server) represents the brain of the platform. It is responsible for:
* Receiving Git webhooks notifying it of new commits.
* Parsing YAML files to build the job dependency DAG.
* Validating billing limits, repository permissions, and developer roles.
* Dispatching jobs to waiting executors in the runner fleet.
* Rendering the live logs and progress graphs in the web dashboard.

The **Runner** (also known as the Agent, Worker, or Executor) represents the muscle. It is a sterile system that runs in isolation. Its only responsibility is to poll the controller for work, receive a list of shell commands, execute them, stream the text outputs back to the controller, and return the final exit code.

This separation is a critical security requirement. If the controller executed the user's shell scripts directly, a developer could push a malicious pipeline that accesses the shared cluster database, steals neighbor secrets, or compromises the control plane. Pushing execution to isolated, short-lived runners isolates the controller.

## Hosted Cloud Runners vs. Self-Hosted Fleets

When a job is scheduled, the runner must execute on physical or virtual hardware. You have two choices:

**Hosted Runners** are provisioned and maintained by the CI provider. When a job starts, the provider requests a fresh virtual machine from its cloud pool, executes your steps, streams the logs, and destroys the VM. 
* *Advantages*: Zero system maintenance. No disk cleanups or operating system patching. pristine isolation guarantees no state leaks between builds.
* *Disadvantages*: Cost is billed by the minute. CPU and memory specs are low (typically 2 vCPUs and 7GB of RAM). The virtual machines reside in the provider's cloud, meaning they cannot query databases located inside your private network.

**Self-Hosted Runners** are systems that you provision, host, and maintain. You install a small agent daemon on an virtual machine (such as an AWS EC2 instance), a local server, or a Kubernetes cluster, and register it with the controller.
* *Advantages*: Cost-effective for organizations running thousands of daily builds. You can provision high-performance hardware (such as 64-core compute-optimized systems) to speed up heavy compilations. The systems reside inside your private network, allowing integration tests to connect directly to internal databases or private APIs.
* *Disadvantages*: Operational overhead. If a build downloads massive assets and fails to clean them up, the next build will crash due to disk exhaustion. If a malicious script escapes the runner container, it gains access to your private subnet.

Self-hosted runners communicate with the controller via **Long Polling**. The runner opens an outbound HTTPS connection to the controller and holds it open, repeatedly asking if a job is ready. 

Because the runner initiates the connection, the platform team does not have to open any inbound ports on the company's firewall. The controller remains unable to connect directly to the runner; it simply drops job payloads onto the open outbound polling requests.

## Anatomy of the Runner Job Workspace

When a runner accepts a job, it constructs a temporary workspace. Understanding the state of the local disk during the first few seconds of a job is critical for debugging.

The execution sequence follows these steps:

First, **Initialization**. The runner software creates a fresh working directory on the host disk (such as `/home/runner/work/orders-api`).

Second, **Environment Injection**. The runner receives encrypted secrets and environment variables from the controller and injects them into the local process memory.

Third, **Checkout**. The runner executes `git clone` or `git fetch` to download the specific commit hash that triggered the DAG into the working directory.

Fourth, **Execution**. The runner walks through your YAML-declared steps sequentially inside the working directory.

If a pipeline crashes during the first step with a "file not found" error, it is almost always because the checkout step was omitted. The runner boots as an empty workspace; it only downloads your repository files when you explicitly declare the checkout action.

## Execution Contexts: Shell vs. Container

When a pipeline executes a `run` step, it requires an execution context.

The default context is the **Shell Context**. The runner executes the commands directly on the host machine's shell (such as `bash` on Linux or `PowerShell` on Windows). This leaves the build at the mercy of the software pre-installed on the runner's operating system. If your application requires Node.js 20 but the host machine only has Node.js 16 installed, the build fails.

To solve this dependency drift, modern pipelines support **Container Contexts**. Instead of executing commands on the host runner OS, the runner boots a specific Docker container image, mounts the temporary workspace directory into it, and executes all pipeline steps inside the container.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container: node:20-alpine
    steps:
      - uses: actions/checkout@v4
      - run: node --version
```

Even though the host runner is running a standard Ubuntu OS, the checkout and node version commands execute inside a lightweight Alpine Linux container with Node.js 20 guaranteed to be present. This isolates your pipeline dependencies from the host machine's configuration.

## Managing State: The Ephemeral Database Pattern

A common challenge in integration testing is database state management. If your backend application needs to run tests against a PostgreSQL database, how do you provide that database?

A common mistake is pointing the CI pipeline to a persistent "staging" database shared by the entire team. If two developers open pull requests at the same time, the controller launches two pipelines in parallel. Both connect to the same staging database, insert conflicting test records, and cause both test suites to fail randomly.

```mermaid
flowchart TD
    PR1["PR 1 Test Run"] --> DB1["Postgres Container 1<br/>(ephemeral DB)"]
    PR2["PR 2 Test Run"] --> DB2["Postgres Container 2<br/>(ephemeral DB)"]
    DB1 --> Safe1["Isolated Test Queries"]
    DB2 --> Safe2["Isolated Test Queries"]
```

We solve this using the **Ephemeral Database Pattern**. Because the runner is a sterile environment, we can instruct it to boot a clean database inside a background container solely for the duration of the test.

In GitHub Actions, we achieve this using a `services` declaration:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:testpassword@localhost:5432/testdb
```

When this pipeline boots, the runner starts a PostgreSQL Docker container in the background, maps port 5432, and then executes the steps. The application connects to `localhost:5432`, runs its migrations and integration tests against a clean, isolated database, and exits. 

Once the job completes, the runner destroys the entire VM, terminating the PostgreSQL container. No test data is preserved, and no parallel runs collide.

## The Persistence Split: Caching vs. Artifacts

Because the runner environment is destroyed after every job, we must persist files when we need to reuse inputs or deliver outputs. CI/CD systems provide two distinct persistence systems: **Caching** and **Artifacts**.

We separate their purposes based on the direction of the files:
* **Caching**:
  * Direct Purpose: Persists *inputs* (dependencies, intermediate libraries) from previous builds to speed up the current build.
  * Lifetime: Short-term; managed by invalidation keys.
  * Run Binding: Bound globally across the repository; reused by any pipeline branch.
* **Artifacts**:
  * Direct Purpose: Persists the *outputs* (compiled binaries, minified packages, test logs) produced by this specific run.
  * Lifetime: Permanent until the retention threshold (typically 90 days) is reached.
  * Run Binding: Bound strictly to the specific pipeline run ID that compiled them.

If your job compiles a Go binary, you upload the binary as an **Artifact** so that developers can download it for debugging, or so a subsequent deployment job can promote it. 

If your job downloads 1,500 packages from npm, you save the node modules directory to the **Cache** so that the next run does not waste time downloading the exact same files from the internet.

## Cache Invalidation: Cryptographic Hashing and Keys

A cache is a key-value store where the value is a compressed archive of your files and the key is a string you define. If you use a static key like `node-dependencies`, the runner will restore the exact same dependencies on every run.

However, application dependencies change. When a developer adds a new package to `package.json`, a static key will restore the old cache, and the build will fail because the new package is missing. We solve this using **Cache Invalidation** driven by cryptographic hashing.

```yaml
      - name: Cache Node Dependencies
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

This configuration generates a dynamic key (such as `Linux-node-7a9f26e4`). The runner executes a cryptographic SHA-256 hash of the `package-lock.json` file. 
* **Cache Hit**: If the lockfile has not changed, the generated hash matches an existing key in the cache store. The runner downloads the compressed archive, restores it to `~/.npm`, and `npm ci` completes in seconds using local files.
* **Cache Miss**: If a developer adds a dependency, the lockfile changes, generating a new hash (such as `Linux-node-31b7c0a9`). The runner finds no matching key in the cache store, downloads the dependencies from the internet, and saves the new archive under the new key at the end of the job.

If a cache is incorrectly configured and restores stale files that interfere with the build, it is called a **Poisoned Cache**. The diagnostic fix is to change the namespace prefix of the key (such as `node-v2`) in the YAML config, which forces a clean cache miss and rebuilds the dependency chain from scratch.

## Common Failure Mode 1: Disk Space Exhaustion

A common failure mode that affects self-hosted runners and large monorepo builds is disk space exhaustion.

During a complex build, a step crashes with a filesystem write failure:

```text
> docker build -t orders-api-stage .

Step 1/12 : FROM node:20-alpine
 ---> 8b212f451000
Step 2/12 : WORKDIR /app
 ---> Running in a2c83ff5a6b0
Step 3/12 : COPY . .
failed to copy files: failed to copy directory: write /var/lib/docker/overlay2/temp/file: no space left on device
Error: Process completed with exit code 1.
```

The error is `no space left on device`. CI/CD workloads generate massive amounts of temporary data: cloned Git repositories, dependency folders, intermediate binaries, and Docker layers.

On **Hosted Runners**, the cloud provider wipes the disk clean after every job. However, standard hosted runners often have limited local storage (such as 14GB). If a job compiles a massive application and pulls multiple base images, it can fill the disk mid-build. The fix is to selectively delete pre-installed developer tools at the start of the steps to free up space.

On **Self-Hosted Runners**, the disk is persistent and shared across successive jobs. Every container build leaves behind unused layers and volumes. Without an automated cleanup script (such as a cron job executing `docker system prune -af --volumes` nightly), the disk will slowly fill up over weeks until a random job crashes.

## Common Failure Mode 2: Zombie Background Processes

The second major failure mode on persistent self-hosted runners involves the leakage of background processes.

Consider a pipeline step that starts an application server in the background to execute integration tests:

```yaml
      - name: Start Application Server
        run: npm run start &
      - name: Execute Integration Tests
        run: npm run test-integration
```

If a developer manually cancels the pipeline while the tests are running, the controller sends a `SIGTERM` signal to the runner process. The runner terminates the active step execution. 

However, because the application server was launched in the background, it does not receive the termination signal. It becomes a **Zombie Process**, running silently on the host machine.

When the runner accepts the next job and attempts to execute the startup command, the build crashes:

```text
> orders-api@1.18.0 start
> node server.js

Error: listen EADDRINUSE: address already in use :::8080
    at Server.setupEstablishedConnection (node:net:1897:16)
    at Server.listen (node:net:1985:10)
    at Object.<anonymous> (src/server.js:42:8)

Error: Process completed with exit code 1.
```

The EADDRINUSE error occurs because the zombie process from the previous run is still listening on port 8080. 

This illustrates the risk of persistent self-hosted environments. Unlike sterile VMs, background services, mutated host networks, and temp files persist across jobs. The platform team must configure post-job cleanup scripts that forcefully terminate leaked process groups.

## Putting It All Together

Pipeline platforms operate as distributed computing networks. By mapping jobs to Directed Acyclic Graphs (DAGs), enforcing strict runner isolation, configuring container contexts, provisioning ephemeral service databases, and securing cache keys, platform engineers design high-speed, reliable, and secure delivery systems.

When configuring and auditing your runner fleets and pipelines, ensure you enforce these five core practices:

First, optimize the pipeline DAG. Design jobs to run in parallel, avoiding long sequential chains unless a strict dependency gate is required.

Second, protect the controller boundary. Treat runners as disposable executors of untrusted code, never granting them direct access to the control plane.

Third, isolate your execution contexts. Prefer container execution over host shell contexts to prevent pre-installed system configurations from drifting.

Fourth, manage database state dynamically. Avoid shared staging databases; implement the ephemeral database pattern using Docker service containers.

Fifth, enforce clean cache invalidation. Pair cache keys with cryptographic lockfile hashes to guarantee dependencies remain synchronized without state corruption.

## What's Next

Securing pipeline orchestrations and runners ensures that our packages are built inside safe boundaries. But once these artifacts are compiled, we must deploy them to our servers without manual mistakes. In the next chapter, **Continuous Delivery**, we will explore the golden rule of building once and deploying everywhere, manage stateless configurations, isolate environments, and design automated rollbacks.

![Pipeline runtime summary showing scheduler, runner, workspace, services, cache, and artifacts](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/pipeline-runtime-summary.png)

*Use this as the pipeline-runtime checklist: know who schedules work, where it runs, what the workspace contains, when services are temporary, and what persists as cache or artifact.*

---

**References**

- [GitHub Actions Cache Action](https://github.com/actions/cache) - Technical guide on configuring cache paths, keys, and restore-key fallbacks.
- [Kubernetes Device Plugins for GPU and Hardware Allocations](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/) - Explains the underlying system mechanics of provisioning hardware pools in container clusters.
- [NVIDIA DCGM-Exporter for Accelerator Telemetry](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html) - Telemetry systems for monitoring runner resources.
- [POSIX Signal Specifications](https://man7.org/linux/man-pages/man7/signal.7.html) - Linux standards governing signal delivery, process groups, and background daemon lifecycles.

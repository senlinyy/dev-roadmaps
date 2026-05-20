---
title: "Securing CI/CD Runners"
description: "Separate untrusted and trusted workflow work so the machine running CI cannot become a path to publishing or production."
overview: "A CI/CD runner executes the commands in a workflow. This article explains runner trust, job permissions, caches, third-party actions, and the TanStack npm compromise as a real example of runner boundaries failing."
tags: ["runners", "isolation", "ci", "github-actions"]
order: 1
id: article-devsecops-pipeline-security-securing-cicd-runners
---

## Table of Contents

1. [What Is a Runner?](#what-is-a-runner)
2. [Trusted and Untrusted Jobs](#trusted-and-untrusted-jobs)
3. [Runner State](#runner-state)
4. [Job Permissions](#job-permissions)
5. [Third-Party Actions](#third-party-actions)
6. [Case Study: TanStack](#case-study-tanstack)
7. [Runner Evidence](#runner-evidence)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Is a Runner?

A runner is the machine that executes a CI/CD job. In GitHub Actions, it may be hosted by GitHub or hosted by your organization. In other systems, it may be called an agent, worker, executor, or build node. The name changes, but the job is the same: it checks out code, runs commands, uses tokens, writes logs, and sometimes publishes or deploys.

The runner is where trust becomes real. A YAML file may say `npm test`, but the runner is the machine that actually runs the command. If the command can read environment variables, write files, call the network, restore a cache, or use a token, the runner is the place where those things happen.

For `devpolaris-orders-api`, the important question is:

```text
Which runner jobs can touch untrusted code, and which runner jobs can touch trusted credentials?
```

Those two abilities should stay separate. A test job can run pull request code if it has low power. A deploy job can use production identity if it only runs trusted code. Trouble starts when one runner job receives both untrusted code and trusted power.

## Trusted and Untrusted Jobs

Start by labeling jobs by trust level.

| Job | Input | Power | Trust level |
|-----|-------|-------|-------------|
| `test-pr` | Pull request code | Read source, upload test result | Untrusted input, low power |
| `build-main` | Protected `main` | Publish image | Trusted input, publish power |
| `deploy-prod` | Published image digest | Cloud deploy role | Trusted input, production power |

This table does not say the pull request author is malicious. It says the workflow should behave safely even when pull request code is hostile. That is the right baseline for public repositories, forks, and any repository where contributors do not all have the same production trust.

Here is a safer split:

```yaml
jobs:
  test-pr:
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  publish:
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: npm publish
```

The first job runs pull request code with read access. The second job publishes only from `main`. If an attacker opens a pull request that changes `package.json` scripts, the test job may run those scripts, but the publish job does not run from that untrusted branch.

## Runner State

Runner state is anything that survives long enough to affect another step or job. The most common forms are workspace files, dependency caches, build outputs, artifacts, Docker layers, and installed tools.

```text
runner state
|-- workspace files
|-- dependency cache
|-- build artifact
|-- environment variables
|-- process memory
`-- network access
```

Hosted runners usually start clean for each job, but the job can still restore caches and download artifacts created earlier. Self-hosted runners need more care because files, containers, credentials, or processes may survive between jobs if the runner is not isolated correctly.

Caches deserve special attention. A cache is useful because it moves data from one run to another. That is also why it can become a trust boundary. If a pull request job can write a cache that a release job later restores, untrusted state may cross into a trusted job.

Use cache keys that include the trust context. A cache written by pull request validation should not be accepted by a release job with publish or deploy authority.

## Job Permissions

The runner receives power through tokens and secrets. In GitHub Actions, the `GITHUB_TOKEN` permissions and any explicit secrets or OIDC tokens define what the job can do.

```yaml
permissions:
  contents: read

jobs:
  test:
    permissions:
      contents: read

  deploy:
    environment: production
    permissions:
      contents: read
      id-token: write
```

The top-level `contents: read` sets a low default. The deploy job asks for `id-token: write` because it needs cloud identity. The production environment lets the platform apply approval and environment rules before deployment.

Read permissions as part of the job design. If a test job suddenly needs `id-token: write`, ask why a test needs cloud identity. If a lint job needs package write permission, ask which step publishes. If a deploy job runs on pull request events, ask how untrusted code is kept away from production identity.

## Third-Party Actions

A third-party action is code you run inside your workflow. It can read files, environment variables, and tokens available to the job. Treat it like a dependency that executes in CI.

```yaml
steps:
  - uses: vendor/action-name@v2
```

The `@v2` part is a mutable reference unless the owner keeps it fixed. A safer high-security pattern is to pin important third-party actions to a full commit SHA and review updates intentionally.

```yaml
steps:
  - uses: vendor/action-name@8f2a91d4c0b8d1f4a2b6c3d4e5f60718293abcde
```

Pinning is not free. It creates update work. The benefit is that the action content cannot change after review just because a tag moved. For workflows that can publish, deploy, or read sensitive secrets, that tradeoff is usually worth the maintenance.

## Case Study: TanStack

TanStack's May 2026 npm supply-chain postmortem is a clear runner-boundary case. The attack path involved a `pull_request_target` workflow, cache poisoning across fork and base repository trust boundaries, and extraction of an OIDC token from the runner process. The result was malicious versions published to npm across multiple TanStack packages.

The useful runner lesson is the movement of trust:

```text
untrusted pull request
  -> workflow with base repository context
  -> cache state crossing boundary
  -> trusted runner context
  -> publish-capable identity
  -> malicious npm versions
```

The compromised publish did not require a long-lived npm token sitting in a repository secret. Trusted publishing through OIDC can still be abused if the trusted runner context is reachable by attacker-controlled code or state. OIDC reduces static secret risk, but the runner boundary still has to be correct.

The hardening direction follows the same path in reverse: remove unsafe `pull_request_target` patterns, separate untrusted and trusted jobs, limit cache sharing across trust levels, pin sensitive third-party actions, add ownership around workflow changes, and watch package publishes.

## Runner Evidence

When reviewing a runner job, capture the fields that explain its trust level.

```text
Workflow: release.yml
Job: publish
Event: push
Ref: refs/heads/main
Runner: github-hosted ubuntu-latest
Permissions: contents:read, id-token:write
Secrets: none
Cache restore: npm-main-${{ hashFiles('package-lock.json') }}
Publishes: @devpolaris/orders-api
```

`Event` and `Ref` tell you whether the source is trusted. `Runner` tells you where the commands ran. `Permissions` and `Secrets` tell you what authority was present. `Cache restore` tells you whether state crossed from earlier work. `Publishes` tells you the sensitive output.

This evidence is also useful after an incident. If a third-party action is compromised, you can search which jobs used it and which permissions those jobs had.

## Putting It All Together

A CI/CD runner is a machine that turns workflow text into real action. It can run untrusted code safely only when the job has low power and clean boundaries. It can publish or deploy safely only when the job receives trusted input and narrow identity.

The TanStack case shows why this distinction matters. A workflow boundary, cache boundary, and runner identity boundary combined into one attack path. Each one looked like implementation detail until the path was visible.

For `devpolaris-orders-api`, runner security means separate jobs for untrusted validation and trusted publishing, low default token permissions, careful cache scope, reviewed third-party actions, and evidence that names the event, ref, runner, permissions, cache, and publish target.

## What's Next

Once runner boundaries are clear, the next risk is the code you did not write. Dependency scanning explains how packages enter the delivery path and how to decide whether a finding needs a patch, replacement, or exception.

---

**References**

- [TanStack npm supply-chain compromise postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) - TanStack documents the attack chain and affected package publishes.
- [Hardening TanStack after the npm compromise](https://tanstack.com/blog/incident-followup) - TanStack describes follow-up hardening, including workflow and action changes.
- [GitHub Actions secure use reference](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-githubs-security-features-to-secure-your-use-of-github-actions) - GitHub documents safer workflow patterns, token handling, and third-party action risk.
- [GitHub Actions workflow syntax permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) - GitHub documents job and workflow token permissions.

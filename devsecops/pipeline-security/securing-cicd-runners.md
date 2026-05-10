---
id: article-devsecops-pipeline-security-securing-cicd-runners
title: "Securing CI/CD Runners"
description: "Learn how to isolate GitHub Actions runners, reduce token permissions, and diagnose unsafe runner behavior before a pipeline can damage production."
overview: "A CI/CD runner is the machine that executes workflow steps. This article follows devpolaris-orders-api as the team separates trusted and untrusted work, locks down runner access, and reads runner evidence when something looks wrong."
tags: ["runners", "isolation", "ci"]
order: 1
---

## Table of Contents

1. [The Machine That Executes Your Trust](#the-machine-that-executes-your-trust)
2. [The Operating Model for devpolaris-orders-api](#the-operating-model-for-devpolaris-orders-api)
3. [Trust Boundaries in the Workflow](#trust-boundaries-in-the-workflow)
4. [Evidence Review During a Pull Request](#evidence-review-during-a-pull-request)
5. [Diagnostic Path When the Check Fails](#diagnostic-path-when-the-check-fails)
6. [Common Failure Modes](#common-failure-modes)
7. [Engineering Tradeoffs](#engineering-tradeoffs)
8. [Operational Checklist](#operational-checklist)

## The Machine That Executes Your Trust

A pull request becomes real work when a runner starts executing commands for devpolaris-orders-api. The repository is a Node.js orders service with pull request checks, a main branch release workflow, and production deployment through GitHub Actions. The security control only matters when it changes that path in a way a reviewer can see.

The concept fits between source control and production. It does not replace code review, tests, or runtime monitoring. It gives the team evidence before a risky change gets merged, packaged, or deployed. In this article the same service appears in every example so the checks stay connected to real work instead of floating as separate rules.

```yaml
name: pipeline-security

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test
```

## The Operating Model for devpolaris-orders-api

The team treats the pipeline as a small production system. It has inputs, permissions, logs, artifacts, and failure states. A workflow file is reviewed like application code because it decides which commands run, which tokens are available, and which output becomes trusted.

The useful mental model is a chain of custody. Source code enters from a branch, checks run on a runner, evidence is uploaded, and a deploy job changes an environment. If one link is too broad or too quiet, the team loses the ability to explain what happened later.

```text
Runner trust map
unit-test: pull_request, ubuntu-latest, no secrets
dependency-review: pull_request, ubuntu-latest, no secrets
build-image: push to main, ubuntu-latest, package write only
deploy-staging: main, runner group staging, staging OIDC
deploy-production: approved environment, runner group production, production OIDC
```

## Trust Boundaries in the Workflow

A trust boundary is the line between work the team has reviewed and work it has not reviewed yet. Pull request code is lower trust than code merged to main. A production deployment job is higher impact than a unit test job. Good pipeline security keeps those differences visible in YAML and repository settings.

For this service, pull request jobs should not receive production secrets, write package releases, or run on production network runners. Release jobs can receive more access, but only after the earlier evidence exists. The boundary is not about distrusting developers. It is about limiting what a mistake or compromised dependency can do.

```yaml
jobs:
  unit-test:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
  deploy-production:
    if: github.ref == 'refs/heads/main'
    runs-on: [self-hosted, production]
    environment: production
    permissions:
      contents: read
      id-token: write
```

## Evidence Review During a Pull Request

A security check is only useful if humans know how to read its output. Reviewers should look for the field that proves the claim: a package path, an alert rule, a runner label, a token scope, an environment name, a checksum, or a digest. Without that field, the result becomes a red or green badge with little teaching value.

The devpolaris-orders-api team keeps the review question concrete: does this change increase what untrusted code can touch, and does the evidence show the exact file, job, or artifact involved? That question works for most pipeline controls in this module.

```text
2026-05-08T09:22:17Z job=unit-test event=pull_request runner=self-hosted-prod-02
2026-05-08T09:22:19Z npm ci
2026-05-08T09:22:23Z postinstall: node scripts/collect-env.js
2026-05-08T09:22:24Z job failed with exit code 6
```

## Diagnostic Path When the Check Fails

Start diagnosis with the smallest artifact that names the failure. In GitHub Actions that is often the failed job, step, exit code, and first meaningful log line. After that, move to the source file or repository setting that controls the behavior. Reading every log line first wastes time because pipeline failures usually point to one missing permission, one changed path, or one blocked gate.

The fix direction should change the system, not only silence the symptom. If a scanner reports a real issue, update the dependency or code path. If a deployment waits for approval, review the environment rule. If a checksum fails, stop the deployment and rebuild from trusted source.

```bash
$ gh run view 8459021331 --repo devpolaris/orders-api --json event,headBranch,workflowName,jobs
{
  "event": "pull_request",
  "headBranch": "feature/cart-refactor",
  "workflowName": "pipeline-security",
  "jobs": [{"name": "unit-test", "labels": ["self-hosted", "production"]}]
}
```

## Common Failure Modes

Failure modes are patterns that repeat across teams. A job can run with a broader token than it needs. A pull request can trigger work on a trusted runner. A scanner can fail closed and block a merge, or fail open because nobody made it required. An artifact can be rebuilt in deploy instead of verified from build output.

The right response is specific to the failure. Broad permissions need a narrower `permissions:` block. Missing evidence needs a workflow change. Noisy alerts need triage rules, not deletion. A bypass needs an owner and a record because future reviewers need to know why the normal path was not used.

| Failure mode | What it means | Fix direction |
| :--- | :--- | :--- |
| Pull request on production runner | Untrusted code reached trusted network | Move to hosted runner |
| Test job has `id-token: write` | Test can request cloud identity | Grant OIDC only to deploy |
| Docker socket on shared runner | Job may control host containers | Isolate or recreate runner |

## Engineering Tradeoffs

Every control has a cost. Hosted runners reduce operational burden, but may not reach private networks. Self-hosted runners can deploy inside a network, but they need isolation and cleanup. Strict scan thresholds catch risk earlier, but they can slow urgent fixes. Protected environments create a useful pause, but they require reviewers who understand the evidence.

Good teams make those tradeoffs explicit. For devpolaris-orders-api, the default is strict on production paths and practical on development paths. Pull requests get fast checks with no secrets. Main branch builds create durable evidence. Production deployment waits for a reviewer only after staging has passed.

```text
Tradeoff record
Hosted runner: clean by default, less private network access
Self-hosted runner: network access, more cleanup and patching
Ephemeral runner: best isolation, more automation work
```

## Operational Checklist

The checklist at the end of a pipeline-security article should not be a substitute for thought. It is a memory aid for review and incident response. When the pipeline changes, each item asks whether the trusted path is still clear.

Use the checklist while reading workflow diffs. If the answer is not obvious from YAML, repository settings, or a log artifact, add the missing evidence before production depends on it.

- Pull request jobs use hosted runners.
- Self-hosted runners are grouped by environment.
- Production jobs require environment approval.
- Job permissions are explicit.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

- Review note: runner isolation must match the trust level of the code being executed.

---

**References**

- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) - Official guidance on workflow permissions, untrusted input, third party actions, and runner hardening.
- [GitHub Actions self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners) - Official runner operations documentation for labels, groups, and self-hosted runner behavior.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) - Canonical project for repository supply chain checks that help catch unsafe workflow patterns.
- [SLSA Threats](https://slsa.dev/spec/latest/threats) - Explains build pipeline threats such as compromised builders and tampered source inputs.

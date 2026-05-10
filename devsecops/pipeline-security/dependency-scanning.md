---
id: article-devsecops-pipeline-security-dependency-scanning
title: "Dependency Scanning"
description: "Learn how to scan npm dependencies, read vulnerability evidence, and decide whether to patch, replace, or accept dependency risk in CI."
overview: "Dependency scanning turns package metadata and lockfiles into security evidence. This article follows devpolaris-orders-api through Dependabot, npm audit, lockfile review, and the difference between vulnerable packages and malicious packages."
tags: ["dependencies", "npm", "vulnerabilities"]
order: 2
---

## Table of Contents

1. [The Code You Did Not Write Still Ships](#the-code-you-did-not-write-still-ships)
2. [The Operating Model for devpolaris-orders-api](#the-operating-model-for-devpolaris-orders-api)
3. [Trust Boundaries in the Workflow](#trust-boundaries-in-the-workflow)
4. [Evidence Review During a Pull Request](#evidence-review-during-a-pull-request)
5. [Diagnostic Path When the Check Fails](#diagnostic-path-when-the-check-fails)
6. [Common Failure Modes](#common-failure-modes)
7. [Engineering Tradeoffs](#engineering-tradeoffs)
8. [Operational Checklist](#operational-checklist)

## The Code You Did Not Write Still Ships

The orders API ships more code than the team writes by hand, because every npm install brings a dependency graph with it. The repository is a Node.js orders service with pull request checks, a main branch release workflow, and production deployment through GitHub Actions. The security control only matters when it changes that path in a way a reviewer can see.

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
devpolaris-orders-api/
  package.json
  package-lock.json
  .github/dependabot.yml
  .github/workflows/dependency-security.yml
```

## Trust Boundaries in the Workflow

A trust boundary is the line between work the team has reviewed and work it has not reviewed yet. Pull request code is lower trust than code merged to main. A production deployment job is higher impact than a unit test job. Good pipeline security keeps those differences visible in YAML and repository settings.

For this service, pull request jobs should not receive production secrets, write package releases, or run on production network runners. Release jobs can receive more access, but only after the earlier evidence exists. The boundary is not about distrusting developers. It is about limiting what a mistake or compromised dependency can do.

```bash
$ npm ls minimist
devpolaris-orders-api@1.8.0 /work/orders-api
`--  legacy-report-exporter@2.4.1
  `--  minimist@0.0.8
```

## Evidence Review During a Pull Request

A security check is only useful if humans know how to read its output. Reviewers should look for the field that proves the claim: a package path, an alert rule, a runner label, a token scope, an environment name, a checksum, or a digest. Without that field, the result becomes a red or green badge with little teaching value.

The devpolaris-orders-api team keeps the review question concrete: does this change increase what untrusted code can touch, and does the evidence show the exact file, job, or artifact involved? That question works for most pipeline controls in this module.

```text
Dependabot alert
Package: minimist
Manifest: package-lock.json
Dependency path: legacy-report-exporter > minimist
Severity: high
Patched version: available through legacy-report-exporter 2.5.0
```

## Diagnostic Path When the Check Fails

Start diagnosis with the smallest artifact that names the failure. In GitHub Actions that is often the failed job, step, exit code, and first meaningful log line. After that, move to the source file or repository setting that controls the behavior. Reading every log line first wastes time because pipeline failures usually point to one missing permission, one changed path, or one blocked gate.

The fix direction should change the system, not only silence the symptom. If a scanner reports a real issue, update the dependency or code path. If a deployment waits for approval, review the environment rule. If a checksum fails, stop the deployment and rebuild from trusted source.

```text
npm audit report
minimist <=0.2.3
Severity: high
Prototype Pollution in minimist
legacy-report-exporter depends on vulnerable minimist
1 high severity vulnerability
```

## Common Failure Modes

Failure modes are patterns that repeat across teams. A job can run with a broader token than it needs. A pull request can trigger work on a trusted runner. A scanner can fail closed and block a merge, or fail open because nobody made it required. An artifact can be rebuilt in deploy instead of verified from build output.

The right response is specific to the failure. Broad permissions need a narrower `permissions:` block. Missing evidence needs a workflow change. Noisy alerts need triage rules, not deletion. A bypass needs an owner and a record because future reviewers need to know why the normal path was not used.

| Failure mode | What it looks like | Fix direction |
| :--- | :--- | :--- |
| Vulnerable transitive package | `npm ls` shows parent package | Upgrade parent package |
| Clean audit but new install script | Lockfile shows `hasInstallScript` | Review package and runner exposure |
| Major fix suggested | `npm audit fix` changes API | Test feature and review diff |

## Engineering Tradeoffs

Every control has a cost. Hosted runners reduce operational burden, but may not reach private networks. Self-hosted runners can deploy inside a network, but they need isolation and cleanup. Strict scan thresholds catch risk earlier, but they can slow urgent fixes. Protected environments create a useful pause, but they require reviewers who understand the evidence.

Good teams make those tradeoffs explicit. For devpolaris-orders-api, the default is strict on production paths and practical on development paths. Pull requests get fast checks with no secrets. Main branch builds create durable evidence. Production deployment waits for a reviewer only after staging has passed.

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

## Operational Checklist

The checklist at the end of a pipeline-security article should not be a substitute for thought. It is a memory aid for review and incident response. When the pipeline changes, each item asks whether the trusted path is still clear.

Use the checklist while reading workflow diffs. If the answer is not obvious from YAML, repository settings, or a log artifact, add the missing evidence before production depends on it.

- Check direct and transitive dependency paths.
- Prefer parent package updates over random overrides.
- Keep runtime dependency fixes small.
- Document accepted risk with an owner and review date.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

- Review note: dependency evidence must name the package path, reachable feature, and fix direction.

---

**References**

- [Dependabot alerts](https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts) - Official explanation of how GitHub reports vulnerable dependencies.
- [Dependabot version updates](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file) - Official reference for configuring dependency update pull requests.
- [npm audit](https://docs.npmjs.com/cli/commands/npm-audit) - Canonical npm documentation for audit reports and remediation behavior.
- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/) - Canonical OWASP project page for dependency vulnerability scanning across ecosystems.

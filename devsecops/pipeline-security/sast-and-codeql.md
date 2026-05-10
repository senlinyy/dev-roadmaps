---
id: article-devsecops-pipeline-security-sast-and-codeql
title: "SAST and CodeQL"
description: "Learn how static application security testing and CodeQL find risky code paths, how to tune scans, and how to diagnose code scanning failures."
overview: "SAST reads source code before the application runs. This article uses CodeQL on devpolaris-orders-api to show how queries become alerts, why data flow matters, and how to turn findings into useful fixes."
tags: ["sast", "codeql", "code-scanning"]
order: 3
---

## Table of Contents

1. [Reading Code Before It Runs](#reading-code-before-it-runs)
2. [The Operating Model for devpolaris-orders-api](#the-operating-model-for-devpolaris-orders-api)
3. [Trust Boundaries in the Workflow](#trust-boundaries-in-the-workflow)
4. [Evidence Review During a Pull Request](#evidence-review-during-a-pull-request)
5. [Diagnostic Path When the Check Fails](#diagnostic-path-when-the-check-fails)
6. [Common Failure Modes](#common-failure-modes)
7. [Engineering Tradeoffs](#engineering-tradeoffs)
8. [Operational Checklist](#operational-checklist)

## Reading Code Before It Runs

Some security bugs are visible in source code before the API starts or receives traffic. The repository is a Node.js orders service with pull request checks, a main branch release workflow, and production deployment through GitHub Actions. The security control only matters when it changes that path in a way a reviewer can see.

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

```yaml
name: codeql
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  security-events: write
  actions: read
jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
```

## Trust Boundaries in the Workflow

A trust boundary is the line between work the team has reviewed and work it has not reviewed yet. Pull request code is lower trust than code merged to main. A production deployment job is higher impact than a unit test job. Good pipeline security keeps those differences visible in YAML and repository settings.

For this service, pull request jobs should not receive production secrets, write package releases, or run on production network runners. Release jobs can receive more access, but only after the earlier evidence exists. The boundary is not about distrusting developers. It is about limiting what a mistake or compromised dependency can do.

```text
Code scanning alert
Rule: js/sql-injection
Severity: error
Source: src/routes/orders.ts:42 req.query.status
Sink: src/db/orders.ts:18 db.raw(query)
Path: routes/orders.ts -> services/order-search.ts -> db/orders.ts
```

## Evidence Review During a Pull Request

A security check is only useful if humans know how to read its output. Reviewers should look for the field that proves the claim: a package path, an alert rule, a runner label, a token scope, an environment name, a checksum, or a digest. Without that field, the result becomes a red or green badge with little teaching value.

The devpolaris-orders-api team keeps the review question concrete: does this change increase what untrusted code can touch, and does the evidence show the exact file, job, or artifact involved? That question works for most pipeline controls in this module.

```typescript
const status = String(req.query.status ?? "open");
const orders = await db.raw(
  "select * from orders where status = ?",
  [status]
);
```

## Diagnostic Path When the Check Fails

Start diagnosis with the smallest artifact that names the failure. In GitHub Actions that is often the failed job, step, exit code, and first meaningful log line. After that, move to the source file or repository setting that controls the behavior. Reading every log line first wastes time because pipeline failures usually point to one missing permission, one changed path, or one blocked gate.

The fix direction should change the system, not only silence the symptom. If a scanner reports a real issue, update the dependency or code path. If a deployment waits for approval, review the environment rule. If a checksum fails, stop the deployment and rebuild from trusted source.

```text
2026-05-08T10:14:31Z github/codeql-action/autobuild
Error: We were unable to automatically build your code.
Command failed: npm run build
src/generated/routes.ts: No such file or directory
```

## Common Failure Modes

Failure modes are patterns that repeat across teams. A job can run with a broader token than it needs. A pull request can trigger work on a trusted runner. A scanner can fail closed and block a merge, or fail open because nobody made it required. An artifact can be rebuilt in deploy instead of verified from build output.

The right response is specific to the failure. Broad permissions need a narrower `permissions:` block. Missing evidence needs a workflow change. Noisy alerts need triage rules, not deletion. A bypass needs an owner and a record because future reviewers need to know why the normal path was not used.

| Failure mode | Diagnosis | Fix direction |
| :--- | :--- | :--- |
| Alert has source and sink | Read data flow path | Fix the code path |
| Autobuild fails | Generated file missing | Add real build steps |
| Alert dismissed without reason | No evidence for reviewer | Require reason and owner |

## Engineering Tradeoffs

Every control has a cost. Hosted runners reduce operational burden, but may not reach private networks. Self-hosted runners can deploy inside a network, but they need isolation and cleanup. Strict scan thresholds catch risk earlier, but they can slow urgent fixes. Protected environments create a useful pause, but they require reviewers who understand the evidence.

Good teams make those tradeoffs explicit. For devpolaris-orders-api, the default is strict on production paths and practical on development paths. Pull requests get fast checks with no secrets. Main branch builds create durable evidence. Production deployment waits for a reviewer only after staging has passed.

```text
Pull request #417
unit-test: success
npm-audit: success
codeql: success
new code scanning alerts: 1
required action: fixed or dismissed with reviewed reason
```

## Operational Checklist

The checklist at the end of a pipeline-security article should not be a substitute for thought. It is a memory aid for review and incident response. When the pipeline changes, each item asks whether the trusted path is still clear.

Use the checklist while reading workflow diffs. If the answer is not obvious from YAML, repository settings, or a log artifact, add the missing evidence before production depends on it.

- Treat source, sink, and path as the core alert evidence.
- Keep scanner permissions separate from deployment permissions.
- Fix risky data flow before dismissing alerts.
- Add custom build steps when autobuild misses generated files.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

- Review note: static analysis findings need source, sink, path, and a reviewed fix.

---

**References**

- [About code scanning with CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) - Official GitHub overview of CodeQL and code scanning alerts.
- [CodeQL documentation](https://codeql.github.com/docs/) - Canonical CodeQL language, query, and CLI documentation.
- [Uploading SARIF to GitHub code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github) - Official reference for uploading scanner results into GitHub code scanning.
- [OWASP Code Review Guide](https://owasp.org/www-project-code-review-guide/) - Canonical guide for reviewing application code for security flaws.

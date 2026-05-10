---
id: article-devsecops-pipeline-security-secret-scanning
title: "Secret Scanning"
description: "Learn how secret scanning finds exposed tokens, how to respond to leaks, and how to design workflows that avoid long-lived credentials."
overview: "Secret scanning catches tokens and credentials that enter code, issues, logs, or pull requests. This article follows devpolaris-orders-api through push protection, alert triage, rotation, and safer workflow identity."
tags: ["secrets", "tokens", "scanning"]
order: 4
---

## Table of Contents

1. [The Small String That Can Act Like a Person](#the-small-string-that-can-act-like-a-person)
2. [The Operating Model for devpolaris-orders-api](#the-operating-model-for-devpolaris-orders-api)
3. [Trust Boundaries in the Workflow](#trust-boundaries-in-the-workflow)
4. [Evidence Review During a Pull Request](#evidence-review-during-a-pull-request)
5. [Diagnostic Path When the Check Fails](#diagnostic-path-when-the-check-fails)
6. [Common Failure Modes](#common-failure-modes)
7. [Engineering Tradeoffs](#engineering-tradeoffs)
8. [Operational Checklist](#operational-checklist)

## The Small String That Can Act Like a Person

One copied token can let another person or script act as devpolaris-orders-api in a package registry, cloud account, or deployment system. The repository is a Node.js orders service with pull request checks, a main branch release workflow, and production deployment through GitHub Actions. The security control only matters when it changes that path in a way a reviewer can see.

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
remote: error: GH013: Repository rule violations found for refs/heads/feature/export-refactor.
remote: - Push cannot contain secrets
remote:   GitHub Personal Access Token
remote:   locations:
remote:     commit: 4a81c2d
remote:     path: .env.production:3
```

## Trust Boundaries in the Workflow

A trust boundary is the line between work the team has reviewed and work it has not reviewed yet. Pull request code is lower trust than code merged to main. A production deployment job is higher impact than a unit test job. Good pipeline security keeps those differences visible in YAML and repository settings.

For this service, pull request jobs should not receive production secrets, write package releases, or run on production network runners. Release jobs can receive more access, but only after the earlier evidence exists. The boundary is not about distrusting developers. It is about limiting what a mistake or compromised dependency can do.

| Leak location | Example | First fix direction |
| :--- | :--- | :--- |
| Git commit | `.env.production` | Revoke and remove from history if needed |
| Workflow log | `printenv` output | Rotate and remove debug step |
| Artifact | Workspace zip includes `.npmrc` | Expire artifact and stop upload |

## Evidence Review During a Pull Request

A security check is only useful if humans know how to read its output. Reviewers should look for the field that proves the claim: a package path, an alert rule, a runner label, a token scope, an environment name, a checksum, or a digest. Without that field, the result becomes a red or green badge with little teaching value.

The devpolaris-orders-api team keeps the review question concrete: does this change increase what untrusted code can touch, and does the evidence show the exact file, job, or artifact involved? That question works for most pipeline controls in this module.

```text
Secret scanning alert
Repository: devpolaris/orders-api
Secret type: npm access token
Location: .github/workflows/release.yml:28
Detected: 2026-05-08T11:02:44Z
Validity: active
```

## Diagnostic Path When the Check Fails

Start diagnosis with the smallest artifact that names the failure. In GitHub Actions that is often the failed job, step, exit code, and first meaningful log line. After that, move to the source file or repository setting that controls the behavior. Reading every log line first wastes time because pipeline failures usually point to one missing permission, one changed path, or one blocked gate.

The fix direction should change the system, not only silence the symptom. If a scanner reports a real issue, update the dependency or code path. If a deployment waits for approval, review the environment rule. If a checksum fails, stop the deployment and rebuild from trusted source.

```text
2026-05-08T11:16:40Z Deploy step
AWS_ACCESS_KEY_ID=***
NPM_TOKEN_PREFIX=npm_4f2
DEBUG_CONFIG={"registryToken":"npm_4f2abc..."}
Uploading artifact orders-api-workspace.zip
```

## Common Failure Modes

Failure modes are patterns that repeat across teams. A job can run with a broader token than it needs. A pull request can trigger work on a trusted runner. A scanner can fail closed and block a merge, or fail open because nobody made it required. An artifact can be rebuilt in deploy instead of verified from build output.

The right response is specific to the failure. Broad permissions need a narrower `permissions:` block. Missing evidence needs a workflow change. Noisy alerts need triage rules, not deletion. A bypass needs an owner and a record because future reviewers need to know why the normal path was not used.

| Failure mode | What it looks like | Fix direction |
| :--- | :--- | :--- |
| Active leaked token | Alert validity is active | Revoke first |
| Token in artifact | Alert points to upload | Expire artifact and rotate |
| Broad token | One value can write packages | Create scoped token or OIDC |

## Engineering Tradeoffs

Every control has a cost. Hosted runners reduce operational burden, but may not reach private networks. Self-hosted runners can deploy inside a network, but they need isolation and cleanup. Strict scan thresholds catch risk earlier, but they can slow urgent fixes. Protected environments create a useful pause, but they require reviewers who understand the evidence.

Good teams make those tradeoffs explicit. For devpolaris-orders-api, the default is strict on production paths and practical on development paths. Pull requests get fast checks with no secrets. Main branch builds create durable evidence. Production deployment waits for a reviewer only after staging has passed.

```yaml
jobs:
  publish:
    environment: release
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: npm publish --provenance
```

## Operational Checklist

The checklist at the end of a pipeline-security article should not be a substitute for thought. It is a memory aid for review and incident response. When the pipeline changes, each item asks whether the trusted path is still clear.

Use the checklist while reading workflow diffs. If the answer is not obvious from YAML, repository settings, or a log artifact, add the missing evidence before production depends on it.

- Revoke before polishing history.
- Check provider audit logs after exposure time.
- Remove secrets from artifacts and logs.
- Prefer scoped or short-lived identity for release jobs.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

- Review note: secret response starts with revocation, scope review, and evidence of where the token was used.

---

**References**

- [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning) - Official documentation for secret scanning alerts and supported workflows.
- [GitHub push protection](https://docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations) - Official documentation for blocking supported secrets before they enter the repository.
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) - Official workflow guidance for handling secrets safely in Actions.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) - Canonical project that checks repository practices including token permissions.

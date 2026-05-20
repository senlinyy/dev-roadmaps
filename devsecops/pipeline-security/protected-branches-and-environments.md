---
title: "Protected Branches and Environments"
description: "Use source and deployment gates to control what can merge, what can deploy, and who must approve risky changes."
overview: "Protected branches guard source changes. Deployment environments guard production changes. This article follows one delivery path and explains how checks, reviews, approvals, and branch rules work together."
tags: ["branches", "environments", "approvals", "github-actions"]
order: 5
id: article-devsecops-pipeline-security-protected-branches-and-environments
---

## Table of Contents

1. [Two Gates](#two-gates)
2. [Branch Protection](#branch-protection)
3. [Required Checks](#required-checks)
4. [Code Owners](#code-owners)
5. [Deployment Environments](#deployment-environments)
6. [Blocked Release Evidence](#blocked-release-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Two Gates

A delivery path usually needs two different gates. The source gate controls what can merge. The deployment gate controls what can reach an environment.

```text
pull request
  -> source gate
  -> main branch
  -> build
  -> deployment gate
  -> production
```

The source gate is branch protection. It can require reviews, status checks, signed commits, linear history, or restrictions on who can push. The deployment gate is an environment rule. It can require reviewers, wait timers, branch restrictions, and environment-specific secrets.

These gates answer different questions. Branch protection asks whether the code change is accepted. The production environment asks whether this accepted change should deploy now.

## Branch Protection

Branch protection gives the main branch rules.

```text
Branch: main
Required pull request reviews: 1
Required status checks: test, dependency-review, codeql
Require branches to be up to date: yes
Restrict direct pushes: yes
Require CODEOWNERS review: yes
```

Read this record like a policy. A change cannot merge until one review is present, the required checks pass, the branch is current, direct pushes are blocked, and owned paths receive the right reviewers.

The risk of an unprotected branch is simple: the branch becomes a direct path to trusted workflows. If publishing and deployment run from `main`, then `main` must be protected.

## Required Checks

Required checks turn automated evidence into a merge gate. For the orders service, useful checks include tests, dependency review, CodeQL, secret scanning, and build validation.

```text
Required checks for main
- test
- dependency-review
- codeql
- secret-scan
- build-image
```

Each check should have a clear job. `test` proves basic behavior. `dependency-review` explains package changes. `codeql` scans code paths. `secret-scan` checks for credentials. `build-image` proves the artifact can be built.

A check should not be required if nobody knows what it proves or who owns failures. Required checks become production gates. Give them owners.

## Code Owners

`CODEOWNERS` maps sensitive paths to reviewers.

```text
.github/workflows/        @platform-team @security-team
infra/production/         @platform-team @cloud-security
src/payments/             @orders-team @security-team
deploy/kubernetes/prod/   @platform-team @orders-team
```

This file makes ownership show up during review. A workflow permission change reaches platform and security reviewers. Production infrastructure reaches cloud security. Payment code reaches application and security reviewers.

The map should be specific enough to catch sensitive changes and small enough that review remains useful. If every file requires every team, reviewers stop treating requests as meaningful.

## Deployment Environments

GitHub environments protect deployment targets. A workflow job can name an environment:

```yaml
jobs:
  deploy-prod:
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - run: ./scripts/deploy-prod.sh
```

The environment can require approval before the job proceeds. It can also hold environment-specific secrets and restrict which branches can deploy.

```text
Environment: production
Required reviewers: platform-oncall
Allowed branches: main
Secrets: none, uses OIDC
Wait timer: 0 minutes
```

The `Allowed branches` line is important. A production deploy environment should not accept a random feature branch unless the team has a deliberate emergency path. The `Secrets` line is also important. If the environment holds long-lived secrets, any job that reaches the environment may receive them.

## Blocked Release Evidence

A blocked release should explain which gate stopped it.

```text
Release: orders-api 2026.05.19.1
Blocked at: production environment
Reason: required reviewer missing
Workflow: orders-api-delivery #1842
Ref: refs/heads/main
Artifact: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Next action: platform-oncall review
```

This record prevents guesswork. The source branch was accepted. The artifact exists. The production gate is waiting for a required reviewer. The next action is not "rerun everything"; it is "get the environment review."

When a branch protection rule blocks a merge, the evidence should be equally specific:

```text
Blocked at: branch protection
Reason: CodeQL check failed
Pull request: #421
Owner: orders-team
Next action: fix query construction in src/routes/orders.ts
```

## Putting It All Together

Protected branches and environments create two gates in the delivery path. Branch protection keeps unreviewed or failing code out of trusted source. Deployment environments keep production changes behind environment-specific approval and branch rules.

For `devpolaris-orders-api`, the source gate requires review, code owner approval, and checks. The production gate requires an approved workflow from `main` and a narrow deploy identity. When a release blocks, the evidence should say which gate blocked it and what action is next.

## What's Next

After a change passes the source and deployment gates, the team still needs to prove that the artifact deployed is the artifact the trusted build produced. That is artifact integrity.

---

**References**

- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - GitHub documents branch protection rules, required reviews, and required status checks.
- [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - GitHub documents code owners and automatic review requests.
- [GitHub deployments and environments](https://docs.github.com/en/actions/reference/deployments-and-environments) - GitHub documents environment protection rules, required reviewers, secrets, and deployment branch restrictions.

---
title: "Protected Branches and Environment Gates"
description: "Use branch rules, required checks, CODEOWNERS, merge queues, and environment approvals to control what can reach production."
overview: "Protected branches and environment gates turn a CI/CD pipeline into a controlled release path. This article follows Summit Retail's checkout-api as the team adds review rules, required checks, production approvals, security scan gates, emergency bypass evidence, and release records."
tags: ["devsecops", "branch-protection", "deployment-gates", "approvals"]
order: 3
id: article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates
---

## Table of Contents

1. [The Delivery Path We Are Protecting](#the-delivery-path-we-are-protecting)
2. [Protected Branches and Rulesets](#protected-branches-and-rulesets)
3. [Required Reviews and CODEOWNERS](#required-reviews-and-codeowners)
4. [Required Checks and Unique Job Names](#required-checks-and-unique-job-names)
5. [Merge Queue for Busy Branches](#merge-queue-for-busy-branches)
6. [Deployment Environments](#deployment-environments)
7. [GitHub Actions Gates in Practice](#github-actions-gates-in-practice)
8. [Security Scan Gates](#security-scan-gates)
9. [Break-Glass Bypass Evidence](#break-glass-bypass-evidence)
10. [Release Records](#release-records)
11. [GitLab and Jenkins Context](#gitlab-and-jenkins-context)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Delivery Path We Are Protecting
<!-- section-summary: The source branch, pull request, CI checks, and deployment environment form one release path, so each step needs a control that matches its risk. -->

Let's keep going with Summit Retail and the `checkout-api`. In the last two articles in this module, the team handled the machines that run pipeline jobs and the tokens those jobs can receive. That work matters because a CI/CD pipeline can build code, read repository data, request cloud credentials, push container images, and deploy software that customers use during checkout.

Now the team has a new problem. The runner can be isolated and the token can be scoped, but a risky change can still move through the delivery path if the repository and deployment system allow it. A developer can merge directly to `main`, a pull request can skip security tests, two approved changes can collide after merge, or a production deployment can run before the on-call engineer has checked the risk.

**Protected branches** and **environment gates** fix that delivery problem from two sides. A protected branch controls which code can land in important branches such as `main` or `release/*`. An environment gate controls which workflow run can deploy to a named place such as `staging` or `production`. For Summit Retail, the protected branch guards the source of truth, and the production environment guard controls the moment the new checkout build reaches real customers.

Here is the simple flow we will build toward. It helps to see the whole delivery path first, because each control solves a different part of the same release problem. The table below gives that first map.

| Step | Control | What Summit Retail wants |
|---|---|---|
| Pull request opened | Required reviews and CODEOWNERS | Checkout platform changes need the platform team, payment changes need security review |
| CI runs | Required checks with unique names | Tests, build, dependency review, and code scanning must pass before merge |
| Busy branch updates | Merge queue | Approved PRs merge only after GitHub verifies the combined result |
| Staging deploy | Environment policy | Fast deploy from `main` with staging-only secrets |
| Production deploy | Required reviewers, wait timer, branch policy | Release manager and on-call approval before production secrets unlock |
| Emergency release | Break-glass evidence | A documented bypass with incident ID, approver, and follow-up review |

This article uses GitHub because GitHub Actions, branch protection, rulesets, CODEOWNERS, and environments make the full path visible in one place. The same ideas also show up in GitLab protected branches, GitLab protected environments, and Jenkins approval steps, so we will connect those later after the GitHub workflow is concrete.

![Protected delivery path showing pull request, CODEOWNERS review, required checks, merge queue, staging, and production gate for checkout-api](/content-assets/articles/article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates/protected-delivery-path.png)

*The protected delivery path shows the control sequence as one connected release route, from pull request review through production approval.*

## Protected Branches and Rulesets
<!-- section-summary: Branch protections and rulesets define who can change important branches and which checks must pass before that change lands. -->

A **branch** is a named line of work in Git. Teams usually treat `main` as the source of truth for code that can ship, and they use feature branches for work in progress. A **protected branch** adds rules to that branch so GitHub blocks risky updates such as direct pushes, force pushes, deletions, merges without review, or merges with failing checks.

Summit Retail protects `main` because every production deploy of `checkout-api` comes from that branch. A direct push to `main` would skip the pull request discussion, skip review ownership, and create an awkward question during an incident: who approved this change and which evidence showed it was safe? Branch protection answers that before the change lands.

GitHub has two related ways to express these controls. **Branch protection rules** are the long-standing repository feature. A repository admin can set a rule such as `main` must require a pull request, two approvals, CODEOWNERS review, required status checks, linear history, and no force pushes. GitHub documents an important detail here: only one branch protection rule applies to a branch at a time, so overlapping patterns can surprise teams.

**Rulesets** are the newer policy layer. A ruleset can target branches or tags, can run in evaluate mode before enforcement, and can live at a repository or organization level depending on your GitHub plan and permissions. Rulesets also layer together, so an organization can set a baseline rule for every repository while the `checkout-api` repository adds stricter production rules.

For Summit Retail, the policy can look like this in plain English. The actual GitHub settings live in the repository or organization settings, but the team should be able to explain the policy in words before clicking through the UI. The table shows the policy as the team would explain it.

| Repository area | Rule | Reason |
|---|---|---|
| `main` | Pull request required | Every production candidate has a review trail |
| `main` | Required status checks | A passing test suite and security scan gate every merge |
| `main` | CODEOWNERS review required | Sensitive checkout code gets the right reviewers |
| `main` | No force pushes or deletions | Release history stays auditable |
| `main` | Conversation resolution required | Review comments get handled before merge |
| `release/*` | Restrict updates to release managers | Hotfix branches stay under a smaller approval group |

Behind the scenes, GitHub evaluates the proposed update to the branch before accepting it. A normal pull request merge creates a new commit or fast-forward update. GitHub checks the branch rule or active rulesets, looks at the pull request state, checks the required status checks, checks review requirements, and then accepts or rejects the update.

The practical setup for a production branch usually has these controls. This is the checklist Summit Retail would expect to see during a repository security review. The table turns those settings into a quick checklist.

| Control | Production setting for `checkout-api` |
|---|---|
| Require a pull request before merging | Enabled for `main` |
| Required approving reviews | 2 approvals |
| Require review from CODEOWNERS | Enabled |
| Dismiss stale approvals after new commits | Enabled |
| Require status checks before merging | Enabled |
| Require branches to be up to date | Enabled or handled through merge queue |
| Require conversation resolution | Enabled |
| Restrict force pushes | Enabled by default, bypass list empty |
| Restrict deletions | Enabled |
| Include administrators | Enabled unless a documented admin bypass process exists |

The "include administrators" detail deserves attention. Some teams leave administrators outside the normal rule path because they want a recovery option. Mature teams still keep emergency access, but they record who can bypass, why they can bypass, and what evidence they need to leave behind. We will come back to break-glass later because that exception needs its own paperwork.

## Required Reviews and CODEOWNERS
<!-- section-summary: Required reviews make another human approve the change, while CODEOWNERS makes sure sensitive areas reach the people responsible for them. -->

A **pull request review** is a human approval step before code enters a protected branch. The reviewer checks intent, correctness, test coverage, operational risk, and security impact. In DevSecOps work, review gives the team a place to catch a risky deployment script, a broad token permission, or a missing scan before automation carries the change forward.

Summit Retail sets two approvals for `checkout-api` because the service touches money movement and customer orders. One approval should come from the service team. The other should come from the team that owns the sensitive area when the PR touches payment routes, deployment workflows, infrastructure policy, or authentication middleware.

That second part uses **CODEOWNERS**. A CODEOWNERS file maps repository paths to GitHub users or teams. When a pull request changes a matching path and the protected branch requires CODEOWNERS review, GitHub requires an approval from one of the listed owners before the PR can merge.

For the `checkout-api`, the file can live at `.github/CODEOWNERS`. The example uses fictional GitHub teams, but the path patterns mirror what a real service repository usually needs. The snippet shows one workable ownership map.

```gitignore
# Checkout service ownership
* @summit-retail/checkout-platform

# Payment and fraud code needs security-aware review
/src/payments/ @summit-retail/payments @summit-retail/appsec
/src/fraud/ @summit-retail/fraud @summit-retail/appsec

# Deployment and runner changes affect the release path
/.github/workflows/ @summit-retail/platform-security
/infra/ @summit-retail/platform @summit-retail/platform-security

# Container and dependency changes can affect runtime supply chain risk
/Dockerfile @summit-retail/platform-security
/package.json @summit-retail/checkout-platform @summit-retail/appsec
/package-lock.json @summit-retail/checkout-platform @summit-retail/appsec
```

This file says every change has a default owner, and some areas add stricter ownership. A small copy change in `README.md` routes to the checkout platform team. A change to `/src/payments/charge-card.ts` routes to payments and application security. A change to `.github/workflows/deploy.yml` routes to platform security because that file can alter which jobs receive tokens, secrets, and production deployment permissions.

In real teams, CODEOWNERS works best with readable team names and small enough ownership groups. A team like `@summit-retail/all-engineers` will technically satisfy ownership, but it gives very little assurance. A team like `@summit-retail/platform-security` tells auditors and incident responders that the right specialists approved the part of the repository that controls delivery risk.

Stale approvals also matter. A reviewer may approve a safe version of a PR, then the author can push a new commit that changes the deployment workflow. GitHub branch protection can dismiss stale approvals after new commits. Summit Retail enables that setting so the approval follows the code that actually merges instead of an older version of the PR.

Review rules answer who approved the change. The next question is what the machines proved about the change before the humans allowed it to merge.

## Required Checks and Unique Job Names
<!-- section-summary: Required checks turn CI jobs into merge gates, and unique job names keep the gate tied to the intended job. -->

A **status check** is a pass, fail, skipped, neutral, pending, or cancelled result attached to a commit. In GitHub Actions, each workflow job can report a check result back to the pull request. A **required check** is a status check that must reach an acceptable result before GitHub allows the protected branch update.

For Summit Retail, the `checkout-api` needs stronger evidence than "someone probably ran tests." The branch rule should require the exact checks that prove the change can build, pass tests, and satisfy security policy. If `security / dependency review` fails because the PR introduces a known vulnerable package, the merge button should stay blocked.

Here is a pull request workflow with job names written for required checks. The important detail is that each job has a stable, unique display name, because those names are the ones reviewers and branch rules rely on. The workflow below uses those names on purpose.

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read
  security-events: write
  pull-requests: read

jobs:
  unit_tests:
    name: ci / unit tests
    runs-on: ubuntu-latest
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test -- --runInBand

  build_container:
    name: ci / container build
    runs-on: ubuntu-latest
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Build image
        run: docker build --pull --tag checkout-api:${{ github.sha }} .

  dependency_review:
    name: security / dependency review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Review dependency changes
        uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high

  codeql:
    name: security / codeql
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript

      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      - name: Analyze
        uses: github/codeql-action/analyze@v3
```

The branch rule should require these checks by name. This gives the merge button a clear list of evidence instead of relying on a human to remember which workflow jobs matter. The table names the checks a branch rule would select.

| Required check | What it proves |
|---|---|
| `ci / unit tests` | The service behavior still passes the test suite |
| `ci / container build` | The container image can build from the submitted code |
| `security / dependency review` | New dependency risk stays inside the team's policy |
| `security / codeql` | Static analysis completed and reported security findings |

One practical edge case is skipped checks. GitHub can treat successful, skipped, and neutral conclusions as acceptable for required checks, depending on the check type. Summit Retail keeps security gates from disappearing behind broad path filters; a scan job can decide internally that no relevant files changed, but the required check should still report a deliberate result.

GitHub documentation warns teams to use unique job names across workflows. This matters because required checks depend on check names. If two workflows both create a job called `build`, a reviewer may see confusing results, and the branch rule can point at the wrong thing or an ambiguous thing. Summit Retail uses prefixes such as `ci /`, `security /`, and `deploy /` so every required check says what category it belongs to.

There is one more practical detail. A required check has to run on the commits that are merging. A workflow that only runs on `push` to `main` leaves the pull request unprotected before merge. For PR gating, the workflow must run on `pull_request`, or the team must use a merge queue that runs checks against the exact queued merge result.

That brings us to the next production problem. Even with reviews and checks, busy branches can fail after merge because approved changes combine in an untested order.

## Merge Queue for Busy Branches
<!-- section-summary: A merge queue tests the actual combined result before a pull request lands on a busy protected branch. -->

A **merge queue** is a controlled line for approved pull requests. Instead of merging each approved PR immediately, GitHub places the PR into a queue, creates a temporary merge group, runs the required checks against that combined result, and merges only after the queued result passes.

Summit Retail hits this during a holiday checkout freeze window. Three pull requests are approved: one updates tax calculation, one changes payment retry behavior, and one updates the deployment workflow. Each PR passes alone. The combined result can still fail because two changes touch the same code path or one workflow change removes a setup step the tests still need.

Without a queue, the first PR lands, then the second PR lands based on a now older view of `main`, and the third PR might land after a quick rebase. The team may discover the combined failure after `main` has already moved. With a merge queue, GitHub tests the queued merge group before it updates `main`, so the branch only moves after the combined result has passed the required checks.

The important configuration pattern is simple. The queue needs the same evidence as a normal pull request, but it asks for that evidence on the queued merge result. The table shows the moving parts.

| Setting | Summit Retail choice |
|---|---|
| Target branch | `main` |
| Pull request required | Enabled |
| Required checks | Same CI and security checks used for PRs |
| Merge queue | Enabled for the protected branch or ruleset |
| Workflow trigger | Include `merge_group` for required Actions checks |

The workflow needs a `merge_group` trigger so the same checks run for queued merge groups. Without that trigger, the queue may wait for checks that never report on the merge-group commit. The shortened workflow below shows the trigger in context.

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main
  merge_group:
    branches:
      - main

permissions:
  contents: read
  security-events: write
  pull-requests: read

jobs:
  unit_tests:
    name: ci / unit tests
    runs-on: ubuntu-latest
    steps:
      - name: Check out code
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Run unit tests
        run: npm test -- --runInBand
```

In a small repository, Summit Retail might skip merge queue at first and rely on "branch must be up to date before merging." That works for lower traffic. Once the team has many PRs landing every day, merge queue reduces the chance that `main` breaks because each approved PR was tested alone instead of as part of the final merge order.

At this point the source branch is under control. The team has review, ownership, required checks, and a queue for busy days. The next control moves from "what can merge" to "what can deploy."

## Deployment Environments
<!-- section-summary: Deployment environments separate staging and production so each target can have its own approvers, secrets, wait time, and branch policy. -->

A **deployment environment** is a named target for a workflow deployment. In GitHub Actions, an environment can have its own protection rules, secrets, variables, and deployment history. A job references an environment by name, and GitHub applies the environment rules before that job can proceed.

Summit Retail uses two environments for `checkout-api`: `staging` and `production`. Staging is fast because developers need feedback after merge. Production is slower on purpose because a bad release can block customer payments, trigger support tickets, and create financial reconciliation work.

The difference looks like this. Staging and production both deploy `checkout-api`, but their approval rules and secrets match very different risk levels. The table makes the split explicit.

| Environment | Protection rules | Secrets | Branch policy |
|---|---|---|---|
| `staging` | No manual approval, short deploy concurrency | Staging registry token, staging cloud role | `main` |
| `production` | Required reviewers, wait timer, no self-review | Production cloud role, production signing key | `main` and `release/*` only |

**Required reviewers** are people or teams who must approve a deployment job before it accesses the protected environment. For Summit Retail, the reviewers are `@summit-retail/release-managers` and `@summit-retail/checkout-oncall`. GitHub can prevent the workflow actor from approving their own deployment, which helps avoid a single person authoring, approving, and shipping a risky production change alone.

**Wait timers** add a delay before the deployment job runs. Summit Retail uses a ten-minute production timer during business hours because it gives the release manager time to notice a late alert, a change freeze note, or a customer support escalation before the deploy starts. The timer also gives automated monitors a small window to catch an issue introduced by staging traffic.

**Deployment branch policies** restrict which branches or tags can deploy to the environment. Summit Retail allows production deploys only from `main` and `release/*`. A developer can create a feature branch and run tests, and the production environment policy rejects direct deployments from that branch.

**Environment secrets** are secrets scoped to an environment. The production deployment job can receive `PROD_CLOUD_ROLE_ARN` and `PROD_SIGNING_KEY` only when the job references the `production` environment and the environment rules pass. This is a major security boundary: the build and test jobs should never receive production secrets.

The branch controls and environment controls now reinforce each other. Branch protection says only reviewed and checked commits can reach `main`. The production environment says only approved workflow runs from allowed branches can receive production deployment permissions.

## GitHub Actions Gates in Practice
<!-- section-summary: A deployment workflow should keep staging fast, hold production behind an environment gate, and use concurrency so production releases run one at a time. -->

Now let's turn the policy into a workflow. Summit Retail wants every merge to `main` to deploy to staging. Production should run only when a release manager starts the workflow or when the team tags a release, depending on the team's process. The example below uses manual dispatch because it makes the approval path easy to see.

This workflow has three important ideas. The staging job references the `staging` environment and can run quickly. The production job references the `production` environment, so GitHub pauses the job until the required reviewers approve it. The `concurrency` block prevents two production deployments of `checkout-api` from running at the same time.

```yaml
name: checkout-api deploy

on:
  push:
    branches:
      - main
  workflow_dispatch:
    inputs:
      target_environment:
        description: Environment to deploy
        required: true
        type: choice
        options:
          - staging
          - production
      release_ticket:
        description: Release or incident ticket
        required: true
        type: string

permissions:
  contents: read
  id-token: write
  deployments: write

jobs:
  deploy_staging:
    name: deploy / staging
    if: github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.target_environment == 'staging')
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://checkout-api.staging.summit-retail.example
    concurrency:
      group: checkout-api-staging
      cancel-in-progress: true
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Build release image
        run: docker build --tag registry.example.com/checkout-api:${{ github.sha }} .

      - name: Deploy staging
        env:
          CLOUD_ROLE_ARN: ${{ secrets.STAGING_CLOUD_ROLE_ARN }}
        run: ./scripts/deploy.sh staging "${{ github.sha }}"

  deploy_production:
    name: deploy / production
    if: github.event_name == 'workflow_dispatch' && inputs.target_environment == 'production'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://checkout-api.summit-retail.example
    concurrency:
      group: checkout-api-production
      cancel-in-progress: false
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Validate release ticket
        run: |
          test -n "${{ inputs.release_ticket }}"
          echo "Release ticket: ${{ inputs.release_ticket }}"

      - name: Build release image
        run: docker build --tag registry.example.com/checkout-api:${{ github.sha }} .

      - name: Deploy production
        env:
          CLOUD_ROLE_ARN: ${{ secrets.PROD_CLOUD_ROLE_ARN }}
          SIGNING_KEY: ${{ secrets.PROD_SIGNING_KEY }}
        run: ./scripts/deploy.sh production "${{ github.sha }}"
```

The production secrets in this workflow are scoped to the production environment rather than shared across the whole repository. That placement matters because the job receives `PROD_CLOUD_ROLE_ARN` and `PROD_SIGNING_KEY` only after the `production` environment gate passes. If a test job or staging job tries to read those production secrets, GitHub withholds them through the environment boundary.

The concurrency groups solve another quiet production problem. If two release managers start production deployments five minutes apart, the second run waits for the first run instead of racing it. Summit Retail sets `cancel-in-progress: false` for production because a half-finished production deploy should finish or fail visibly. Staging can cancel older runs because the newest commit is usually the only one the team wants there.

The workflow still needs one more layer. A human production approval helps, but the approval should happen after security scans have already created evidence.

## Security Scan Gates
<!-- section-summary: Security scan gates turn dependency, code, secret, and image checks into required evidence before merge or deployment. -->

A **security scan gate** is an automated security check that must pass before a change can merge or deploy. The scan can look for vulnerable dependencies, secrets in code, unsafe patterns in application code, container image vulnerabilities, infrastructure drift, or policy violations. The important part is the gate: the result has to influence the release path.

For Summit Retail, a dependency scanner that only writes a dashboard after production deploys gives the team late information. A dependency scanner that reports `security / dependency review` on the pull request and blocks the merge gives the team early control. The same pattern applies to static analysis, secret scanning, container image scanning, and infrastructure policy checks.

GitHub supports this in two practical ways. First, branch protections and rulesets can require status checks, so the workflow jobs in the pull request must pass before merge. Second, rulesets can require code scanning results for supported code scanning tools and severity thresholds. The exact mix depends on the GitHub plan and the scanning tools the organization uses.

![Security gates showing dependency review, code scan, secret scan, and image scan blocking findings before production](/content-assets/articles/article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates/security-gates.png)

*Security gates should produce evidence before a merge or deployment decision, and a real finding should move the change into review instead of letting it drift toward production.*

Summit Retail adds a container scan job with a unique required-check name. The branch rule can then require `security / container scan` the same way it requires unit tests and CodeQL. The example keeps the scan job close to the other security checks.

```yaml
  container_scan:
    name: security / container scan
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Build image
        run: docker build --tag checkout-api:${{ github.sha }} .

      - name: Scan image
        uses: aquasecurity/trivy-action@0.30.0
        with:
          image-ref: checkout-api:${{ github.sha }}
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: "1"

      - name: Upload scan results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-results.sarif
```

The `exit-code: "1"` setting turns high and critical findings into a failing job. The SARIF upload gives GitHub code scanning a structured result that security teams can review. In production, Summit Retail would pin third-party actions to reviewed commit SHAs, which the next article covers in detail; this example keeps the action versions readable so the gate itself is easier to follow.

Security scan gates need a documented exception path because production work sometimes involves tradeoffs. A dependency may have a high finding in a development-only package, or a base image may need a vendor patch that will arrive tomorrow. Summit Retail handles those exceptions through break-glass evidence rather than silent bypass.

## Break-Glass Bypass Evidence
<!-- section-summary: Emergency bypass can exist, but it needs strong evidence so the team can review exactly what changed and why the normal gate was skipped. -->

**Break-glass** means an emergency path that lets trusted people bypass a normal control during a serious incident. The phrase comes from physical emergency boxes where a person breaks glass to access equipment. In CI/CD, break-glass can mean bypassing a ruleset, approving an environment deployment during an incident, or using an admin permission to ship a hotfix while a normal gate has a temporary outage.

Summit Retail needs this path because checkout incidents can be expensive. If customers cannot complete payment, the release manager may need to ship a one-line rollback or hotfix while a noncritical scanner is unavailable. The risk is obvious: a bypass can also hide a dangerous release. The answer is evidence, narrow permission, and after-action review.

A useful break-glass record for `checkout-api` includes the facts below. During an incident, this table gives the release manager a practical evidence target instead of a vague "we had to bypass" note. The same fields also help the post-incident review.

| Evidence | Example |
|---|---|
| Incident or change ticket | `INC-4821 checkout payment failures` |
| Repository and branch | `summit-retail/checkout-api`, `main` |
| Commit SHA | `8f31c2b9...` |
| Normal gate bypassed | `security / container scan unavailable` |
| Business reason | `Payment authorization failures affecting 18% of checkouts` |
| Approver | `@sam-release-manager` |
| Operator | `@riley-oncall` |
| Customer risk | `Checkout unavailable for card payments` |
| Rollback plan | `Redeploy previous image digest sha256:91ab...` |
| Follow-up deadline | `Security review by 2026-06-22 12:00 UTC` |

The GitHub side should match that record. Rulesets can define bypass actors. Environment protection rules can allow or prevent admin bypass depending on the environment configuration. Deployment approvals create a visible review event for the run, and workflow logs show which commit, environment, and inputs were used.

A mature break-glass path stays small. Summit Retail limits bypass ability to a release manager group. The production workflow requires a `release_ticket` input even during emergency deployment. The incident review checks the bypass record, the workflow run, the deployment status, and the follow-up PR that restores normal control.

This is also where the team should avoid hiding bypass in code. A workflow input like `skip_security=true` can silently change release behavior when the branch rule lacks an evidence requirement. If the team truly needs an exception, they should leave a record in the deployment approval, change ticket, or incident system.

## Release Records
<!-- section-summary: Release records connect commits, checks, approvals, deployment status, and rollback details into one audit trail. -->

A **release record** is the evidence package for a shipped change. It connects the code version, the checks that ran, the people who approved it, the environment where it deployed, and the rollback plan. Auditors like release records, but they also help engineers during incidents because they answer what changed without forcing the team to search through several tools.

For Summit Retail, a production release record for `checkout-api` should link the GitHub pull request, the merge commit, the workflow run, the environment approval, the container image digest, and the monitoring result after deployment. That record can live in a release tool, a change-management system, a GitHub release, or an automatically generated deployment summary.

A simple release record can look like this. The format is intentionally plain so a release manager, security reviewer, or on-call engineer can read it without knowing the pipeline internals. The example below could live in a change ticket or workflow summary.

```markdown
# checkout-api production release

- Service: checkout-api
- Environment: production
- Release ticket: CHG-10422
- Pull request: https://github.com/summit-retail/checkout-api/pull/1842
- Commit: 8f31c2b9a8e0f1b72d4f6b3e9c901d6b8a12f0e7
- Image digest: registry.example.com/checkout-api@sha256:91ab...
- Required checks:
  - ci / unit tests: passed
  - ci / container build: passed
  - security / dependency review: passed
  - security / codeql: passed
  - security / container scan: passed
- Environment approval:
  - production approved by @sam-release-manager
  - checkout on-call reviewed by @riley-oncall
- Deployment window: 2026-06-21 14:00-14:30 UTC
- Rollback target: registry.example.com/checkout-api@sha256:77cd...
- Post-deploy checks:
  - checkout error rate below 0.5%
  - payment authorization latency below 400ms p95
  - no new critical alerts for 30 minutes
```

This record is deliberately boring. It gives the next engineer enough facts to answer what shipped, who approved it, which gates passed, and how to roll back. The boring shape is valuable because incidents already add stress, and a release record should reduce searching.

GitHub deployments and environments already provide some of this history. Workflow summaries can add the rest. For example, the production job can write a deployment summary after the deploy finishes:

```yaml
      - name: Write release summary
        if: always()
        run: |
          {
            echo "## checkout-api production release"
            echo ""
            echo "- Commit: $GITHUB_SHA"
            echo "- Environment: production"
            echo "- Release ticket: ${{ inputs.release_ticket }}"
            echo "- Workflow run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
            echo "- Image: registry.example.com/checkout-api@$IMAGE_DIGEST"
          } >> "$GITHUB_STEP_SUMMARY"
```

That summary complements a formal change ticket where the organization requires one. It gives the GitHub run a durable, readable release note so the deployment evidence travels with the workflow that created it.

## GitLab and Jenkins Context
<!-- section-summary: GitLab and Jenkins use different names, but the same production pattern still controls branches, approvals, secrets, and deployment evidence. -->

GitHub is the main example here because the concrete YAML and settings fit the DevPolaris pipeline story. Industry teams use the same pattern in other systems, and recognizing the pattern matters more than memorizing one product's buttons.

In GitLab, **protected branches** can restrict who can push, merge, and force push to important branches. **Protected environments** can restrict who can deploy to targets such as production. GitLab also supports approval rules, merge request approvals, CODEOWNERS-style ownership, deployment approvals, and environment-scoped variables. The names differ, but the release path is familiar: control source changes, require evidence, limit production deploy permission, and scope production secrets to the production environment.

In Jenkins, the approval point often appears as an `input` step inside a Pipeline. A Jenkinsfile can build, test, scan, then pause before production deployment until an allowed person approves. Jenkins teams usually combine that with source control branch protections because the repository still needs to guarantee that `main` only receives reviewed code. The pipeline approval handles the deployment moment, while the repository protection handles the source branch.

Here is a small Jenkins example for context. It shows the same human approval idea in a Jenkinsfile so the pattern is easy to recognize outside GitHub Actions. The example pauses before production deployment.

```groovy
pipeline {
  agent any

  stages {
    stage('Build and test') {
      steps {
        sh 'npm ci'
        sh 'npm test'
      }
    }

    stage('Production approval') {
      steps {
        input message: 'Deploy checkout-api to production?',
              submitter: 'release-managers,checkout-oncall'
      }
    }

    stage('Deploy production') {
      steps {
        sh './scripts/deploy.sh production "$GIT_COMMIT"'
      }
    }
  }
}
```

The same security questions still apply. Who can approve? Which branch can run this production job? Which secrets are available at this stage? Which scan results block the deploy? Which record shows the approval and the deployed commit? The tool changes, but the control design stays connected to those questions.

## Putting It All Together
<!-- section-summary: A strong release path combines branch rules, review ownership, required checks, environment approvals, scoped secrets, and records. -->

Now we can describe Summit Retail's `checkout-api` release path from the first commit to production. A developer opens a pull request against `main`. CODEOWNERS routes payment, deployment, dependency, and infrastructure changes to the right teams. Branch rules require two approvals, require the CODEOWNERS approval, dismiss stale approvals after new commits, and require all review conversations to be resolved.

GitHub Actions runs the CI and security jobs with unique names. The branch rule requires `ci / unit tests`, `ci / container build`, `security / dependency review`, `security / codeql`, and `security / container scan`. The workflow also runs on merge queue events, so a busy day of approved PRs still tests the combined result before `main` moves.

After merge, the staging environment deploys quickly with staging secrets. Production uses a named environment with required reviewers, a wait timer, deployment branch policies, and production-only secrets. The production job runs with a concurrency group, so release attempts run one at a time. The approval event, workflow run, deployment status, and release summary form the release record.

When an emergency happens, Summit Retail has a break-glass path with a small bypass group and required evidence. The bypass record names the incident, commit, skipped gate, approver, operator, rollback plan, and follow-up deadline. The team reviews that evidence after the incident and restores the normal path.

The main lesson is that pipeline security is a chain of small controls. Runner isolation protects the machine running code. Token boundaries limit what the job can do. Branch protections control what code can land. Environment gates control what can deploy. Release records let people prove what happened after the fact.

![Release control summary showing branch rules, environment gates, and release records connected through reviews, checks, required reviewers, wait timers, commits, approvals, and rollback](/content-assets/articles/article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates/release-control-summary.png)

*Branch rules, environment gates, and release records work best when they describe the same production path instead of living as separate settings nobody reviews together.*

## What's Next
<!-- section-summary: The next article looks at third-party actions and plugin risk inside the same protected delivery path. -->

Summit Retail now has a controlled path from pull request to production. The next risk lives inside the workflow itself: the third-party actions, reusable workflows, plugins, install scripts, and scanner integrations that run during CI/CD.

The next article looks at third-party actions and plugin risk. We will keep using the `checkout-api` pipeline and ask what happens when a trusted-looking action can read the workspace, receive job permissions, influence artifacts, or change what the release path actually proves.

---

**References**

- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - Explains branch protection rules, required pull requests, required checks, force push restrictions, and branch rule behavior.
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) - Documents repository and organization rulesets, enforcement modes, bypass controls, and layered rules.
- [GitHub available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) - Lists rules for required reviews, required status checks, merge queue, code scanning, commit rules, and branch or tag restrictions.
- [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - Defines CODEOWNERS files, ownership matching, review requests, and branch protection integration.
- [GitHub deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) - Documents environments, environment secrets and variables, protection rules, deployment branches and tags, and environment URLs.
- [GitHub reviewing deployments](https://docs.github.com/actions/managing-workflow-runs/reviewing-deployments) - Explains approving, rejecting, and bypassing deployment protection rules for pending workflow jobs.
- [GitHub workflow concurrency](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs) - Documents concurrency groups and cancel-in-progress behavior for workflows and jobs.
- [GitLab protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/) - Documents protected branches, allowed push and merge permissions, force push controls, and branch deletion behavior.
- [GitLab protected environments](https://docs.gitlab.com/ci/environments/protected_environments/) - Explains limiting deployment access to protected environments and using deployment approvals.
- [Jenkins Pipeline input step](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/) - Documents the `input` step used to pause a Pipeline for human approval.

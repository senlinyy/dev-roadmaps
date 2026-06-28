---
title: "Protected Branches and Environment Gates"
description: "Use branch rules, CODEOWNERS, required checks, merge queue, deployment environments, approvals, scan gates, and release records to control what reaches production."
overview: "Start with one checkout-api change trying to reach production, then add protected branches, rulesets, CODEOWNERS, required checks, merge queue, environments, approvals, security scan gates, release records, and emergency bypass evidence."
tags: ["devsecops", "branch-protection", "deployment-gates", "approvals"]
order: 3
id: article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates
---

## Table of Contents

1. [One Change Trying to Reach Production](#one-change-trying-to-reach-production)
2. [The First Gate: Protected Branches and Rulesets](#the-first-gate-protected-branches-and-rulesets)
3. [CODEOWNERS and Review Ownership](#codeowners-and-review-ownership)
4. [Required Checks with Stable Names](#required-checks-with-stable-names)
5. [Merge Queue for Busy Branches](#merge-queue-for-busy-branches)
6. [Deployment Environments](#deployment-environments)
7. [GitHub Actions Gates in Practice](#github-actions-gates-in-practice)
8. [Security Scan Gates](#security-scan-gates)
9. [Release Records](#release-records)
10. [Break-Glass Bypass Evidence](#break-glass-bypass-evidence)
11. [GitLab and Jenkins Context](#gitlab-and-jenkins-context)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)
14. [References](#references)

## One Change Trying to Reach Production
<!-- section-summary: A production release starts as one change, and every gate should help the team decide whether that change may move forward. -->

Imagine one envelope moving across a desk. At the first desk, a teammate checks the form. At the second desk, a specialist signs the payment section. At the third desk, the system stamps the envelope after automated checks pass. At the last desk, the release manager opens the production door.

A production change moves in a similar way. A developer opens a pull request. Reviewers approve it. CI jobs report results. The change lands on `main`. A deployment job asks to enter `staging` or `production`. The environment gate releases secrets and identity only after the rule is satisfied.

Summit Retail's `checkout-api` handles customer checkout. A small change to coupon validation can still affect payment flow, order totals, and support tickets. The team already worked on runner trust and token boundaries. Now they need controls over **which changes can merge** and **which workflow runs can deploy**.

Here is the path we will build:

| Step | Control | Summit Retail target |
|---|---|---|
| Pull request opened | Branch rule and CODEOWNERS | Sensitive paths reach the right reviewers |
| CI runs | Required checks | Tests, build, dependency review, and code scanning report a result |
| Approved PR waits | Merge queue | The queued merge result passes before `main` moves |
| Staging deploys | Staging environment | Fast feedback from reviewed code |
| Production deploys | Production environment | Required reviewers, branch policy, wait timer, scoped secrets |
| Emergency release | Bypass evidence | Incident ID, approver, operator, skipped gate, rollback plan |

![Protected delivery path showing pull request, CODEOWNERS review, required checks, merge queue, staging, and production gate for checkout-api](/content-assets/articles/article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates/protected-delivery-path.png)

*The protected delivery path shows one connected route, from pull request review through production approval.*

We will start at the source branch because every later gate depends on what the repository accepted.

## The First Gate: Protected Branches and Rulesets
<!-- section-summary: Protected branches and rulesets define who can change important branches and which evidence must exist before the update is accepted. -->

A **branch** is a named line of work in Git. Teams usually use `main` as the branch that represents releasable code. A **protected branch** adds rules so the platform blocks risky updates, such as direct pushes, force pushes, branch deletion, or merges without required review and checks.

Summit protects `main` because production deploys come from that branch. A direct push to `main` would skip the review trail. A force push could rewrite release history. A merge with failing checks could let a broken service reach staging or production.

GitHub has two related policy features:

| Feature | Practical use |
|---|---|
| Branch protection rule | Repository-level rule for a branch pattern such as `main` |
| Ruleset | Repository or organization policy that can target branches and tags, layer with other rulesets, and run in evaluate or active mode |

Branch protection rules are common and familiar. Rulesets help organizations create a baseline across repositories, then allow sensitive repositories such as `checkout-api` to add stricter rules. GitHub documents one important branch-rule detail: only one branch protection rule applies to a branch at a time. Rulesets can layer, so teams often use them for broader policy once they are ready.

Summit's production branch policy reads like this before anyone clicks through settings:

| Rule for `main` | Production reason |
|---|---|
| Require a pull request | Every production candidate has a review record |
| Require two approvals | One author cannot ship alone |
| Require CODEOWNERS review | Payment, workflow, and infrastructure changes reach specialist owners |
| Dismiss stale approvals | Approval follows the latest commit |
| Require status checks | CI and security evidence exist before merge |
| Require conversation resolution | Review feedback gets handled before merge |
| Block force pushes and deletions | Release history stays traceable |
| Include administrators or require bypass records | Admin changes leave evidence |

Behind the scenes, GitHub checks the proposed update before it accepts it. It looks at the active rule or rulesets, the pull request state, required reviews, required checks, and bypass permissions. If the update does not satisfy the rule, the branch does not move.

The branch gate says a change needs review. The next question is which reviewers should see which files.

## CODEOWNERS and Review Ownership
<!-- section-summary: CODEOWNERS maps sensitive repository paths to responsible teams so required review reaches people who understand the risk. -->

**CODEOWNERS** is a file that maps repository paths to users or teams. When a pull request changes a matching path, GitHub can request those owners for review. When branch protection requires CODEOWNERS review, at least one owner for the changed path must approve before the PR can merge.

Summit uses `.github/CODEOWNERS` for `checkout-api`. The file has a default owner and stricter owners for payment code, deployment workflows, infrastructure, dependency manifests, and container build files:

```gitignore
* @summit-retail/checkout-platform

/src/payments/ @summit-retail/payments @summit-retail/appsec
/src/fraud/ @summit-retail/fraud @summit-retail/appsec

/.github/workflows/ @summit-retail/platform-security
/infra/ @summit-retail/platform @summit-retail/platform-security

/Dockerfile @summit-retail/platform-security
/package.json @summit-retail/checkout-platform @summit-retail/appsec
/package-lock.json @summit-retail/checkout-platform @summit-retail/appsec
```

The first line gives every file a default service owner. The payment and fraud paths add the teams that understand financial and abuse risk. Workflow and infrastructure paths route to platform security because those files can change runner selection, token permissions, environments, deployment scripts, and cloud access. Dependency and container files route to teams that review supply-chain and runtime risk.

Large ownership groups weaken the signal. A team like `@summit-retail/all-engineers` may satisfy a technical requirement while giving little assurance. A smaller team such as `@summit-retail/platform-security` tells reviewers and incident responders who accepted the release-path risk.

Stale approvals deserve special care. A reviewer can approve a safe version of a PR, then a new commit can change `.github/workflows/deploy.yml`. Summit enables stale approval dismissal so the approval follows the version that actually merges.

Ownership answers who approved the change. Automated checks answer what the machines proved about the change.

## Required Checks with Stable Names
<!-- section-summary: Required checks turn CI job results into merge gates, and stable unique names keep the gate tied to the intended job. -->

A **status check** is a pass, fail, skipped, neutral, pending, or cancelled result attached to a commit. In GitHub Actions, each workflow job can create a check result. A **required check** is a result that must reach an accepted state before the protected branch can update.

Summit starts with a small pull request workflow:

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  unit_tests:
    name: ci / unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test -- --runInBand
```

`ci / unit tests` is the display name Summit selects as a required check. `npm ci` installs dependencies from the lockfile. `npm test -- --runInBand` runs the test suite in one process. The branch rule can now block merges when this job fails.

Now add build and security evidence:

```yaml
  build_container:
    name: ci / container build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build --pull --tag checkout-api:${{ github.sha }} .

  dependency_review:
    name: security / dependency review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high

  codeql:
    name: security / codeql
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/autobuild@v3
      - uses: github/codeql-action/analyze@v3
```

`docker build --pull` asks Docker to pull the newest base image tag allowed by the Dockerfile before building. The dependency review action checks dependency changes in the pull request and fails for high-severity findings. CodeQL initializes analysis, builds the project where needed, and uploads code scanning results.

The required check list now has clear names:

| Required check | Evidence |
|---|---|
| `ci / unit tests` | Service tests passed |
| `ci / container build` | Container build succeeded |
| `security / dependency review` | Dependency changes stayed inside policy |
| `security / codeql` | Static analysis completed |

GitHub recommends unique job names because required checks use names. If two workflows both publish a check named `build`, reviewers and rules can become confused. Summit prefixes names with `ci /`, `security /`, and `deploy /` so the gate points at the intended job.

Required checks should run where the gate needs them. Pull request gates need `pull_request` checks. A busy protected branch also needs a way to test the final combined merge result.

## Merge Queue for Busy Branches
<!-- section-summary: A merge queue tests the actual combined result before approved pull requests land on a protected branch. -->

A **merge queue** is a controlled line for approved pull requests. GitHub creates a temporary merge group, runs required checks on the combined result, and merges only after those checks pass.

Summit feels this during holiday traffic. One PR updates tax calculation, another updates payment retry behavior, and another changes the deployment workflow. Each PR passes by itself. The final combined result can still fail. A merge queue tests the queued merge result before `main` moves.

The workflow needs a `merge_group` trigger so required checks run for merge queue commits:

```yaml
name: checkout-api pull request

on:
  pull_request:
    branches:
      - main
  merge_group:
    branches:
      - main
```

The `pull_request` trigger runs checks on ordinary pull requests. The `merge_group` trigger runs the same checks on the temporary merge-group commit created by the queue. Without `merge_group`, the queue may wait for checks that never report.

Summit's merge queue settings are simple:

| Setting | Summit choice |
|---|---|
| Target branch | `main` |
| Pull request required | Enabled |
| Required checks | Same CI and security checks as pull requests |
| Merge queue | Enabled for `main` |
| Workflow trigger | `pull_request` and `merge_group` |

Smaller repositories may begin with "branch must be up to date before merging." Busy repositories usually move to merge queue when approved PRs frequently collide or when the cost of breaking `main` is high.

Now source is controlled. The next gate controls deployment targets.

## Deployment Environments
<!-- section-summary: Deployment environments separate staging and production so each target can have its own approvers, secrets, wait time, branch policy, and records. -->

A **deployment environment** is a named target such as `staging` or `production`. In GitHub Actions, an environment can have protection rules, secrets, variables, and deployment history. A job references an environment by name, and GitHub applies the environment rules before the job can proceed.

Summit uses two environments for `checkout-api`:

| Environment | Protection | Secrets and identity | Branch policy |
|---|---|---|---|
| `staging` | Fast deploy from reviewed `main` | Staging role and staging variables | `main` |
| `production` | Required reviewers, wait timer, no self-review | Production role and production-only secrets | `main` and `release/*` |

**Required reviewers** are people or teams who must approve a deployment before the job can access the protected environment. Summit uses `@summit-retail/release-managers` and `@summit-retail/checkout-oncall` for production.

**Wait timers** delay a deployment after approval or before the job proceeds, depending on the environment rules. Summit uses a short production wait during business hours so the release manager can catch a late alert, freeze notice, or support escalation before rollout.

**Deployment branch policies** restrict which branches or tags can deploy to an environment. A feature branch can run tests and preview jobs, while the production environment accepts only `main` or `release/*`.

**Environment secrets** are secrets scoped to one environment. The production deploy job can receive production-only values only after it references the `production` environment and the environment rules pass. GitHub withholds those production values from test and staging jobs.

The branch gate and environment gate reinforce each other. Branch protection controls which commits reach `main`. The production environment controls which workflow run can receive production deployment access.

## GitHub Actions Gates in Practice
<!-- section-summary: A deployment workflow can keep staging fast, hold production behind an environment gate, and use concurrency so releases run one at a time. -->

Now turn the policy into a workflow. Summit wants every push to `main` to deploy to staging. Production should run only when a release manager starts the workflow with a release ticket.

Start with the production dispatch shape:

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
```

`push` runs staging after `main` updates. `workflow_dispatch` lets an approved operator start a deployment manually and supply a release or incident ticket. The ticket joins the release record.

Now add staging:

```yaml
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
      - uses: actions/checkout@v4
      - run: docker build --tag registry.example.com/checkout-api:${{ github.sha }} .
      - run: ./scripts/deploy.sh staging "${{ github.sha }}"
```

`id-token: write` allows OIDC federation for deployment identity. `deployments: write` lets the workflow create deployment records. The staging concurrency group cancels older staging runs because the newest `main` commit is usually the one developers want in staging. `docker build` creates the image, and `./scripts/deploy.sh staging` updates the staging service with the current commit.

Production adds the environment gate and a non-cancelling concurrency rule:

```yaml
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
      - uses: actions/checkout@v4
      - name: Validate release ticket
        run: |
          test -n "${{ inputs.release_ticket }}"
          echo "Release ticket: ${{ inputs.release_ticket }}"
      - run: docker build --tag registry.example.com/checkout-api:${{ github.sha }} .
      - run: ./scripts/deploy.sh production "${{ github.sha }}"
```

The production environment pauses the job until required reviewers approve it. `cancel-in-progress: false` prevents a newer production run from cancelling an active production deployment. The `test -n` command checks that the ticket input is present. The `echo` command writes the ticket to the log and workflow summary, where reviewers can connect the run to the release or incident record.

Human approval helps most when automated gates have already produced evidence. That is where scan gates enter.

## Security Scan Gates
<!-- section-summary: Security scan gates turn dependency, code, secret, image, and policy checks into required evidence before merge or deployment. -->

A **security scan gate** is an automated security check that can block a merge or deployment. It may look for vulnerable dependencies, secrets in code, unsafe application patterns, container image vulnerabilities, infrastructure policy violations, or malformed release evidence.

Summit wants scan results before production approval. The release manager should see high-severity dependency, code, and image findings before approving the deployment. The scan should publish a required check or code scanning result before the merge or deploy decision.

![Security gates showing dependency review, code scan, secret scan, and image scan blocking findings before production](/content-assets/articles/article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates/security-gates.png)

*Security gates should produce evidence before a merge or deployment decision, and a real finding should move the change into review.*

Add a container scan with a stable required-check name:

```yaml
  container_scan:
    name: security / container scan
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - run: docker build --tag checkout-api:${{ github.sha }} .
      - uses: aquasecurity/trivy-action@0.30.0
        with:
          image-ref: checkout-api:${{ github.sha }}
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: "1"
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-results.sarif
```

`docker build` creates the image to scan. The Trivy action scans that image and writes SARIF output. `severity: CRITICAL,HIGH` selects the severities Summit wants to block. `exit-code: "1"` makes matching findings fail the job. The SARIF upload sends the result to GitHub code scanning even when the scan job fails.

In a high-trust release workflow, Summit pins third-party actions to reviewed commit SHAs. This article keeps versions readable while showing the gate behavior; the next article covers action pinning and third-party action review.

Security findings sometimes need exceptions. The exception path should create evidence instead of silently skipping the gate.

## Release Records
<!-- section-summary: Release records connect commits, checks, approvals, deployment status, artifact digests, and rollback targets into one trail. -->

A **release record** is the evidence package for a shipped change. It tells responders what changed, who approved it, which checks passed, what artifact deployed, and how to roll back. Auditors like release records, and engineers use them during incidents because they reduce searching.

Summit's production release record includes:

| Field | Example |
|---|---|
| Service | `checkout-api` |
| Environment | `production` |
| Release ticket | `CHG-10422` |
| Pull request | `https://github.com/summit-retail/checkout-api/pull/1842` |
| Commit | `8f31c2b9a8e0f1b72d4f6b3e9c901d6b8a12f0e7` |
| Image digest | `registry.example.com/checkout-api@sha256:91ab...` |
| Required checks | Unit tests, build, dependency review, CodeQL, container scan |
| Environment approval | Release manager and checkout on-call |
| Rollback target | Previous image digest |
| Post-deploy checks | Error rate, payment latency, alert status |

The production job can write a summary into GitHub:

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

Each `echo` command writes one line of the release summary. `$GITHUB_STEP_SUMMARY` is the GitHub Actions file path that stores the job summary shown in the workflow run. `if: always()` writes the summary even when the deploy step fails, which helps responders inspect failed release attempts.

The release record complements the formal change ticket if the organization requires one. The GitHub environment approval, workflow run, deployment record, and summary should all point to the same commit and artifact digest.

Now we can handle the emergency path.

## Break-Glass Bypass Evidence
<!-- section-summary: Emergency bypass can exist, but it needs narrow access and strong evidence so the team can review exactly what happened. -->

**Break-glass** means an emergency path that lets trusted people bypass a normal control during a serious incident. In delivery systems, it can mean bypassing a ruleset, approving an environment deployment during an incident, or using admin access to ship a hotfix while a noncritical gate is unavailable.

Summit needs a break-glass path because checkout incidents can be expensive. If customers cannot complete payment, the release manager may need to ship a rollback or hotfix while a scanner service is down. The risk is that bypass can hide a dangerous release, so the path stays narrow and evidence-heavy.

A useful break-glass record includes:

| Evidence | Example |
|---|---|
| Incident or change ticket | `INC-4821 checkout payment failures` |
| Repository and branch | `summit-retail/checkout-api`, `main` |
| Commit SHA | `8f31c2b9...` |
| Gate bypassed | `security / container scan unavailable` |
| Customer impact | `Payment authorization failures affecting 18% of checkouts` |
| Approver | `@sam-release-manager` |
| Operator | `@riley-oncall` |
| Rollback plan | `Redeploy previous digest sha256:91ab...` |
| Follow-up deadline | `2026-06-22 12:00 UTC` |

GitHub rulesets can define bypass actors. Environment protection rules can allow or restrict admin bypass depending on the environment configuration. Deployment approvals and workflow logs show the commit, environment, inputs, and approver trail.

Summit avoids hidden bypass flags such as `skip_security=true` in normal release workflows. If an exception is needed, it should appear in the incident record, environment approval, workflow input, or change ticket, and the post-incident review should verify the follow-up.

GitHub gives the main examples here, and the same release-path design appears in GitLab and Jenkins.

## GitLab and Jenkins Context
<!-- section-summary: GitLab and Jenkins use different names, while the same pattern still controls branches, approvals, secrets, and deployment evidence. -->

GitLab has **protected branches** for controlling who can push, merge, force push, or delete important branches. It also has **protected environments** for limiting who can deploy to targets such as production. GitLab merge request approvals, approval rules, CODEOWNERS, deployment approvals, and environment-scoped variables all support the same delivery path.

Jenkins often handles the approval point inside a Pipeline with an `input` step. Jenkins still needs source control branch protection because the repository should control what reaches `main`. The Jenkins approval handles the production moment, while repository rules handle the source branch.

Here is a small Jenkins example:

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

`sh 'npm ci'` installs dependencies from the lockfile. `sh 'npm test'` runs the test script. The `input` step pauses the Pipeline until an allowed submitter approves. The final `sh` command runs Summit's deployment script with the production target and the Git commit Jenkins is building.

The same review questions apply across tools. Who can approve? Which branch can run this production job? Which secrets are available? Which scan results block the deploy? Which record shows the approval, commit, artifact, and rollback target?

## Putting It All Together
<!-- section-summary: A strong release path combines branch rules, review ownership, required checks, merge queue, environment approvals, scoped secrets, and records. -->

The complete `checkout-api` path now has connected gates. A developer opens a pull request. CODEOWNERS routes payment, workflow, dependency, and infrastructure changes to the right teams. Branch rules require two approvals, CODEOWNERS approval, stale approval dismissal, conversation resolution, and required checks.

GitHub Actions reports stable check names. The branch rule requires unit tests, container build, dependency review, CodeQL, and container scan. Merge queue tests the final queued result before `main` moves.

After merge, staging deploys quickly with staging identity. Production uses a named environment with required reviewers, wait timer, branch policy, production-only secrets, and non-cancelling concurrency. The workflow run writes a release summary, and the deployment record points to the same commit and artifact digest.

When an emergency release happens, Summit uses a small bypass group and records the incident, gate, approver, operator, commit, rollback target, and follow-up deadline. That evidence lets the team review the exception after the customer incident is stable.

![Release control summary showing branch rules, environment gates, and release records connected through reviews, checks, required reviewers, wait timers, commits, approvals, and rollback](/content-assets/articles/article-devsecops-pipeline-and-runner-security-protected-branches-environment-gates/release-control-summary.png)

*Branch rules, environment gates, and release records work best when they describe the same production path.*

Runner isolation controls where jobs run. Token boundaries control what jobs can access. Branch protections control what code can land. Environment gates control what can deploy. Release records give the team proof of what happened.

## What's Next

Summit now has a controlled path from pull request to production. The next risk lives inside the workflow itself: third-party actions, reusable workflows, Jenkins plugins, shared libraries, install scripts, and uploaders. The next article treats workflow code as code that runs on the runner and can share the job's access.

## References

- [GitHub: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - GitHub documentation for branch protection rules, required pull requests, required checks, force push restrictions, and branch rule behavior.
- [GitHub: About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) - GitHub documentation for repository and organization rulesets, enforcement modes, bypass controls, and layered rules.
- [GitHub: Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) - Lists rules for reviews, status checks, merge queue, code scanning, commit rules, and branch or tag restrictions.
- [GitHub: About CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - Defines CODEOWNERS files, ownership matching, review requests, and branch protection integration.
- [GitHub Actions: Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) - Documents environments, environment secrets and variables, protection rules, deployment branches and tags, and environment URLs.
- [GitHub Actions: Reviewing deployments](https://docs.github.com/actions/managing-workflow-runs/reviewing-deployments) - Explains approving, rejecting, and bypassing deployment protection rules for pending jobs.
- [GitHub Actions: Control workflow concurrency](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs) - Documents concurrency groups and cancel-in-progress behavior.
- [GitLab: Protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/) - GitLab documentation for protected branches, allowed push and merge permissions, force push controls, and branch deletion behavior.
- [GitLab: Protected environments](https://docs.gitlab.com/ci/environments/protected_environments/) - GitLab documentation for limiting deployment access to protected environments and using deployment approvals.
- [GitLab: Code Owners](https://docs.gitlab.com/user/project/codeowners/) - GitLab documentation for CODEOWNERS and approval integration.
- [Jenkins Pipeline input step](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/) - Jenkins documentation for pausing a Pipeline for human approval.
- [OWASP CI/CD Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html) - OWASP CI/CD guidance for protecting source, build, and deployment pipelines.

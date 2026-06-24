---
title: "Continuous Integration"
description: "Learn how Continuous Integration keeps code changes small, tested, and ready to merge through mainline work, pull request checks, clean runners, and practical test design."
overview: "Continuous Integration is the daily validation loop that catches integration problems while the change is still small. This article follows one checkout API change through branches, pull requests, workflow YAML, test layers, clean runners, and failure diagnosis."
tags: ["integration", "testing", "workflows", "feature-flags"]
order: 1
id: article-cicd-fundamentals-continuous-integration
aliases:
  - continuous-integration
  - article-cicd-fundamentals-continuous-integration
  - cicd/fundamentals/continuous-integration.md
---

## Table of Contents

1. [The CI Loop](#the-ci-loop)
2. [The Shared Mainline](#the-shared-mainline)
3. [Pull Requests and Required Checks](#pull-requests-and-required-checks)
4. [What a CI Workflow Actually Runs](#what-a-ci-workflow-actually-runs)
5. [A Practical GitHub Actions CI File](#a-practical-github-actions-ci-file)
6. [What CI Should Test](#what-ci-should-test)
7. [Clean Runners and Locked Dependencies](#clean-runners-and-locked-dependencies)
8. [Failure Mode: The Build Breaks After Merge](#failure-mode-the-build-breaks-after-merge)
9. [Failure Mode: The Test Flakes](#failure-mode-the-test-flakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The CI Loop
<!-- section-summary: Continuous Integration turns every small code change into a repeatable build and test signal before the change joins shared work. -->

Continuous Integration, usually shortened to **CI**, means developers integrate their code into a shared codebase frequently, and an automated build checks each integration. The important part is the rhythm. A developer changes a small piece of code, pushes it, the CI system builds and tests it, and the team gets a clear signal while the change still fits in one person's head.

Imagine a small product team working on `checkout-api`, a Node.js service that calculates carts, validates discounts, and creates payment requests. Lina changes tax calculation, Marco changes discount rules, and Priya changes a database migration for payment records. Each change looks harmless on its own, yet the real question is whether those changes still work together inside the same application.

CI gives the team a shared answer to that question. Every proposed change runs through the same validation path: install dependencies, lint the code, run unit tests, run integration tests, and build the application. If the path passes, the change has evidence behind it. If the path fails, the developer has a small, recent change to inspect instead of a week of mixed work from three people.

This article follows that checkout example through the main CI concepts. We will cover the **mainline**, small branches, pull request checks, workflow files, runners, test layers, dependency locks, and two common failure modes. Those pieces connect together as one feedback loop that starts with a small code change and ends with a clear merge decision.

## The Shared Mainline
<!-- section-summary: CI needs one shared branch that represents the latest healthy work, so developers integrate against the same target often. -->

The **mainline** is the shared branch that represents the current accepted state of the project. Many teams call it `main`, some call it `trunk`, and older repositories may call it `master`. The name matters less than the rule behind it: everyone integrates with the same branch often, and the team treats that branch as the source of truth.

In the checkout example, `main` contains the current production-ready code. Lina creates a branch called `lina/tax-rounding`, changes a few files, and opens a pull request back to `main`. Marco does the same for `marco/discount-cap`, and Priya does the same for `priya/payment-migration`.

Short-lived branches work well with CI because the branch stays close to `main`. Lina can finish her rounding fix in one day, run the checks, review the result, and merge. If she keeps that branch open for three weeks, `main` keeps changing underneath her. Marco may edit the same cart module, Priya may change the schema, and Lina discovers the real integration problem only after many unrelated changes have piled up.

Some teams go further and use **trunk-based development**. In that style, developers integrate tiny changes into the mainline many times a day. Work that will take longer than a day can still be integrated behind a **feature flag**, which is a runtime switch that controls whether users see the new behavior. In `checkout-api`, the discount change could use a flag like this while the team finishes the rollout plan:

```javascript
export function calculateDiscount(cart, flags) {
  if (flags.percentageDiscountCap) {
    return calculateDiscountWithCap(cart);
  }

  return calculateLegacyDiscount(cart);
}
```

The new discount code can live in the shared codebase while `percentageDiscountCap` stays off for customers. CI still builds and tests the new code path, so the team learns about broken imports, type errors, or schema conflicts early. The feature flag has a cost because the team must test both paths and remove the flag after rollout, so teams use it deliberately for work that needs to integrate before it is ready for users.

## Pull Requests and Required Checks
<!-- section-summary: Pull requests give humans a review surface, and required checks give the repository a machine-enforced merge rule. -->

A **pull request**, often shortened to **PR**, is a proposed change from one branch into another branch. It gives reviewers a place to inspect the diff, discuss the design, and see the automated status of the change. In a CI workflow, the PR is the meeting point between human review and machine validation.

When Lina opens `lina/tax-rounding`, the repository host sends a workflow event to the CI system. GitHub Actions, GitLab CI, Jenkins, CircleCI, Buildkite, and other systems all follow the same broad shape. A repository event starts a workflow run, the workflow runs jobs on one or more runners, and the result comes back as a status check on the commit.

A **status check** is the pass, fail, pending, or skipped result attached to a commit or pull request. A required status check turns that result into a merge rule. If the repository protects `main` and requires the `ci / validate` check, the merge button stays blocked until that check passes.

That rule changes team behavior in a healthy way. The reviewer no longer has to ask whether Lina remembered to run the test suite locally, because the repository already has a check for it. The reviewer can focus on the code and product behavior, while CI handles repeatable validation.

There is still one important design choice. A required check should represent work that always matters for the protected branch. If a required job can skip because of a path filter or an optional condition, the repository may show a green result even though the important validation did not run. Teams usually keep the required check simple and reliable, then add optional specialist checks around it.

## What a CI Workflow Actually Runs
<!-- section-summary: A workflow turns repository events into jobs, and each job runs ordered steps on a fresh runner. -->

A **workflow** is the automation recipe stored in the repository. In GitHub Actions, workflow files live under `.github/workflows/` and use YAML. The workflow describes which events should start a run, which jobs should run, which runner image each job needs, and which steps run inside each job.

A **job** is a group of steps that run on the same runner. A **runner** is the machine or container environment that executes the job. A **step** is one action or shell command inside that job, such as checking out the repository, installing Node.js, installing dependencies, or running `npm test`.

The checkout team can think about a workflow run as a fresh rehearsal of the change. The runner starts with an empty workspace, downloads the repository, installs the declared tools, installs the locked dependencies, and runs the same commands every time. That fresh start matters because CI should prove the repository contains everything needed to build the project. The basic path looks like this:

![CI runner loop showing small branch, pull request event, fresh runner, dependency install, validation, and required check result](/content-assets/articles/article-cicd-fundamentals-continuous-integration/ci-runner-loop.png)

*A CI run turns one small branch into a fresh-runner validation path, then sends either a merge signal or a repair signal back to the developer.*

The CI system needs a reproducible recipe for validation. The application-specific details live in repository scripts, workflow files, and test commands. If the team can explain the recipe in those files, the runner can repeat it for every proposed change.

## A Practical GitHub Actions CI File
<!-- section-summary: A useful CI file starts small: trigger on pull requests, run one validation job, install locked dependencies, and execute the same scripts developers use locally. -->

For a Node.js service like `checkout-api`, a first CI workflow can stay compact. It should run when a pull request targets `main`, use a Linux runner, check out the repository, install the project Node version, install dependencies from the lockfile, then run the normal validation scripts. One practical version keeps all of that inside a single required `validate` job:

```yaml
name: ci

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  validate:
    name: validate
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm test

      - name: Build
        run: npm run build
```

The workflow has a few important details. The `pull_request` trigger runs validation when someone opens or updates a PR targeting `main`. The `permissions` block gives the workflow read access to repository contents and avoids granting broad default permissions. The `validate` job runs on `ubuntu-latest`, which gives the team a hosted Linux runner for the job.

The checkout step matters because the runner starts with an empty workspace. `actions/checkout` places the repository files into that workspace so later commands can see `package.json`, source files, and tests. The setup step reads `.nvmrc`, installs the project Node version, and enables the npm package cache.

The `npm ci` command matters because CI should use the lockfile exactly. If `package.json` and `package-lock.json` disagree, `npm ci` fails instead of silently updating the lockfile. That failure is useful because it tells the developer to fix the dependency record in the pull request.

The scripts at the end should match local development. If developers run `npm run lint`, `npm test`, and `npm run build` on their laptop, CI should run those commands too. This keeps the repository contract simple: the same scripts explain how to validate the project in a clean environment.

## What CI Should Test
<!-- section-summary: CI needs enough tests to catch real integration problems while still returning feedback fast enough for daily work. -->

A useful CI pipeline has tests that answer the right questions quickly. A test suite with only one slow browser test may catch a real bug, yet it gives poor feedback because developers wait too long and the failure gives little detail. A test suite with only tiny unit tests may run fast, yet it can miss the moment where two pieces stop working together.

Most teams use a mix of **unit tests**, **integration tests**, and a small number of **end-to-end tests**. A unit test checks one small piece, such as `calculateDiscountWithCap(cart)`. An integration test checks two or more pieces together, such as the discount service writing the correct final total into the order repository. An end-to-end test checks a user-sized path, such as adding an item to a cart, applying a discount, and reaching the payment handoff. For `checkout-api`, the team might shape the CI test mix like this:

| Test layer | Checkout example | Why it belongs in CI |
|---|---|---|
| **Unit tests** | Tax rounding, discount caps, validation helpers | They run fast and point to a small piece of code. |
| **Integration tests** | API handler plus database migration in a test database | They catch wiring problems between modules and data shape. |
| **End-to-end smoke tests** | One happy checkout path against a temporary app instance | They prove the critical user path still connects. |

That mix gives the team useful coverage without turning every pull request into a long release rehearsal. The lower layers catch most mistakes quickly. The higher layer protects the most important business path with a small number of carefully maintained checks.

![CI test signal mix showing unit tests, integration tests, smoke tests, quality checks, and the merge signal they create](/content-assets/articles/article-cicd-fundamentals-continuous-integration/ci-test-signal-mix.png)

*A practical CI suite combines fast logic checks, integration wiring checks, a small smoke path, and basic quality gates into one merge signal.*

CI should also include checks that protect the codebase shape. Linting catches style and correctness rules that tools can detect. Type checking catches mismatched function calls before runtime. A build step proves the application can compile or bundle with the production settings.

The team should decide which checks block merge and which checks only report extra information. For example, lint, unit tests, and build might block every pull request. A long nightly browser suite can run on a schedule and create a ticket when it fails, because the team accepts that it gives slower feedback than the core CI check.

## Clean Runners and Locked Dependencies
<!-- section-summary: CI should run on a fresh environment with locked dependencies, so the result comes from the repository instead of one developer's machine. -->

A **clean runner** is a fresh execution environment for a job. It may be a hosted virtual machine, a container, or a self-hosted machine that the CI system prepares before each job. The goal is the same: the job should prove the repository can build from a clean start.

This is where many first CI failures feel confusing. Lina's tests pass locally because her laptop still has an old package inside `node_modules`. The CI runner starts fresh, runs `npm ci`, and fails because the lockfile never included that package. CI did the right thing because the repository is missing part of the dependency contract.

The fix belongs in the pull request. Lina updates `package.json`, runs the package manager locally so `package-lock.json` changes too, and commits both files. The next CI run installs from the lockfile and the missing package problem disappears.

Caching can speed this up, but caching has to support reproducibility instead of replacing it. In the workflow above, `actions/setup-node` caches npm package data based on the lockfile. Each job still creates `node_modules` from a clean install while avoiding repeated downloads when the dependency set stays the same.

Clean runners also catch missing environment setup. If `checkout-api` needs `DATABASE_URL` for integration tests, the workflow should create a test database or service container and pass a test-only value. If the build needs generated code, the workflow should run the generator. CI should document those setup steps through automation instead of depending on someone remembering them.

## Failure Mode: The Build Breaks After Merge
<!-- section-summary: A pull request can pass against an older target branch, so busy teams need up-to-date checks or a merge queue. -->

The first common CI surprise happens when two pull requests pass separately and still break `main` after both merge. Lina's tax rounding PR passes. Marco's discount cap PR also passes. Lina merges first, then Marco merges a PR that still tested against the older version of `main`, and now the combined cart behavior fails.

This problem comes from timing. Each PR had a green result for the code it tested, but Marco's final merge combined his branch with Lina's newer change. If the protected branch allows merges without a fresh up-to-date check, the repository may merge a combined state that skipped final CI validation.

Teams usually handle this in one of two ways. The first option is requiring pull request branches to be up to date with `main` before merging. Marco updates his branch after Lina merges, CI runs again against the newer target, and the conflict appears before merge.

The second option is a **merge queue**. A merge queue takes approved pull requests, builds a temporary combined result in order, runs the required checks, and merges only after the queued result passes. This works well for busy repositories because developers do not have to keep clicking update on their branches all day.

The checkout team can choose based on volume. A small team may be fine with up-to-date branches. A larger team with many pull requests per hour often gets a smoother path from a merge queue, because the queue serializes the final validation for the protected branch.

## Failure Mode: The Test Flakes
<!-- section-summary: A flaky test sometimes passes and sometimes fails on the same code, so the team must treat it as a broken signal. -->

A **flaky test** gives different results for the same code. It may fail because it depends on wall-clock timing, shared test data, network order, or a browser wait that guesses instead of observing a real condition. The worst part is the trust damage. Developers start rerunning the job until it passes, and then a real failure looks like more background noise.

In `checkout-api`, imagine an integration test that creates an order, waits one second, and expects a background worker to mark the order as `ready_for_payment`. On a quiet runner, the worker finishes in time. On a busy runner, the worker finishes after the assertion, and the test fails even though the code stayed the same.

The fix should make the test observe the system behavior directly. The test can poll the order status with a short timeout, or the code can expose a test helper that waits for the worker queue to drain. The important point is that the test waits for a real condition instead of sleeping for a guessed number of milliseconds.

When a flaky test blocks everyone, the team can quarantine it for a short time, but quarantine needs ownership. A healthy quarantine record says which test moved, why it moved, who owns the fix, and when the team will bring it back into the required check. A flaky test that stays outside CI forever turns into an untested production risk with a label on it.

The CI rule stays simple. A red required check deserves attention. If the team cannot trust that sentence, the team has to fix the signal before adding more tests.

## Putting It All Together
<!-- section-summary: CI works as one loop: small changes enter a shared target, clean automation checks them, and trustworthy results guide merge decisions. -->

Now the checkout team has a complete CI path. Developers keep changes small, aim them at the shared mainline, and use pull requests for review. The repository starts a workflow on each pull request, the runner builds from a clean workspace, and required checks decide whether the change can merge. The full loop connects those pieces like this:

![Continuous Integration summary showing main branch, small change, pull request, clean runner, required checks, merge, and fix loop](/content-assets/articles/article-cicd-fundamentals-continuous-integration/ci-summary.png)

*The full CI loop keeps work close to the main branch, validates it in automation, and routes failures back into a small repair cycle.*

The value comes from the connection between the pieces. Small branches keep failures understandable. Pull requests give humans a review surface. Required checks make validation consistent. Clean runners prove the repository can build without hidden local state. A balanced test mix catches real problems while feedback is still fast enough for daily work.

CI also creates a clean boundary for the next delivery stages. After `checkout-api` passes CI, the team has a validated commit. That commit can produce an artifact, such as a container image or package, and later delivery workflows can promote that artifact through environments.

The important habit is treating CI as the first shared production signal. A green CI run says the code integrated successfully under the repository's current rules. Product review, production health, and deployment safety still need their own checks later in the delivery system.

## What's Next
<!-- section-summary: The next step is understanding how pipeline jobs, runners, and artifacts carry a validated commit toward delivery. -->

You now have the core CI loop: small changes, shared mainline, pull request checks, workflow jobs, clean runners, locked dependencies, and useful tests. That is the foundation underneath the rest of CI/CD.

The next topic goes one layer deeper into pipeline structure. Once a change passes CI, teams need to understand jobs, runners, artifacts, caches, and how one validated commit turns into a build output that later deployment steps can trust.

---

**References**

- [Continuous Integration by Martin Fowler](https://www.martinfowler.com/articles/continuousIntegration.html) - Defines CI as frequent integration into a shared codebase verified by automated builds and tests.
- [Understanding GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions) - Explains workflows, events, jobs, runners, and steps in GitHub Actions.
- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Documents the YAML structure used to define workflow triggers, jobs, and steps.
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) - Documents `pull_request` behavior and how GitHub checks the merge result for pull request workflows.
- [About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks) - Explains status checks, check results, and required checks for protected branches.
- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - Covers required reviews, required status checks, merge queues, and branch protection behavior.
- [npm ci](https://docs.npmjs.com/cli/v9/commands/npm-ci/) - Documents clean installs, lockfile requirements, and why `npm ci` fits automated environments.
- [actions/setup-node](https://github.com/actions/setup-node) - Documents Node.js setup, lockfile guidance, and dependency caching behavior in GitHub Actions.
- [Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html) - Explains the testing pyramid shape and the cost of relying too heavily on end-to-end tests.
- [Feature Toggles by Martin Fowler](https://martinfowler.com/articles/feature-toggles.html) - Explains feature flags as a way to change system behavior without changing deployed code.

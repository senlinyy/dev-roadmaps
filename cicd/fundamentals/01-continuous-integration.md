---
title: "Continuous Integration"
description: "Learn how Continuous Integration protects a shared mainline through small changes, reproducible builds, automated checks, and fast feedback."
overview: "Continuous Integration is an automated feedback loop for answering whether a proposed change still works when combined with everyone else's work. This article builds that model from first principles, then connects it to branches, pull requests, clean runners, locked dependencies, test layers, and required checks."
tags: ["integration", "testing", "workflows", "feature-flags"]
order: 1
id: article-cicd-fundamentals-continuous-integration
aliases:
  - continuous-integration
  - article-cicd-fundamentals-continuous-integration
  - cicd/fundamentals/continuous-integration.md
---

## Table of Contents

1. [Why Does Continuous Integration Exist?](#why-does-continuous-integration-exist)
2. [Why Must Integration Be Frequent?](#why-must-integration-be-frequent)
3. [How Do the Mainline, Branches, and Pull Requests Fit Together?](#how-do-the-mainline-branches-and-pull-requests-fit-together)
4. [How Do Required Checks Protect the Shared Mainline?](#how-do-required-checks-protect-the-shared-mainline)
5. [What Does a CI Runner Actually Do?](#what-does-a-ci-runner-actually-do)
6. [Why Do Clean Runners and Locked Dependencies Matter?](#why-do-clean-runners-and-locked-dependencies-matter)
7. [Which Checks Should a CI Pipeline Run?](#which-checks-should-a-ci-pipeline-run)
8. [How Does the Complete CI Feedback Loop Work?](#how-does-the-complete-ci-feedback-loop-work)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

**Continuous Integration**, usually shortened to **CI**, is a system for repeatedly answering one practical question: if this change joins everyone else's changes, does the combined software still work?

That question begins with a difference between local and integrated behavior. Imagine Alice changes authentication, Bob renames a database field, and Carol changes an API response. Each developer tests alone and sees a passing result. Alice's new authentication code now expects `user.id`, while Bob's database layer returns `user.userId`. Both changes can look reasonable in isolation, yet the application fails when they meet.

The problem is the connection between the changes. Local success does not imply that the integrated application succeeds:

```text
Alice's working change
        +
Bob's working change
        +
Carol's working change
        ≠
a working combined application
```

Software teams deliver combined systems, so they need evidence about the combined state. CI creates that evidence automatically after relevant changes. A developer pushes a commit, an automation service detects it, prepares a machine, downloads the repository, installs the declared dependencies, and runs the project's checks. A passing result makes the commit a candidate for integration. A failure sends the developer back to a small, recent change.

Keep these questions in view as you work through the lesson:

1. **Why Does Continuous Integration Exist?**
2. **Why Must Integration Be Frequent?**
3. **How Do the Mainline, Branches, and Pull Requests Fit Together?**
4. **How Do Required Checks Protect the Shared Mainline?**
5. **What Does a CI Runner Actually Do?**
6. **Why Do Clean Runners and Locked Dependencies Matter?**
7. **Which Checks Should a CI Pipeline Run?**
8. **How Does the Complete CI Feedback Loop Work?**

## Why Does Continuous Integration Exist?
<!-- section-summary: Continuous Integration repeatedly checks whether one change still works after it is combined with the team's shared code. -->

The products that run this loop can differ. GitHub Actions, GitLab CI, Jenkins, CircleCI, Buildkite, Azure Pipelines, TeamCity, or a team's own scripts can all implement CI. The durable model underneath each product is the same:

```text
change
  ↓
automatic verification
  ↓
fast, objective feedback
```

The word **objective** matters here. A developer's memory of running a test yesterday is difficult for the rest of the team to inspect. A recorded workflow run gives the proposed commit the same repeatable checks as every other commit. Humans still decide whether the design and business behavior make sense; automation supplies evidence for checks that machines can perform consistently.

CI therefore protects shared software state rather than merely automating a YAML file. Workflow syntax, runners, tests, pull requests, and status checks are mechanisms for maintaining that protection.

## Why Must Integration Be Frequent?
<!-- section-summary: Frequent integration keeps the change batch and failure search space small enough for developers to diagnose quickly. -->

The **continuous** part describes frequency, not a process running every millisecond. Developers integrate often enough that they do not accumulate large, isolated piles of work.

Suppose a team combines its work after three months. Hundreds of changes arrive together, dozens of tests fail, and nobody knows which interaction produced which failure. The team has both a large change batch and a large search space. Every diagnosis may require understanding work that several people completed weeks ago.

Frequent integration changes the economics:

```text
small change → integrate → verify
small change → integrate → verify
small change → integrate → verify
```

If the application passed five minutes ago and fails after one small commit, the newest commit is an obvious place to begin. The code is still fresh in the developer's mind, the affected surface is limited, and reverting or repairing the change is usually inexpensive. Small changes, frequent integration, and quick feedback reinforce one another.

CI is therefore a feedback system. A developer changes the software, automation observes the result through checks, and the pass or fail signal guides the next adjustment. Feedback that arrives in three minutes can shape the current change. Feedback that arrives three weeks later competes with many later changes and a developer who has moved on to other work.

Pipeline speed affects developer behavior. When the essential checks finish in a few minutes, developers are willing to push small commits and respond immediately. When the same checks take several hours, people tend to push larger batches and switch contexts while they wait. Larger batches then create harder failures, which makes integration slower again.

This creates two opposite loops:

```text
fast feedback
    ↓
small corrections
    ↓
small commits
    ↓
easier integration
```

```text
slow feedback
    ↓
large batches
    ↓
large corrections
    ↓
painful integration
```

Change size matters for the same reason. A pull request with 85 changed lines gives a reviewer and a failed test a bounded search area. A pull request with 14,700 changed lines can produce seventeen failures whose causes overlap. CI can run on either change, but its signal is much easier to act on when the proposal is small.

Frequent does not require unfinished behavior to reach users. A team can integrate a partial implementation behind a **feature flag**, a runtime switch that keeps the behavior disabled while its code lives on the shared branch. The team must test both paths and later remove the flag, so flags have a maintenance cost. Used deliberately, they allow small integrations without prematurely releasing the feature.

## How Do the Mainline, Branches, and Pull Requests Fit Together?
<!-- section-summary: The mainline is the shared integration point, branches isolate small changes, and pull requests propose joining those changes to the shared state. -->

CI needs a shared integration point. Most repositories call it `main`; other teams use names such as `trunk`, `master`, or `develop`. The name is less important than the role: the **mainline** represents the team's latest accepted combined state.

Developers converge on that one branch:

```text
Alice's change ─┐
Bob's change   ─┼──→ main
Carol's change ─┘
```

A healthy team maintains a useful invariant: `main` should normally satisfy the team's automated definition of working software. That definition might require compilation, linting, tests, basic security checks, and a successful build. It does not prove that the software contains no bugs. It gives everyone one dependable answer to the question, “Where is the current integrated system?”

A branch gives one change a temporary place to develop without immediately changing that shared state. If `main` works and Alice begins a password-reset feature, she can create `feature/password-reset` and commit there. The branch lets her experiment while `main` continues to serve as the accepted integration point.

The branch should remain short-lived. While Alice works, other commits continue to enter `main`. A branch open for one day stays close to its target. A branch open for several weeks can diverge across source code, schemas, dependencies, and interfaces. CI cannot remove that divergence; frequent integration prevents it from growing.

A **pull request** is an integration proposal: “Combine the commits on this branch with the target branch.” It creates one surface for two different forms of validation.

Humans can assess questions such as:

- Does this behavior match the product requirement?
- Is the design understandable and appropriately simple?
- Are the names, boundaries, and failure behavior sensible?
- Does the change create a maintenance risk the tests cannot express?

Machines can repeat questions such as:

- Does the source parse and compile?
- Do lint, type, and formatting rules pass?
- Do the automated tests still succeed?
- Can the repository produce its expected build output?

Neither replaces the other. A test suite cannot decide whether a confusing design is the best product choice. A reviewer should not manually repeat hundreds of deterministic test cases on every proposal. The pull request combines human judgment with automated evidence before the branch joins the mainline.

## How Do Required Checks Protect the Shared Mainline?
<!-- section-summary: A required check converts a CI result from optional information into an enforced condition for merging. -->

There is a large operational difference between running CI and requiring CI to pass. If a workflow reports failed tests but the repository still permits the merge, the result is only advisory. Developers can ignore the red status, whether by accident or under delivery pressure.

A **required status check** attaches an enforceable rule to the protected branch:

```text
required checks pass  → merge may proceed
required checks fail  → merge remains blocked
```

On GitHub, branch protection rules or rulesets can name the checks that must succeed before a pull request merges. A strict configuration can also require the branch to be brought up to date with the target before the check counts. CI then becomes a constraint on what may enter `main`, rather than a dashboard the team is expected to remember to inspect.

The exact commit being checked matters. Imagine `main` contains commits `A-B-C-D`, while Alice created her branch from `C` and added `X`. A passing run against `C+X` does not answer whether `D+X` works. The intended integrated state is the second combination.

Teams solve that timing problem in two common ways. A repository can require Alice to update her branch from `main`, producing a new check against the latest target. A busy repository can use a **merge queue**, which creates temporary candidate combinations in merge order, checks each combination, and merges only a candidate that passes. Both approaches enforce the deeper rule: test the state the repository is actually about to integrate.

Required checks should be dependable. If a required job is skipped by a path filter or optional condition when its evidence still matters, the branch can appear healthy without performing the intended validation. Teams usually make the core required signal simple and predictable, then place specialist or slower checks around it.

The green-main goal can be expressed compactly. Let `V(x)` mean “the required verification passes for commit `x`.” If `M` is the current main commit, the team wants `V(M)` to remain true. Before accepting a proposed change `C`, it wants evidence that `V(M + C)` is true. The notation is simple, but it captures the core protection CI provides.

Even this rule has a boundary. A green status means the commit passed the checks the team chose. It does not prove the absence of bugs. If the pipeline has no password-reset test, green CI provides little evidence about password reset. Required checks make selected constraints enforceable; the quality and coverage of those constraints still belong to the team.

## What Does a CI Runner Actually Do?
<!-- section-summary: A CI service responds to a repository event by assigning a job to a runner and executing declared steps as ordinary commands. -->

The machinery behind “run CI” is less mysterious than the phrase sounds. A CI service receives an event, assigns work to a machine, and executes commands.

A **workflow** is the repository's automation recipe. A **job** is a group of steps that share one execution environment. A **runner** is the virtual machine, physical machine, container, or hosted environment that performs a job. A **step** invokes an action or a shell command, such as checking out the repository or running `npm test`.

For a Node.js repository, the local validation recipe might be:

```bash
npm ci
npm run lint
npm test
npm run build
```

CI creates another computer and runs that recipe when a relevant event occurs. Exit code `0` normally marks a shell step successful; a non-zero exit code marks it failed and changes the job result.

A small GitHub Actions workflow makes the pieces concrete:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build
```

`name` supplies a readable workflow label. `on` declares the events that start it. Pull request runs answer whether a proposal is ready to merge; the `push` run on `main` confirms the state after integration actually occurs.

The `jobs` map can contain one job or several independent and dependent jobs. `runs-on: ubuntu-latest` requests an Ubuntu runner for `test`. The checkout action makes the repository available because a new runner does not begin with the application's source files. The setup action installs Node 24, bringing CI closer to a project and production environment that also uses Node 24.

`npm ci` reconstructs dependencies. Linting looks for statically detectable mistakes and policy violations. Tests check behavior. The build step proves the application can compile or bundle under the declared configuration. A missing import can escape a narrow unit test and still fail the production build, so building in CI moves that discovery earlier than deployment.

The YAML describes this automation, but it is not CI's central idea. Another product can express the same event, runner, commands, and result with different syntax. The feedback loop remains the same.

## Why Do Clean Runners and Locked Dependencies Matter?
<!-- section-summary: A clean runner tests whether the repository can reconstruct the application without hidden state from one developer's machine. -->

A developer laptop collects undeclared tools and state over time: global runtimes, command-line programs, old packages, credentials, environment variables, and generated files. The application may work because one of those invisible dependencies happens to exist.

A **clean runner** asks a stronger question: given the repository, its declared runtime, its declared dependency graph, and its build instructions, can another environment reconstruct a working application? This turns CI into a reproducibility test before the first unit test runs.

Consider a project whose `package.json` allows `some-library` versions compatible with `^4.2.0`. A dependency resolver might install `4.2.1` today and `4.9.0` months later. Two runs of the same commit would then use different transitive software, which makes failures harder to reproduce.

Package ecosystems solve this with lock files such as:

- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `poetry.lock`
- `Cargo.lock`
- `Gemfile.lock`

The package manifest describes the acceptable direct dependencies and version ranges. The lock file records the precise dependency graph that the project expects to install. Together they make repeated installations much more alike:

```text
same source
  + same locked dependency graph
  + same declared runtime
  ≈ repeatable result
```

This is why Node.js pipelines commonly use `npm ci`. During normal development, `npm install` can resolve packages and update the lock file. In verification, `npm ci` performs a clean installation from the recorded lock and fails when the manifest and lock disagree. CI should reveal an inconsistent dependency record rather than invent a new one while deciding whether a commit is safe.

Caching does not change that contract. A package cache can avoid downloading unchanged archives, but the job should still reconstruct the installed dependency tree from the lock file. A cache accelerates reproducible work; it should not replace declared setup with an opaque old workspace.

Clean environments also expose missing runtime steps. If integration tests need PostgreSQL, the workflow should start a test database and provide a test connection string. If the application imports generated code, the workflow should run the generator. If a CLI is required, the project should declare how to install it. The fix belongs in the repository's automated recipe, not in a private checklist for configuring Sarah's laptop.

Perfect parity across development, CI, staging, and production is rarely possible. The environments should still become increasingly representative rather than unrelated. Testing with Node 18 and SQLite offers weak evidence for a production service that uses Node 24 and PostgreSQL. Explicit runtimes and realistic dependencies narrow that gap.

## Which Checks Should a CI Pipeline Run?
<!-- section-summary: CI should run the fastest useful set of checks that protects the failure boundaries the team would regret crossing. -->

There is no universal checklist. A team should ask, “Which detectable failures would make us regret merging this commit?” The answer often includes formatting, linting, static analysis, type checking, unit tests, a build, integration tests, and selected security or dependency checks.

The goal is useful confidence at an acceptable feedback cost. Adding every imaginable test can make the core loop so slow that developers stop integrating frequently. Running only one tiny unit test produces fast feedback with little evidence. A well-shaped pipeline uses different checks because each observes a different boundary.

For a payment function such as `chargeCustomer(customer, amount)`:

| Check | What it can establish |
|---|---|
| Lint or static analysis | The source follows selected syntax and correctness rules. |
| Type checking | The caller and function agree about expected data types. |
| Unit test | Fee calculation behaves correctly for isolated inputs. |
| Integration test | The service exchanges the expected data with its database or provider adapter. |
| End-to-end test | A user-sized payment path connects from entry point to final outcome. |

No row replaces all the others. Unit tests can be fast and precise while missing a schema mismatch. An end-to-end test can prove a broad path while making a failure slower and harder to localize. Teams usually place many fast checks near the bottom of the stack, selected integration tests around important boundaries, and a smaller number of end-to-end paths for critical behavior.

Cheap checks should generally report failure before expensive checks consume time. If formatting or lint can reject the commit in ten seconds, waiting twenty minutes for an integration suite before showing that result wastes feedback time. A conceptual ordering is:

```text
format → lint → type check → unit tests → build → integration → end to end
 fast                                                        expensive
```

Jobs can run some checks in parallel when that shortens the total path. The principle is not a rigid linear order; it is to expose inexpensive, high-value failures early and preserve enough context to act on them.

Flaky tests damage this system. A **flaky test** passes and fails against the same code because it depends on timing guesses, shared state, nondeterministic ordering, or an unreliable external system. Developers soon rerun red jobs until they turn green, teaching the team to ignore the very signal CI is meant to protect.

The durable fix is to make the test observe a real condition. A background-worker test should wait for the order status or queue state, rather than sleeping for an assumed one second. If a blocking flaky test must be quarantined temporarily, record the owner, reason, repair deadline, and route back into required CI. Permanent quarantine silently converts a known signal failure into an untested risk.

Finally, green CI has a precise interpretation: no selected automated check detected a violation. It is evidence, not proof of correctness. That distinction encourages teams to improve checks when production exposes a missing boundary instead of treating the green badge as a universal guarantee.

## How Does the Complete CI Feedback Loop Work?
<!-- section-summary: The complete loop combines small proposals, the actual integration state, reproducible execution, trustworthy checks, and rapid repair. -->

Suppose Alice adds a `/health` endpoint. She branches from `main`, implements the endpoint in a small commit, pushes the branch, and opens a pull request.

```http
GET /health

200 OK
{
  "status": "healthy"
}
```

The pull request event starts CI. A fresh Ubuntu runner checks out the proposed state, installs Node 24, recreates dependencies with `npm ci`, and runs lint, tests, and the production build. If a required check fails, Alice repairs the change and pushes again. If the checks and human review pass, the branch can join `main`.

The push to `main` can run CI again to verify the state after integration. The repeating path is:

```text
small change
    ↓
proposed integration
    ↓
clean, reproducible verification
    ↓
 ┌──┴──┐
pass  fail
 ↓      ↓
main   fix and repeat
```

Five ideas make the loop strong: small changes, one shared mainline, automated checks, a clean reproducible environment, and fast feedback. Remove frequent integration and branches accumulate painful conflicts. Remove automation and humans must repeat every mechanical check. Remove clean execution and hidden machine state decides the result. Remove reproducibility and one commit can produce different builds. Remove speed and developers stop working in small feedback cycles.

This also clarifies the boundary between CI and later delivery work. CI asks whether the change can safely join the shared codebase under the team's selected checks. **Continuous Delivery** asks whether a verified version remains in a releasable state. **Continuous Deployment** goes further by automatically taking qualifying changes into production. CI produces the validated commit and often the build input that those later stages use, but passing integration checks alone does not decide production health or release policy.

The most useful mental model is therefore an automated feedback loop that protects shared software state. Changes interact; delayed discovery makes interaction failures more expensive; frequent integration keeps the failure domain small; reproducible automation tests the intended combined state; required checks reject selected violations; and the team repeats the loop.

That framing turns the visible tools into one coherent system. A branch bounds the proposal. A pull request combines human and machine review. A runner reconstructs the repository. Lock files stabilize dependencies. Test layers observe different failure boundaries. Required checks defend `main`. Fast feedback returns the result while the developer can still make a small correction.

## Check Your Answers

:::expand[Why Does Continuous Integration Exist?]{kind="recap"}
Separately working changes can fail when combined. CI repeatedly verifies a proposed combined state and returns objective evidence while the change is still small.
:::

:::expand[Why Must Integration Be Frequent?]{kind="recap"}
Frequent integration limits both the change batch and the diagnostic search space. Fast feedback encourages small commits and inexpensive corrections.
:::

:::expand[How Do the Mainline, Branches, and Pull Requests Fit Together?]{kind="recap"}
The mainline is the accepted shared state, a branch isolates a small proposal, and a pull request brings human review and automated validation together before integration.
:::

:::expand[How Do Required Checks Protect the Shared Mainline?]{kind="recap"}
Required checks block a merge until selected automation passes against the intended integration state. They enforce chosen constraints but do not prove the software has no bugs.
:::

:::expand[What Does a CI Runner Actually Do?]{kind="recap"}
A repository event starts a workflow, a job receives a runner, and ordered steps check out the code, prepare tools, install dependencies, and execute ordinary validation commands.
:::

:::expand[Why Do Clean Runners and Locked Dependencies Matter?]{kind="recap"}
Clean execution exposes hidden machine assumptions, while explicit runtimes and lock files make the same source reconstruct a similar dependency environment on every run.
:::

:::expand[Which Checks Should a CI Pipeline Run?]{kind="recap"}
Choose fast, trustworthy checks for the boundaries the team would regret breaking. Different test layers provide different evidence, and green CI means only that those selected checks passed.
:::

:::expand[How Does the Complete CI Feedback Loop Work?]{kind="recap"}
Small changes target the mainline, reproducible automation checks the actual candidate state, required results guide merge or repair, and the loop repeats with rapid feedback.
:::

## References

- [Available rules for GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) - Documents required status checks and strict branch-update behavior.
- [Creating an example GitHub Actions workflow](https://docs.github.com/en/actions/tutorials/create-an-example-workflow) - Introduces workflow events, hosted runners, checkout, and command steps.
- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Documents workflow names, triggers, jobs, runners, steps, and permissions.

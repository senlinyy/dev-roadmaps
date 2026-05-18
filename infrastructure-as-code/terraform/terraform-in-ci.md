---
title: "Terraform in CI"
description: "Run Terraform and OpenTofu checks in CI so pull requests show formatting, validation, plan evidence, credential boundaries, backend access, locks, and safe apply choices."
overview: "Terraform in CI moves the review loop from one laptop into a repeatable runner. This article follows the orders team as pull requests generate review evidence and production applies stay protected."
tags: ["terraform", "opentofu", "ci", "plan", "state"]
order: 9
id: article-infrastructure-as-code-terraform-in-ci
---

## Table of Contents

1. [The Problem](#the-problem)
2. [CI Runner](#ci-runner)
3. [Pull Request Checks](#pull-request-checks)
4. [Plan Artifacts](#plan-artifacts)
5. [Credentials](#credentials)
6. [Backends and Locks](#backends-and-locks)
7. [Apply Boundaries](#apply-boundaries)
8. [GitHub Actions Shape](#github-actions-shape)
9. [Reading CI Output](#reading-ci-output)
10. [Putting It All Together](#putting-it-all-together)

## The Problem

The orders team can run Terraform locally now. That works for one engineer, but team review needs more than "it planned fine on my laptop."

A laptop can have stale providers, a different workspace, uncommitted files, broad credentials, missing environment variables, or a state lock problem the reviewer cannot see. Infrastructure pull requests need repeatable evidence.

Terraform in CI answers that need:

- Every pull request runs the same formatting and validation checks.
- Plans are generated from a known root module.
- Reviewers can read plan evidence without reproducing the environment locally.
- Production credentials and apply permissions can be separated from pull request checks.
- Backend and lock problems are visible before merge or apply.

CI does not make Terraform safe by magic. It gives the team a consistent place to produce evidence and enforce boundaries.

## CI Runner

A CI runner is another operator. It has a working directory, provider plugins, credentials, environment variables, network access, backend access, and filesystem state.

For Terraform, that means the CI job must be explicit about the root module:

```bash
$ terraform -chdir=infra/orders/prod init -input=false
$ terraform -chdir=infra/orders/prod fmt -check
$ terraform -chdir=infra/orders/prod validate
$ terraform -chdir=infra/orders/prod plan -input=false
```

The `-chdir` flag makes the target directory explicit. The `-input=false` flag prevents Terraform from prompting in a non-interactive job. HashiCorp's automation guidance calls out non-interactive runs as a special workflow concern because CI cannot answer prompts like a human terminal.

The runner should also use the dependency lock file. If the pull request did not update `.terraform.lock.hcl`, CI should not silently choose a surprise provider version.

OpenTofu uses the same shape with `tofu` commands.

## Pull Request Checks

Pull request checks should answer mechanical questions before humans spend time on infrastructure judgment.

| Check | Question |
| --- | --- |
| `init` | Can the runner install providers, modules, and backend setup? |
| `fmt -check` | Are files in canonical format? |
| `validate` | Can Terraform understand the configuration? |
| `plan` | What does Terraform propose to change? |

Formatting and validation are not risk review. They clear the floor. A green `validate` does not mean the plan is safe. A plan that passes command execution can still replace a database.

The plan is the main review artifact. Reviewers compare the pull request story, file diff, and plan output. If they disagree, the branch needs more work before apply.

## Plan Artifacts

There are two common plan patterns in CI.

The first pattern is a throwaway pull request plan:

```bash
$ terraform plan -input=false
```

This plan is for review only. It is not applied later. After merge, the apply workflow creates a fresh plan from the main branch and current state.

The second pattern is a saved plan:

```bash
$ terraform plan -out=tfplan -input=false
$ terraform apply -input=false tfplan
```

A saved plan connects the reviewed plan to apply more directly, but it creates artifact handling responsibilities. HashiCorp documents that plan files can include configuration, state-derived data, variables, and backend configuration. Protect saved plans like sensitive deployment artifacts.

The team should be clear about which pattern it uses. A reviewer should never assume a pull request plan is exactly what production will apply unless the automation actually enforces that connection.

## Credentials

Terraform CI credentials should match the job's purpose.

A pull request plan may need enough read access to refresh state and read provider data. It may also need limited write access in some provider workflows or speculative plan setups. A production apply needs write access to the managed resources. Those are not always the same permission set.

Credential questions belong in the CI design:

| Question | Healthy direction |
| --- | --- |
| Can pull requests from forks access secrets? | Usually no, especially for cloud credentials. |
| Can a plan job write production? | Avoid when possible. |
| Can an apply job run without approval? | Only for low-risk environments. |
| Are credentials hardcoded in `.tf` files? | No. Use provider-supported external mechanisms. |
| Are permissions scoped to one environment? | Yes, as much as the provider allows. |

GitHub Actions, for example, supports workflow permissions and secrets. Cloud providers often support OpenID Connect from CI so workflows can request short-lived credentials instead of storing long-lived keys. The exact provider setup is outside this Terraform article, but the boundary matters: CI is now an operator, so its identity must be designed.

## Backends and Locks

CI must reach the backend for the root module it plans. If the backend is unavailable, credentials are wrong, or the state lock is held, the plan may fail before it produces useful evidence.

That is good. A failed backend or lock check is information.

```text
Error acquiring the state lock
```

This should not trigger an automatic force-unlock. It may mean another apply is active. The safe response is to identify the lock owner, understand whether work is still running, and only recover a stale lock deliberately.

Backend access also decides which environment the plan is reading. A production workflow should not accidentally use a development state key. CI should make the root module, backend, variables, and credentials line up.

## Apply Boundaries

Apply is where CI becomes dangerous if the boundary is vague. A workflow that runs `terraform apply -auto-approve` on every pull request to production is usually not a review process. It is a fast path to an incident.

Common apply boundary patterns include:

| Pattern | Good use |
| --- | --- |
| PR checks only | Produce plan evidence without changing infrastructure. |
| Merge to main triggers plan | Recompute against the latest state after approval. |
| Manual approval for production apply | Human gate before real changes. |
| Automatic apply for disposable dev | Low-risk environments where speed matters. |
| Separate apply workflow | Write credentials are available only in a protected path. |

For production, a healthy workflow usually separates pull request evidence from apply authority. The reviewer sees the plan. The protected apply path uses scoped credentials, state locking, and approval.

## GitHub Actions Shape

A beginner-safe GitHub Actions check might look like this:

```yaml
name: Terraform checks

on:
  pull_request:
    paths:
      - "infra/orders/prod/**"

permissions:
  contents: read

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra/orders/prod
    steps:
      - uses: actions/checkout@v4

      - name: Terraform init
        run: terraform init -input=false

      - name: Terraform format
        run: terraform fmt -check

      - name: Terraform validate
        run: terraform validate

      - name: Terraform plan
        run: terraform plan -input=false
```

This workflow checks pull requests that touch the production Terraform directory. It does not apply. It sets read-only repository permissions for the workflow token. It makes the working directory explicit.

A real production workflow would still need cloud authentication, backend access, dependency caching decisions, plan output handling, and protected apply design. The example shows shape, not a complete security design.

## Reading CI Output

Reviewers should read CI output with the same questions they use locally:

| Output | Review question |
| --- | --- |
| `fmt` failed | Did the branch commit formatted Terraform files? |
| `validate` failed | Is the configuration coherent enough to plan? |
| `plan` failed on backend | Is state reachable and correctly configured? |
| `plan` failed on credentials | Is the CI identity allowed to read what it needs? |
| Plan has unexpected destroy | Does the plan conflict with the pull request story? |
| Apply blocked on approval | Is the protected boundary working as intended? |

CI can make infrastructure review calmer, but only if humans read the right evidence. A green check is the start of review, not the end.

## Putting It All Together

The orders team moved Terraform from one laptop into a repeatable CI path.

- The CI runner became an explicit operator with a root module and non-interactive commands.
- Pull request checks produced formatting, validation, and plan evidence.
- Plan artifacts were treated according to whether they were throwaway or applyable.
- Credentials were scoped to the job and environment.
- Backend and lock failures became useful safety signals.
- Apply boundaries separated review evidence from production write authority.
- A small GitHub Actions workflow showed the shape without pretending to be a complete security design.

This closes the Terraform module. You now have the operating path: write clear resources, control values, protect state, read plans, reuse modules carefully, separate environments, import existing resources, and make review evidence repeatable in CI.

---

**References**

- [Terraform automation guide](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform)
- [Terraform init command](https://developer.hashicorp.com/terraform/cli/commands/init)
- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform apply command](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)

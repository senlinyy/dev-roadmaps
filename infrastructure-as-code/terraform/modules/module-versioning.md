---
title: "Module Versioning"
description: "Specific Terraform module versions keep shared infrastructure updates under review."
overview: "Shared Terraform modules are dependencies. This article starts with one reused module, then shows how Registry versions, Git refs, provider locks, and upgrade pull requests keep infrastructure changes reviewable."
tags: ["modules", "versioning", "registry", "semver", "terraform"]
order: 3
id: article-iac-terraform-modules-versioning
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/module-versioning.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/module-versioning.md
---

## Table of Contents

1. [Why Module Versions Matter](#why-module-versions-matter)
2. [Where Modules Come From](#where-modules-come-from)
3. [Using the version Argument](#using-the-version-argument)
4. [Choosing Version Constraints](#choosing-version-constraints)
5. [What .terraform.lock.hcl Locks](#what-terraformlockhcl-locks)
6. [Pinning Git Modules](#pinning-git-modules)
7. [A Safe Upgrade Workflow](#a-safe-upgrade-workflow)
8. [Choosing Shared Modules Carefully](#choosing-shared-modules-carefully)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Module Versions Matter
<!-- section-summary: Module versioning keeps reusable infrastructure code on a schedule the caller can review and choose. -->

The Orders team now calls a shared network module from production. The module creates subnets, route tables, flow logs, and VPC endpoints. The root configuration is small, but the module code still changes real infrastructure.

That makes the module a dependency. A module maintainer release that changes a default route or adds an endpoint can change the production plan even if the service team left the root resource code untouched.

**Module versioning** lets the root configuration choose which module release it has reviewed. Production can stay on `5.21.0` while the team reads the changelog for `5.22.0`, runs a plan in development, and promotes the upgrade through staging before production.

The beginner mistake is to treat a module source like a copy of code. Remote module code is closer to a library package. A safer workflow pins the module, reviews upgrades, and makes the plan explain what the dependency changed.

This is especially important for modules that manage shared foundations such as VPCs, clusters, IAM roles, or databases. A small version line can change many resources because the real code lives behind the module source.

There are two sides to the workflow. The module maintainers publish a release with a tag, changelog, and tested examples. The root module callers pin that release, run `terraform init`, and review the plan in their own environment. Versioning requires reviewable evidence from both sides.

## Where Modules Come From
<!-- section-summary: Module source type decides how Terraform downloads the module and which versioning controls are available. -->

A **module source** tells Terraform where to find the child module. The source type decides how you pin it.

![Module Source Decision](/content-assets/articles/article-iac-terraform-modules-versioning/module-source-decision.png)

*The source decision view compares local paths, Git sources, and registry sources by reviewability and upgrade control.*

Local modules come from the same repository:

```hcl
module "artifact_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "dp-orders-artifacts-prod"
  environment = "prod"
}
```

Local modules follow the Git commit of the repository. If a pull request changes both the module and the production call, reviewers see both changes in the same diff.

Registry modules come from a Terraform Registry-compatible service. They support the `version` argument:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "orders-prod"
  cidr = "10.20.0.0/16"
}
```

Git modules come from a Git repository and usually pin with a `ref` query parameter:

```hcl
module "network" {
  source = "git::https://github.com/devpolaris/terraform-modules.git//network?ref=v2.4.1"

  environment = "prod"
  cidr_block  = "10.20.0.0/16"
}
```

Each source style can be production-ready with a clear pinning and upgrade process.

The source style also changes the review evidence. A local module change appears in the same pull request. A Registry module upgrade needs release notes and a version diff. A Git module upgrade needs a tag, commit, or compare link that reviewers can inspect.

## Using the version Argument
<!-- section-summary: Registry module calls use the version argument to select the release Terraform may install. -->

Registry module calls use `version` to select an allowed release. Terraform reads this during `terraform init` and downloads the matching module package.

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "orders-prod"
  cidr = "10.20.0.0/16"

  azs             = ["eu-west-2a", "eu-west-2b", "eu-west-2c"]
  private_subnets = ["10.20.10.0/24", "10.20.11.0/24", "10.20.12.0/24"]
  public_subnets  = ["10.20.20.0/24", "10.20.21.0/24", "10.20.22.0/24"]
}
```

An exact version makes fresh checkouts predictable. A new engineer, a CI runner, and a disaster recovery checkout all install the same module release after `terraform init`.

For production, every remote Registry module call should have a version constraint. Without it, Terraform can choose a newer release during initialization, and the dependency change may surprise the plan reviewer.

After initialization, Terraform stores downloaded module code under `.terraform/modules/` for the working directory. That cache is local build output. The repeatability comes from the source and version constraint in code, then the `terraform init` step that installs the selected module.

The init output should name the selected version:

```console
Initializing modules...
Downloading registry.terraform.io/terraform-aws-modules/vpc/aws 5.21.0 for vpc...
- vpc in .terraform/modules/vpc

Terraform has been successfully initialized!
```

That output belongs in CI logs or the pull request evidence for a shared module change. It shows reviewers which module package Terraform actually installed before the plan ran.

## Choosing Version Constraints
<!-- section-summary: Version constraints choose between strict stability and controlled automatic patch or minor updates. -->

A **version constraint** is a rule for which module releases Terraform may install. Teams choose constraints based on how much automatic movement they want.

| Constraint | Meaning | Common use |
|---|---|---|
| `"5.21.0"` | Exactly version 5.21.0 | Maximum repeatability |
| `">= 5.21.0, < 6.0.0"` | Any 5.x release from 5.21.0 upward | Controlled movement inside one major line |
| `"~> 5.21"` | 5.21 or newer, below 6.0 | Minor and patch movement in the 5.x line |
| `"~> 5.21.0"` | Patch releases for 5.21 | Patch movement only |

The `~>` operator is the pessimistic constraint operator. It sets a lower bound and a calculated upper bound. `"~> 5.21.0"` accepts `5.21.1` but blocks `5.22.0`.

Semantic versioning gives useful language for review. Major versions may include breaking changes. Minor versions often add behavior. Patch versions usually fix bugs. Real modules vary in how strictly they follow those promises, so the changelog and plan still matter.

Open-ended production constraints such as `">= 5.21.0"` create upgrade risk because a future major release can satisfy that rule. Bounded constraints keep upgrades inside a range the team chose.

Exact pins are easiest to reason about for critical production roots because every upgrade changes one visible line. Bounded constraints can work for teams with automation that runs `terraform init -upgrade`, creates a pull request, and attaches a plan. The important part is that a human sees the resulting infrastructure diff before apply.

## What .terraform.lock.hcl Locks
<!-- section-summary: The dependency lock file records provider selections, while module versions still need explicit pins. -->

The `.terraform.lock.hcl` file records selected **provider** packages and checksums. Teams commit it so provider upgrades are visible in review.

A simplified entry looks like this:

```hcl
provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.46.0"
  constraints = "~> 6.0"
  hashes = [
    "h1:example",
  ]
}
```

That entry is about the AWS provider plugin. Terraform's dependency lock file currently tracks providers. Module versions still come from module `version` constraints or Git refs.

This distinction matters in review. Seeing `.terraform.lock.hcl` in the repository only proves provider selections are tracked. A complete dependency review checks both provider lock changes and module source changes.

During a module upgrade, `terraform init -upgrade` may also update provider selections if the provider constraints allow it. The same pull request should include a `.terraform.lock.hcl` review. If provider versions changed unexpectedly, the team should decide whether that belongs in the same upgrade or a separate provider upgrade.

## Pinning Git Modules
<!-- section-summary: Git module sources use refs, and protected tags or commit hashes are safer pins than moving branches. -->

Git module sources use the `ref` query parameter to choose a branch, tag, or commit.

```hcl
module "network" {
  source = "git::https://github.com/devpolaris/terraform-modules.git//network?ref=v2.4.1"

  environment = "prod"
  cidr_block  = "10.20.0.0/16"
}
```

Tags such as `v2.4.1` are readable and fit a release workflow. Release tags should be protected in the Git hosting system so nobody can move them after release. Commit hashes give the strongest exact pin because one hash names one commit.

Branch refs such as `?ref=main` move as new commits land. They can work for experiments, but production roots usually need tags or commit hashes so reviewers know which code Terraform will download.

If one repository contains several modules, the double slash selects a subdirectory:

```hcl
source = "git::https://github.com/devpolaris/terraform-modules.git//network?ref=v2.4.1"
```

The `network` folder is the module. The `ref` is the code version.

For internal Git modules, protected release tags and a short changelog make review direct. A tag that can move after release weakens the whole pinning story. A protected tag or commit hash lets a later incident review answer exactly which module code production used.

## A Safe Upgrade Workflow
<!-- section-summary: A module upgrade should move through changelog review, init, plan, non-production verification, and production approval. -->

A safe module upgrade is a small pull request. One module dependency changes, the release notes get read, `terraform init -upgrade` runs, and the plan shows the infrastructure effect.

![Module Upgrade Review Loop](/content-assets/articles/article-iac-terraform-modules-versioning/module-upgrade-review-loop.png)

*The upgrade loop shows why shared modules should move through one reviewed version change at a time.*

In staging, the command flow usually has three parts: refresh install selections, save a plan for review, and apply the reviewed plan.

```bash
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```

The `-upgrade` flag tells Terraform to re-check available provider and module versions that match the constraints instead of reusing cached selections. The init output should make version changes visible. Reviewers check the plan summary for creates, updates, deletes, and replacements before approval. A saved plan lets the approved apply use the exact plan reviewers inspected.

For a Registry module upgrade, the init output may show the module moving:

```console
Initializing modules...
Downloading registry.terraform.io/terraform-aws-modules/vpc/aws 5.22.0 for vpc...
- vpc in .terraform/modules/vpc

Terraform has been successfully initialized!
```

The plan then shows the infrastructure effect of that new module code:

```console
Plan: 1 to add, 3 to change, 0 to destroy.
```

That small summary is only the starting point. Reviewers still need to inspect the resource details, especially replacements, IAM policy changes, route table changes, and security group changes. A module upgrade pull request should never rely on the version number alone as proof that the change is safe.

The review should answer a few plain questions:

| Question | Why it matters |
|---|---|
| Which module changed? | Keeps the dependency change clear |
| Which version or ref changed? | Makes rollback understandable |
| What does the changelog say? | Connects expected behavior to the plan |
| What does the plan change? | Shows real infrastructure impact |
| Did staging apply and verification pass? | Gives production evidence |

A surprise replacement or deletion is a reason to revert the version change and investigate. One dependency per pull request keeps the rollback path simple.

Rollback is also a planned change. It starts by restoring the previous version or Git ref, running `terraform init -upgrade`, and inspecting the rollback plan. Sometimes the rollback plan truly reverses the module change. Sometimes the new module already changed live infrastructure in a way that needs a forward fix. The plan tells the team which path is safer.

A production upgrade record should include these artifacts:

1. Old and new module version or Git ref.
2. Link to release notes or a Git compare view.
3. `terraform init -upgrade` output summary.
4. Saved plan summary for the target environment.
5. Non-production verification result and rollback note.

## Choosing Shared Modules Carefully
<!-- section-summary: A module is worth adopting if its assumptions, maintenance, testing, and release process match the team's infrastructure standards. -->

Using a shared module means trusting shared code with infrastructure changes. That can be a great trade for common patterns such as VPCs, managed databases, Kubernetes clusters, and storage buckets. It can also create friction if the module's assumptions fight your naming, tagging, security, or network rules.

Adoption review starts with maintenance signals: recent releases, changelogs, examples, tests, upgrade notes, and issue activity. The interface needs a close read too. A good module exposes the choices your team needs and has defaults your team accepts.

Internal modules fit organization-specific rules: required tags, account layout, observability standards, identity boundaries, compliance controls, and network patterns. Public modules fit widely used building blocks if your requirements match the module's supported shape.

The practical test is whether the module makes the reviewed path clearer. If adopting it requires a fork on day one, a focused internal module may cost less over time.

The module's assumptions about state and providers matter too. Some modules expect to own many adjacent resources, while your team may split those resources across roots. Some modules create IAM policies or security group rules that need security review. Examples and outputs show whether the module boundary matches the boundary your team wants to operate.

## Putting It All Together
<!-- section-summary: Stable module dependencies come from explicit pins, provider locks, small upgrade pull requests, and plan-based promotion. -->

Module code is infrastructure code, even if it lives in another repository. Local modules follow the repository commit. Registry modules need version constraints. Git modules need stable refs. Provider selections belong in `.terraform.lock.hcl`.

![Versioning Summary Map](/content-assets/articles/article-iac-terraform-modules-versioning/versioning-summary-map.png)

*The summary board gathers the module versioning habits that keep reuse from turning into hidden drift.*

The safe workflow is steady: the team pins the module, upgrades one dependency at a time, runs `terraform init -upgrade`, reviews the plan, tests outside production, and promotes the same version to production after approval.

## What's Next

The next article looks at module design: how to keep modules focused, how to make dependencies visible, and how root modules compose reusable parts.

---

**References**

- [Terraform: Module sources](https://developer.hashicorp.com/terraform/language/modules/configuration) - Documents local, registry, Git, HTTP, and other module source formats.
- [Terraform: Module block](https://developer.hashicorp.com/terraform/language/block/module) - Documents the `source` and `version` arguments used by module callers.
- [Terraform: Version constraints](https://developer.hashicorp.com/terraform/language/expressions/version-constraints) - Explains exact, range, and pessimistic version constraints.
- [Terraform: Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - Documents provider selections and checksums in `.terraform.lock.hcl`.
- [Terraform CLI: init](https://developer.hashicorp.com/terraform/cli/commands/init) - Documents module installation and `-upgrade` behavior during initialization.
- [Terraform Registry: Publishing modules](https://developer.hashicorp.com/terraform/registry/modules/publish) - Documents Registry module release and publishing expectations.

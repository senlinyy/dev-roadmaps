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

1. [Why Do Module Versions Matter?](#why-do-module-versions-matter)
2. [How Do Module Sources Identify Code?](#how-do-module-sources-identify-code)
3. [How Do Registry Version Constraints Select Releases?](#how-do-registry-version-constraints-select-releases)
4. [What Does the Dependency Lock File Actually Lock?](#what-does-the-dependency-lock-file-actually-lock)
5. [How Do You Pin Git Modules?](#how-do-you-pin-git-modules)
6. [How Do You Upgrade a Module Safely?](#how-do-you-upgrade-a-module-safely)
7. [How Do You Evaluate a Shared Module Dependency?](#how-do-you-evaluate-a-shared-module-dependency)
8. [How Does the Full Dependency Model Fit Together?](#how-does-the-full-dependency-model-fit-together)
9. [Check Your Answers](#check-your-answers)

A remote module is code that the root configuration depends on. If the module can change without a caller change, the meaning of the same committed `.tf` files can change too. Versioning controls how much authority that external source has to change the infrastructure graph.

A production root now calls a shared network module. The module can create a VPC, subnets, routes, and other infrastructure even though the caller contains only one module block. The root is small, but the external module code still changes real systems.

That makes the module a dependency. A module maintainer release that changes a default route or adds an endpoint can change the production plan even if the service team left the root resource code untouched.

**Module versioning** lets the root configuration choose which module release it has reviewed. Production can stay on `5.21.0` while the team reads the changelog for `5.22.0`, runs a plan in development, and promotes the upgrade through staging before production.

Keep these questions in view as you work through the lesson:

1. **Why Do Module Versions Matter?**
2. **How Do Module Sources Identify Code?**
3. **How Do Registry Version Constraints Select Releases?**
4. **What Does the Dependency Lock File Actually Lock?**
5. **How Do You Pin Git Modules?**
6. **How Do You Upgrade a Module Safely?**
7. **How Do You Evaluate a Shared Module Dependency?**
8. **How Does the Full Dependency Model Fit Together?**

## Why Do Module Versions Matter?
<!-- section-summary: Module versioning keeps reusable infrastructure code on a schedule the caller can review and choose. -->

The beginner mistake is to treat a module source like a copy of code. Remote module code is closer to a library package. A safer workflow pins the module, reviews upgrades, and makes the plan explain what the dependency changed.

This is especially important for modules that manage shared foundations such as VPCs, clusters, IAM roles, or databases. A small version line can change many resources because the real code lives behind the module source.

There are two sides to the workflow. The module maintainers publish a release with a tag, changelog, and tested examples. The root module callers pin that release, run `terraform init`, and review the plan in their own environment. Versioning requires reviewable evidence from both sides.

The reproducibility problem is simple. Today a source may create only a VPC. Next month its author may add a flow log. The caller's `main.tf` is unchanged, yet the dependency now expands into a different resource graph. Infrastructure should not acquire that new meaning merely because a fresh machine retrieved the source later.

A dependency therefore needs two identities: **what code** and **which revision**. For a Registry module, `source = "acme/network/aws"` names the module and `version = "1.2.1"` selects a release. Keeping those questions separate makes reviews and rollback precise.

The principle resembles dependency management in other ecosystems, but Terraform modules affect long-lived resources. A dependency change can add, update, replace, or destroy infrastructure. Reproducibility is not only about making a build compile; it controls which desired-state transition Terraform calculates.

## How Do Module Sources Identify Code?
<!-- section-summary: Module source type decides how Terraform downloads the module and which versioning controls are available. -->

A **module source** tells Terraform where to find the child module. The source type decides how you pin it.

![Module Source Decision](/content-assets/articles/article-iac-terraform-modules-versioning/module-source-decision.png)

*The source decision view compares local paths, Git sources, and registry sources by reviewability and upgrade control.*

Local modules come from the same repository:

```hcl
module "artifact_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
  environment = "prod"
}
```

Local modules follow the Git commit of the repository. If a pull request changes both the module and the production call, reviewers see both changes in the same diff.

Registry modules come from a Terraform Registry-compatible service. They support the `version` argument:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "myapp-prod"
  cidr = "10.20.0.0/16"
}
```

Git modules come from a Git repository and usually pin with a `ref` query parameter:

```hcl
module "network" {
  source = "git::https://github.com/acme/terraform-modules.git//network?ref=v2.4.1"

  environment = "prod"
  cidr_block  = "10.20.0.0/16"
}
```

Each source style can be production-ready with a clear pinning and upgrade process.

Terraform also supports private registries, GitHub and Bitbucket shortcuts, HTTP locations, and other source forms. Source syntax determines the retrieval and revision mechanism; not every remote location participates in Registry version resolution.

Local modules are versioned with their containing repository rather than an independent `version` argument. Checking out commit `abc123` retrieves both `environments/prod` and `modules/private-bucket` from that commit. A local call cannot add `version = "1.2.0"`; Registry module calls are the ones that support the argument.

The source style also changes the review evidence. A local module change appears in the same pull request. A Registry module upgrade needs release notes and a version diff. A Git module upgrade needs a tag, commit, or compare link that reviewers can inspect.

This is why “source” and “version” should not be collapsed into one idea. A Registry separates module identity from semantic release selection. A Git URL encodes repository, optional subdirectory, and ref in the source string. A local path selects whatever files are in the current repository revision.

## How Do Registry Version Constraints Select Releases?
<!-- section-summary: Registry module calls use the version argument to select the release Terraform may install. -->

Registry module calls use `version` to select an allowed release. Terraform reads this during `terraform init` and downloads the matching module package.

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "myapp-prod"
  cidr = "10.20.0.0/16"

  azs             = ["eu-west-2a", "eu-west-2b", "eu-west-2c"]
  private_subnets = ["10.20.10.0/24", "10.20.11.0/24", "10.20.12.0/24"]
  public_subnets  = ["10.20.20.0/24", "10.20.21.0/24", "10.20.22.0/24"]
}
```

An exact version makes fresh checkouts predictable. A new engineer, a CI runner, and a disaster recovery checkout all install the same module release after `terraform init`.

Both `version = "1.2.1"` and `version = "= 1.2.1"` express an exact Registry constraint. A newer `1.2.2` can exist without changing this root. The caller moves only after the selected line changes.

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

### How should you read common version constraints?
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

Version numbers are publisher promises, not behavior Terraform proves. Terraform can check that `1.2.1` satisfies a constraint; it cannot prove the patch is backward compatible or will avoid replacement. Trust in a range depends on the maintainer's release discipline.

Open-ended production constraints such as `">= 5.21.0"` create upgrade risk because a future major release can satisfy that rule. Bounded constraints keep upgrades inside a range the team chose.

Exact pins are easiest to reason about for critical production roots because every upgrade changes one visible line. Bounded constraints can work for teams with automation that runs `terraform init -upgrade`, creates a pull request, and attaches a plan. The important part is that a human sees the resulting infrastructure diff before apply.

Read `~>` carefully. `~> 1.2.3` allows later `1.2.x` releases but not `1.3.0`. `~> 1.2` is broader: it allows later `1.x` releases but not `2.0.0`. The number of specified components changes the upper bound.

A constraint is permission, not a record of the currently installed release. `>= 1.2.0, < 2.0.0` tells Terraform that every matching 1.x release is acceptable. `>= 1.2.0` also permits future major releases unless another bound restricts it.

Think of the rule as an upgrade budget:

```text
"3.4.7"   → no automatic module movement
"~> 3.4.7" → later 3.4.x releases
"~> 3.4"   → later 3.x releases
">= 3.4.7" → effectively unbounded upward
```

Choose the budget deliberately. Exact versions are often suitable for production roots that want upgrades to be explicit code changes. Ranges can suit disciplined internal publishers and automation that continually resolves, plans, reviews, and tests allowed updates.

## What Does the Dependency Lock File Actually Lock?
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

This asymmetry is easy to miss. A provider constraint such as `~> 6.0` is resolved to one selected provider version and checksums recorded in `.terraform.lock.hcl`. A Registry module constraint such as `~> 1.2` is not recorded there as one selected module version. An exact module constraint in configuration is the durable way to require that one release.

The difference can appear between a developer laptop and CI. The laptop's `.terraform/modules/` directory may already contain module `1.7.0`, while a clean CI checkout resolves the same broad constraint after `1.8.0` is published. The committed configuration matches, but the installed module code can differ because the provider lock file does not lock remote modules.

`.terraform/` is an installation and cache area for the current working directory, not a durable dependency lock. It should not be committed. A cached copy may explain why one machine keeps using an older module, but it is not reviewable repository evidence that every fresh runner will select that code.

This distinction matters in review. Seeing `.terraform.lock.hcl` in the repository only proves provider selections are tracked. A complete dependency review checks both provider lock changes and module source changes.

During a module upgrade, `terraform init -upgrade` may also update provider selections if the provider constraints allow it. The same pull request should include a `.terraform.lock.hcl` review. If provider versions changed unexpectedly, the team should decide whether that belongs in the same upgrade or a separate provider upgrade.

The reproducibility picture therefore has two controls. Registry module revisions come from exact or bounded constraints written in module blocks. Provider revisions come from provider constraints plus the selected versions and hashes committed in `.terraform.lock.hcl`. Deleting the lock file affects provider resolution; it does not remove an exact module version because the module selection was never stored there.

## How Do You Pin Git Modules?
<!-- section-summary: Git module sources use refs, and protected tags or commit hashes are safer pins than moving branches. -->

Git module sources use the `ref` query parameter to choose a branch, tag, or commit.

```hcl
module "network" {
  source = "git::https://github.com/acme/terraform-modules.git//network?ref=v2.4.1"

  environment = "prod"
  cidr_block  = "10.20.0.0/16"
}
```

Tags such as `v2.4.1` are readable and fit a release workflow. Release tags should be protected in the Git hosting system so nobody can move them after release. Commit hashes give the strongest exact pin because one hash names one commit.

Branch refs such as `?ref=main` move as new commits land. They can work for experiments, but production roots usually need tags or commit hashes so reviewers know which code Terraform will download.

Without a `ref`, a Git source follows the repository's default branch. Its text can stay constant while `HEAD` moves from commit A to commit B. That is the same dependency-drift problem as an unconstrained remote module.

A release tag such as `v1.4.2` is readable and can represent one reviewed release if governance keeps it immutable. A full commit SHA identifies one exact Git object and provides the strongest source identity. Branches move routinely; tags are intended to remain fixed but administrators can technically move them; commit IDs select one revision.

If one repository contains several modules, the double slash selects a subdirectory:

```hcl
source = "git::https://github.com/acme/terraform-modules.git//network?ref=v2.4.1"
```

The `network` folder is the module. The `ref` is the code version.

For internal Git modules, protected release tags and a short changelog make review direct. A tag that can move after release weakens the whole pinning story. A protected tag or commit hash lets a later incident review answer exactly which module code production used.

The Registry `version` argument does not apply to a raw Git source. Git revision selection lives in `?ref=`. Git tags also do not automatically become a Registry-style release set: Terraform will not resolve `~> 1.4.0` across repository tags for a plain Git source. It checks out the exact ref named in the URL.

That tradeoff explains part of a module registry's value. A registry gives callers semantic release discovery and constraint solving. Git gives direct repository revision identity. Both can be reproducible, but their configuration and upgrade workflow differ.

## How Do You Upgrade a Module Safely?
<!-- section-summary: A module upgrade should move through changelog review, init, plan, non-production verification, and production approval. -->

A safe module upgrade is a small pull request. One module dependency changes, the release notes get read, `terraform init -upgrade` runs, and the plan shows the infrastructure effect.

Treat the version line as the start of a migration review:

```text
inspect release and migration guidance
        ↓
check Terraform and provider requirements
        ↓
change one module version where practical
        ↓
reinitialize and validate
        ↓
plan and explain every meaningful action
        ↓
test in a lower-risk environment
        ↓
review and apply
```

A module release has two compatibility dimensions. Its API can change—inputs, outputs, defaults, and semantics. Its implementation can also change the resource graph—updates, replacements, additions, removals, address moves, or provider requirements—even when the public API still compiles. Only a plan against existing state reveals the infrastructure transition.

![Module Upgrade Review Loop](/content-assets/articles/article-iac-terraform-modules-versioning/module-upgrade-review-loop.png)

*The upgrade loop shows why shared modules should move through one reviewed version change at a time.*

In staging, the command flow usually has three parts: refresh install selections, save a plan for review, and apply the reviewed plan.

```bash
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```

The `-upgrade` flag tells Terraform to re-check available provider and module versions that match the constraints instead of reusing cached selections. The init output should make version changes visible. Reviewers check the plan summary for creates, updates, deletes, and replacements before approval. A saved plan lets the approved apply use the exact plan reviewers inspected.

`terraform init -upgrade` is not narrowly “upgrade the one module I meant.” It may reconsider modules and providers within all allowed constraints. Inspect installation output, the Git diff, `.terraform.lock.hcl`, and the plan. An unexpected provider selection can obscure the effect of the module change and may deserve a separate pull request.

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

Changing a module, provider, Terraform CLI version, backend, root variables, and resource code together makes causality difficult. An isolated version diff lets reviewers compare the old and new graph with one clear intervention. Small dependency experiments produce better evidence.

Rollback is also a planned change. It starts by restoring the previous version or Git ref, running `terraform init -upgrade`, and inspecting the rollback plan. Sometimes the rollback plan truly reverses the module change. Sometimes the new module already changed live infrastructure in a way that needs a forward fix. The plan tells the team which path is safer.

A production upgrade record should include these artifacts:

1. Old and new module version or Git ref.
2. Link to release notes or a Git compare view.
3. `terraform init -upgrade` output summary.
4. Saved plan summary for the target environment.
5. Non-production verification result and rollback note.

Module maintainers should make that review possible. A useful release documents contract changes, behavior changes, known replacements, provider requirements, state migrations or `moved` blocks, and any manual steps. A Terraform module release is part software API and part infrastructure migration.

## How Do You Evaluate a Shared Module Dependency?
<!-- section-summary: A module is worth adopting if its assumptions, maintenance, testing, and release process match the team's infrastructure standards. -->

Using a shared module means trusting shared code with infrastructure changes. That can be a great trade for common patterns such as VPCs, managed databases, Kubernetes clusters, and storage buckets. It can also create friction if the module's assumptions fight your naming, tagging, security, or network rules.

Adoption review starts with maintenance signals: recent releases, changelogs, examples, tests, upgrade notes, and issue activity. The interface needs a close read too. A good module exposes the choices your team needs and has defaults your team accepts.

Choosing a module also means choosing a dependency owner. Ask who maintains it, whether semantic versioning is used consistently, how breaking changes are communicated, whether provider requirements are sensible, whether releases are immutable, and whether the team can understand the implementation during an incident.

Internal modules fit organization-specific rules: required tags, account layout, observability standards, identity boundaries, compliance controls, and network patterns. Public modules fit widely used building blocks if your requirements match the module's supported shape.

The practical test is whether the module makes the reviewed path clearer. If adopting it requires a fork on day one, a focused internal module may cost less over time.

More abstraction means more inherited decisions. A concise network module call may also adopt the maintainer's choices for routing, NAT, endpoints, flow logs, security groups, and monitoring. A version pin freezes those choices at one release; it does not make them fit your operating model.

The module's assumptions about state and providers matter too. Some modules expect to own many adjacent resources, while your team may split those resources across roots. Some modules create IAM policies or security group rules that need security review. Examples and outputs show whether the module boundary matches the boundary your team wants to operate.

Internal modules deserve the same discipline. A private registry lets the platform team release `5.7.2`, `5.8.0`, and `6.0.0` without silently moving every consumer. Different teams can adopt on their own tested schedules. Versioning decouples the module development lifecycle from each root's deployment lifecycle.

Module upgrades can also change provider constraints. If the root allows only AWS provider 5.x while a new child version requires AWS 6.x, the intersection is empty and Terraform cannot select a compatible plugin. Review child provider requirements before assuming the module version is the only dependency changing.

## How Does the Full Dependency Model Fit Together?
<!-- section-summary: Stable module dependencies come from explicit pins, provider locks, small upgrade pull requests, and plan-based promotion. -->

Module code is infrastructure code, even if it lives in another repository. Local modules follow the repository commit. Registry modules need version constraints. Git modules need stable refs. Provider selections belong in `.terraform.lock.hcl`.

![Versioning Summary Map](/content-assets/articles/article-iac-terraform-modules-versioning/versioning-summary-map.png)

*The summary board gathers the module versioning habits that keep reuse from turning into hidden drift.*

The safe workflow is steady: the team pins the module, upgrades one dependency at a time, runs `terraform init -upgrade`, reviews the plan, tests outside production, and promotes the same version to production after approval.

A realistic root combines several selection systems:

```hcl
terraform {
  required_version = "~> 1.15.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.10.0"
    }
  }
}

module "network" {
  source  = "acme/network/aws"
  version = "3.8.2"

  environment = "prod"
}

module "application" {
  source = "git::https://github.com/acme/terraform-application.git?ref=v5.4.1"

  subnet_ids = module.network.private_subnet_ids
}
```

The Terraform CLI has its own constraint. The AWS provider has a configuration constraint plus an exact selected package and checksums in `.terraform.lock.hcl`. The network child has a Registry identity and exact release. The application child has a Git repository and ref. Terraform retrieves those pieces and builds one infrastructure graph from all their code.

Registry resolution is a compatibility negotiation. If the caller accepts `>= 3.4.0, < 4.0.0` and the registry offers `3.3.0`, `3.4.0`, `3.6.1`, `3.8.0`, and `4.0.0`, the satisfying set is `3.4.0`, `3.6.1`, and `3.8.0`. Terraform selects an acceptable candidate according to its resolution behavior. The constraint defines the permitted set; it is not merely a label attached to one current release.

Provider constraints from children join the same dependency picture. A module can tighten the provider versions compatible with the whole root. The final provider selection must satisfy every applicable constraint, while the lock file records the chosen package. A module upgrade can therefore force a wider dependency review even when the call arguments do not change.

The deepest model is delegated authority. `version = "3.8.2"` says no Registry module change occurs until this line changes. `~> 3.8.0` grants authority to later `3.8.x` releases. `~> 3.8` grants authority to later `3.x` releases. An unpinned Git branch grants authority to whatever commit the moving branch references when retrieved.

That authority acts on infrastructure, so every accepted revision still needs a plan. Semantic versioning describes expected compatibility, but only the caller's state and configuration reveal updates, replacements, or destruction. A version upgrade is safe when both the contract change and the infrastructure migration are understood.

Keep these distinctions explicit:

```text
source → which module
Registry version → which release or allowed release set
Git ref → which repository revision
constraint → which releases are permitted
.terraform.lock.hcl → provider selections and checksums, not module locks
.terraform/modules → local installed copies, not a durable lock
terraform init → install requirements
terraform init -upgrade → reconsider allowed module and provider upgrades
```

Module versioning succeeds when identical committed inputs resolve predictably, upgrades become intentional review events, and the plan explains how new dependency code would change existing infrastructure.

Review module API evolution separately from resource lifecycle evolution. Adding an optional input with a default can preserve existing calls. Removing an output or replacing one input shape with another requires caller migration. Yet an API-compatible release can still rename resource addresses, change defaults, or replace infrastructure. A responsible release documents both surfaces and supplies `moved` blocks or migration instructions where state identity changes.

Rollback deserves the same discipline as upgrade. Restore the previous exact version or Git ref, reinitialize, and inspect the new plan. If the newer module already changed remote infrastructure, returning source code to an older revision may not safely reverse the live migration. The evidence may favor a forward repair instead. A version line is a reproducible code choice, not an automatic undo mechanism.

Fresh environments are the strongest reproducibility test. A clean CI runner should install the same intended module and locked providers as a developer checkout. If a broad module constraint allows a newer release, that movement is within the authority the configuration granted. Teams that want identical fresh resolutions should narrow the constraint or automate dependency-resolution changes as reviewed pull requests with plans.

The operational goal is not to prevent upgrades. It is to make the chosen code, permitted movement, resulting graph, and migration evidence clearly visible before provider APIs change shared systems.

That discipline applies equally to public and internal modules. Ownership inside the same organization does not remove dependency risk; it only gives consumers and maintainers a closer channel for coordinating releases, evidence, testing, rollback planning, and environment-by-environment adoption schedules over time across every actively maintained production root and supporting lower-risk environment.

Pinning a module source makes a reviewed root configuration refer to a known implementation, but upgrades still require a plan because provider behavior, defaults, resources, and outputs can change across versions. Read the module's migration notes, update the constraint or source reference deliberately, initialize the exact dependency, and plan every important caller. Rollback means restoring the earlier module version and reconciling any state or remote changes the newer version already applied; a version string alone cannot reverse an incompatible infrastructure transition.

After changing a module constraint, initialize deliberately and validate the resulting configuration before reviewing a plan. `terraform validate` checks the installed configuration's syntax and internal contracts, but it cannot prove the new implementation preserves remote behavior. The plan, module tests, and an environment-level verification supply that stronger evidence.

## Check Your Answers

:::expand[Why Do Module Versions Matter?]{kind="recap"}
Remote module code can change the resource graph even when the root files do not. Version control makes dependency revisions explicit and keeps upgrades intentional.
:::

:::expand[How Do Module Sources Identify Code?]{kind="recap"}
Local paths follow the containing repository commit, Registry sources pair identity with a version constraint, and Git sources encode repository, subdirectory, and ref.
:::

:::expand[How Do Registry Version Constraints Select Releases?]{kind="recap"}
Constraints define permitted releases. Exact versions allow no movement; bounded and pessimistic ranges grant a chosen patch, minor, or major-family upgrade budget.
:::

:::expand[What Does the Dependency Lock File Actually Lock?]{kind="recap"}
`.terraform.lock.hcl` records exact provider selections and checksums. It does not currently lock remote module selections, and `.terraform/modules` is only a local install cache.
:::

:::expand[How Do You Pin Git Modules?]{kind="recap"}
Use `?ref=` with an immutable protected tag or full commit ID. Branches move, and raw Git sources do not support Registry-style `version` range resolution.
:::

:::expand[How Do You Upgrade a Module Safely?]{kind="recap"}
Review release and migration notes, isolate the version change, reinitialize, inspect provider-lock changes, validate, plan, test outside production, and promote the reviewed revision.
:::

:::expand[How Do You Evaluate a Shared Module Dependency?]{kind="recap"}
Assess maintainership, release discipline, interface, tests, provider requirements, ownership boundary, security behavior, and how much external policy the abstraction makes you inherit.
:::

:::expand[How Does the Full Dependency Model Fit Together?]{kind="recap"}
Terraform CLI, providers, Registry modules, local modules, and Git modules use related but distinct selection controls. Together their selected code forms one managed infrastructure graph.
:::

---

**References**

- [Terraform: Module sources](https://developer.hashicorp.com/terraform/language/modules/configuration) - Documents local, registry, Git, HTTP, and other module source formats.
- [Terraform: Module block](https://developer.hashicorp.com/terraform/language/block/module) - Documents the `source` and `version` arguments used by module callers.
- [Terraform: Version constraints](https://developer.hashicorp.com/terraform/language/expressions/version-constraints) - Explains exact, range, and pessimistic version constraints.
- [Terraform: Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - Documents provider selections and checksums in `.terraform.lock.hcl`.
- [Terraform CLI: init](https://developer.hashicorp.com/terraform/cli/commands/init) - Documents module installation and `-upgrade` behavior during initialization.
- [Terraform Registry: Publishing modules](https://developer.hashicorp.com/terraform/registry/modules/publish) - Documents Registry module release and publishing expectations.

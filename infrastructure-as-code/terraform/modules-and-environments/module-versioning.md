---
title: "Module Versioning"
description: "Pin Terraform modules to specific versions so shared infrastructure updates happen through review."
overview: "Shared Terraform modules are dependencies. This article explains where modules come from, how Registry versions and Git refs work, what `.terraform.lock.hcl` actually locks, and how teams upgrade modules through review."
tags: ["modules", "versioning", "registry", "semver", "terraform"]
order: 3
id: article-iac-terraform-modules-versioning
---

## Table of Contents

1. [Why Module Versioning Matters](#why-module-versioning-matters)
2. [Where Modules Come From](#where-modules-come-from)
3. [The version Argument](#the-version-argument)
4. [Version Constraint Syntax](#version-constraint-syntax)
5. [What the .terraform.lock.hcl File Actually Locks](#what-the-terraformlockhcl-file-actually-locks)
6. [Upgrading a Module Version](#upgrading-a-module-version)
7. [Pinning Modules to Git References](#pinning-modules-to-git-references)
8. [The Upgrade Workflow in Practice](#the-upgrade-workflow-in-practice)
9. [When to Trust a Module and When to Write Your Own](#when-to-trust-a-module-and-when-to-write-your-own)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Module Versioning Matters
<!-- section-summary: Module versioning keeps reusable infrastructure code on a schedule the caller can review and choose. -->

**Module versioning** is dependency control for Terraform modules. When a root configuration calls reusable module code from a Registry or Git repository, that module becomes part of the production change path. A version pin tells Terraform which release or reference the team has reviewed.

Think about the Orders production VPC. The team calls a shared network module that creates subnets, route tables, endpoints, and flow logs. Today the module creates exactly the network shape the team expects. Three months later, the module maintainers publish a new release that changes a default route table behavior and adds a new endpoint by default.

If the production root configuration always downloads the newest module release, a normal `terraform init` can bring in that new code before the team has reviewed it. The next plan may show route and endpoint changes from the dependency rather than the root module diff. Review becomes harder because the real infrastructure change lives outside the pull request.

Versioning fixes that workflow. The root configuration says which module release it accepts. The team upgrades deliberately, reads the changelog, runs a plan, and promotes the change through environments. Shared modules still improve over time, but production only moves when the service team chooses to move.

## Where Modules Come From
<!-- section-summary: Module source type decides how Terraform downloads the module and which versioning controls are available. -->

A **module source** is the location Terraform reads module code from. Local modules come from the filesystem. Registry modules come from the public Terraform Registry, HCP Terraform private registries, Terraform Enterprise private registries, or compatible private registry services. Git modules come from version control repositories.

![Terraform module sources flow from local paths, registries, and Git refs into a root module call.](/content-assets/articles/article-iac-terraform-modules-versioning/module-source-decision.png)

*The source type controls the pinning method: local files follow the repository, Registry modules use `version`, and Git modules use `ref`.*

Local modules look like this:

```hcl
module "artifact_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "dp-orders-artifacts-prod"
  environment = "prod"
}
```

Local paths work well when the module and the root configuration live in the same repository and ship together. The version is the Git commit of the repository itself. If a pull request changes both `envs/prod` and `modules/private-bucket`, reviewers see the caller and the module change in one diff.

Registry modules use a source address with namespace, module name, and provider. They support the `version` argument, which is the cleanest versioning experience for reusable modules that many roots consume.

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "orders-prod"
  cidr = "10.20.0.0/16"
}
```

Git modules use a repository URL and optional subdirectory. They pin through a `ref` query parameter, which can point at a tag, branch, or commit hash.

```hcl
module "network" {
  source = "git::https://github.com/devpolaris/terraform-modules.git//network?ref=v2.4.1"

  environment = "prod"
  cidr_block  = "10.20.0.0/16"
}
```

Those source choices are operational choices. A local module favors fast same-repo changes. A private Registry favors discovery, documentation, version constraints, and repeatable releases. A Git source can work well for internal modules, especially when the team already has a strong tag and release process.

## The version Argument
<!-- section-summary: Registry module calls use the version argument to select the release Terraform may install. -->

The **`version` argument** selects an allowed release for a Registry module. It belongs inside the `module` block and only works for modules installed through a Registry protocol. Terraform reads the source and version during `terraform init`, then downloads a matching module package.

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

With `version = "5.21.0"`, the production root asks for that exact module release. Another engineer setting up a fresh checkout receives the same module release when they run `terraform init`. CI receives the same module release too. That consistency is exactly what production infrastructure needs.

A Registry module call without a `version` argument gives Terraform permission to select the newest available release that satisfies the source. That may feel convenient during a demo, but it weakens review in long-lived infrastructure. The same root configuration can install different module code at different times.

For production, the habit is simple: **every remote Registry module call should have a version constraint**. The version line turns a floating dependency into a reviewable dependency.

## Version Constraint Syntax
<!-- section-summary: Version constraints choose between strict stability and controlled automatic patch or minor updates. -->

A **version constraint** is a rule that describes which releases Terraform may install. The right rule depends on the team's appetite for automatic updates. Some teams want exact pins for maximum repeatability. Other teams allow patch updates while blocking larger jumps.

Here are the common patterns:

| Constraint | Meaning | Production use |
|---|---|---|
| `"5.21.0"` | Exactly version 5.21.0 | Strong repeatability, every update is explicit |
| `">= 5.21.0, < 6.0.0"` | Any 5.x release from 5.21.0 upward | Allows minor and patch updates inside one major line |
| `"~> 5.21"` | 5.21 or newer, up to but excluding 6.0 | Allows minor releases in the 5.x line |
| `"~> 5.21.0"` | 5.21 patch releases only | Allows patch fixes while blocking 5.22 and 6.0 |

The `~>` operator is called the **pessimistic constraint operator**. It gives Terraform a lower bound and a calculated upper bound. Teams often use `"~> 5.21.0"` when they want patch releases automatically but want a human review for each minor release.

Semantic versioning helps explain the tradeoff. A major version change, such as 5 to 6, may include breaking changes. A minor version change, such as 5.21 to 5.22, can add behavior or new defaults. A patch change, such as 5.21.0 to 5.21.1, usually carries bug fixes. Real modules sometimes vary in how strictly they follow semver, so the plan and changelog still matter.

Open-ended constraints such as `">= 5.21.0"` create avoidable risk in production because the next major version also satisfies the rule. A future fresh `terraform init` could install a release with breaking behavior. A bounded constraint gives the team a guardrail.

## What the .terraform.lock.hcl File Actually Locks
<!-- section-summary: The dependency lock file records provider selections, while module versions still need explicit pins. -->

The `.terraform.lock.hcl` file is a provider dependency lock file. It records selected provider versions and checksums so future Terraform runs can install the same provider packages by default. Teams should commit it because provider upgrades are real infrastructure dependency changes.

The lock file pins provider selections. Terraform's official dependency lock documentation states that the lock file currently tracks only providers, and Terraform selects the newest remote module version that matches the module version constraint. That means the module block still needs its own exact version or bounded version constraint.

Here is a simplified lock entry:

```hcl
provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.46.0"
  constraints = "~> 6.0"
  hashes = [
    "h1:example",
  ]
}
```

The entry talks about `hashicorp/aws`, which is a provider plugin. Module packages such as `terraform-aws-modules/vpc/aws` need their own version pins in module blocks or Git refs. A complete production dependency story usually has both pieces: provider selections committed in `.terraform.lock.hcl` and module versions pinned in source configuration.

This distinction prevents a common false sense of safety. A reviewer may see `.terraform.lock.hcl` in version control and assume all Terraform dependencies are locked. The module source still controls module code selection, so the review should check both places.

## Upgrading a Module Version
<!-- section-summary: A module upgrade should move through changelog review, init, plan, non-production verification, and production approval. -->

A **module upgrade** changes reusable infrastructure code under a root configuration. Treat it with the same care as changing your own `.tf` files because the module can add resources, change defaults, rename internal resources, or alter lifecycle behavior.

![A safe Terraform module upgrade follows changelog review, one version change, init upgrade, plan review, test apply, and production approval.](/content-assets/articles/article-iac-terraform-modules-versioning/module-upgrade-review-loop.png)

*A controlled upgrade keeps the dependency change small enough for reviewers to understand and rollback if needed.*

The Orders team upgrades one module at a time. If the VPC module moves from `5.21.0` to `5.22.0`, the pull request changes only that module version and any required caller inputs. The reviewer can read the module changelog, compare the plan, and connect every proposed infrastructure change to that one dependency update.

The command sequence usually looks like this in a staging root:

```shell
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```

The `-upgrade` flag tells Terraform to re-evaluate version constraints and install newer matching provider or module packages instead of reusing cached selections. The saved plan file gives the team one reviewed artifact for the apply. In CI, many teams split this into pull request plan evidence and a protected apply job after approval.

If the plan shows an unexpected replacement or deletion, the team backs out the version change and investigates before applying. A module upgrade is easy to revert in Git when the pull request changes one dependency at a time. It becomes much harder when five module upgrades, a provider upgrade, and several root configuration changes land together.

## Pinning Modules to Git References
<!-- section-summary: Git module sources use refs, and protected tags or commit hashes are safer pins than moving branches. -->

A **Git ref** tells Terraform which Git target to download for a module source. The `ref` query parameter can point at a branch, tag, or commit hash. The source can also include a subdirectory after a double slash when one repository contains several modules.

```hcl
module "network" {
  source = "git::https://github.com/devpolaris/terraform-modules.git//network?ref=v2.4.1"

  environment = "prod"
  cidr_block  = "10.20.0.0/16"
}
```

Release tags such as `v2.4.1` are readable and fit the same release workflow teams already use for application libraries. The tag should be protected in the Git hosting platform so nobody can move it after release. A movable tag breaks the promise that the same ref always means the same code.

Commit hashes give the strongest pin because they identify one exact commit. They are less friendly for humans to read, but they are excellent when a regulated environment needs a precise source revision. A pull request can still include a link to the release notes or tag that corresponds to the commit.

Branch refs such as `?ref=main` change as commits land. They can be acceptable for local experiments or short-lived development roots. Production roots usually need tags or commit hashes because reviewers need a stable target.

## The Upgrade Workflow in Practice
<!-- section-summary: The safest upgrade workflow changes one module dependency, reads evidence, and promotes the same version through environments. -->

The Orders team's workflow is deliberately plain because plain workflows survive busy weeks. A module upgrade starts in development or staging first. The pull request changes one module version or Git ref and includes a link to the upstream release notes.

The review checklist has a few questions:

| Review question | Why it matters |
|---|---|
| Which module changed? | Keeps the blast radius clear |
| Which version did it move from and to? | Makes rollback obvious |
| What does the changelog say? | Shows expected behavior changes |
| What does the plan change? | Shows real infrastructure impact |
| Did non-production apply and verification pass? | Proves the change in a safer environment |
| Did provider selections change too? | Catches `.terraform.lock.hcl` changes caused by init |

After staging passes, the team promotes the same module version to production. They keep production on the exact dependency that staging already tested. That discipline gives the staging result real meaning.

Rollback is also a dependency workflow. If the new module release causes trouble, the team restores the previous version or Git ref, runs `terraform init -upgrade`, and reads the rollback plan. Sometimes rollback means changing code back. Sometimes the new module changed infrastructure in a way that needs a forward fix. The plan decides which path is safe.

## When to Trust a Module and When to Write Your Own
<!-- section-summary: A module is worth adopting when its assumptions, maintenance, testing, and release process match the team's infrastructure standards. -->

Using a public or shared module means trusting someone else's Terraform code to change your infrastructure. That can be a good trade when the module handles a common pattern well. It can become expensive when the module's assumptions fight the team's naming, security, tagging, or network rules.

Before adopting a module, the platform team reviews maintenance signals. Recent releases, clear changelogs, issue activity, examples, tests, and documented upgrade notes all matter. A module used by many teams can carry years of edge-case knowledge, and the team still checks whether its assumptions fit the organization.

The team also checks the interface. A good module exposes the knobs your service actually needs and gives safe defaults for common behavior. A module that requires a fork on day one is already a custom module with extra steps. Maintaining the fork can cost more than writing a focused internal module.

Public modules fit best for standard building blocks such as VPCs, managed databases, Kubernetes clusters, or storage buckets when the team's requirements match the module's supported patterns. Internal modules fit better for organization-specific rules: custom tagging, strict network topology, compliance controls, observability conventions, account vending, and identity boundaries.

The practical question is: **does this module make the reviewed path simpler?** If the answer is yes, pin it and upgrade it deliberately. If the module hides too much or forces too many exceptions, a small internal module may give the team a cleaner contract.

## Putting It All Together
<!-- section-summary: Stable module dependencies come from explicit pins, provider locks, small upgrade pull requests, and plan-based promotion. -->

Module versioning gives shared Terraform code a reviewable lifecycle. Local modules follow the repository commit. Registry modules use the `version` argument. Git modules use `ref`. Provider selections belong in `.terraform.lock.hcl`, while module selections belong in each module source configuration.

![Terraform module versioning summary with source types, pinning methods, lock file scope, and upgrade workflow.](/content-assets/articles/article-iac-terraform-modules-versioning/versioning-summary-map.png)

*A complete module dependency workflow pins module code, locks providers, and upgrades one reviewed dependency at a time.*

The Orders team treats a module upgrade like any other production infrastructure change. They review release notes, update one dependency, run `terraform init -upgrade`, inspect the plan, test outside production, and then promote the same version with approval. That workflow keeps shared module improvements moving without letting unreviewed dependency changes surprise production.

The main rule is worth repeating: **module code is infrastructure code, even when it lives in another repository**. Pin it, review it, test it, and upgrade it with evidence.

## What's Next

The next article looks at module design: how to keep modules focused, how to avoid hidden dependencies, how outputs become the public interface, and why flatter module composition usually gives teams a better review experience.

---

**References**

- [Module Sources (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/configuration), Details on local paths, Registry sources, Git sources, subdirectories, and source installation.
- [Module Block Reference (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/block/module), Reference for the `source` and `version` arguments and module installation behavior.
- [Version Constraints (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/version-constraints), Full reference for exact, range, and pessimistic version constraints.
- [Dependency Lock File (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/files/dependency-lock), Official explanation that `.terraform.lock.hcl` currently tracks provider dependencies while module pins live in module source configuration.
- [Terraform Registry: Modules](https://registry.terraform.io/browse/modules), Public Registry catalog for Terraform modules.

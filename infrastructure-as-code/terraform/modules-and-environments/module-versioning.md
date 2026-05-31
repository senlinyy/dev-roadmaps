---
title: "Module Versioning"
description: "Pin Terraform modules to specific versions so that your infrastructure does not change unexpectedly when module authors release updates."
overview: "When you use a module from the Terraform Registry or a Git repository, you need to decide which version of that module to use and what happens when new versions come out. This article covers how module versioning works, how to set version constraints, and how to safely upgrade modules over time."
tags: ["modules", "versioning", "registry", "semver", "terraform"]
order: 3
id: article-iac-terraform-modules-versioning
---

## Table of Contents

1. [Why Module Versioning Matters](#why-module-versioning-matters)
2. [Where Modules Come From](#where-modules-come-from)
3. [The version Argument](#the-version-argument)
4. [Version Constraint Syntax](#version-constraint-syntax)
5. [What the .terraform.lock.hcl File Does Not Lock](#what-the-terraformlockhcl-file-does-not-lock)
6. [Upgrading a Module Version](#upgrading-a-module-version)
7. [Pinning Modules to Git References](#pinning-modules-to-git-references)
8. [The Upgrade Workflow in Practice](#the-upgrade-workflow-in-practice)
9. [When to Trust a Module and When to Write Your Own](#when-to-trust-a-module-and-when-to-write-your-own)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Module Versioning Matters

Module versioning is dependency control for reusable Terraform modules, pinning callers to a reviewed module release or Git reference.

Suppose you are using a community Terraform module to create a VPC. Today the module creates the VPC the way you expect. Six months from now, the module author publishes a new version that changes the default value of an attribute, maybe they change the default tenancy from `default` to `dedicated`. If your configuration has no version constraint, the next time anyone on your team runs `terraform init`, they download the new version. The next `terraform plan` shows a change to the tenancy attribute. If someone applies that plan without reading it carefully, the VPC tenancy changes. That can have unexpected cost implications.

This is the core problem with unversioned dependencies: other people's changes affect your infrastructure on a schedule you do not control. The solution is the same one used in application development: pin your dependencies to specific versions and update them deliberately, one at a time, after reviewing what changed.

Module versioning lets you say: "I want version 3.2.0 of this VPC module. Tell me when I try to use anything newer." Changes only happen when you decide to upgrade, and you review the module's changelog before doing so.

## Where Modules Come From

A module source is the place Terraform gets reusable module code from. The source can be the Terraform Registry, a Git repository, a private registry, or a local directory. Example: `terraform-aws-modules/vpc/aws` comes from the public Registry, while `./modules/network` comes from the current repository.

Terraform modules can come from several sources, and the versioning options depend on which source you use.

![Module sources and version constraints decide which reusable module code Terraform downloads for a root call.](/content-assets/articles/article-iac-terraform-modules-versioning/module-source-version-flow.png)

**The Terraform Registry** is the default public source for community modules. You reference a Registry module with a three-part path: `namespace/module_name/provider`. A widely used community AWS VPC module is `terraform-aws-modules/vpc/aws`. Registry modules support version constraints using the `version` argument. In Azure, Microsoft also publishes Azure Verified Modules, which are Microsoft-aligned reusable modules with documented quality and support expectations.

**Git repositories** are a common source for internal modules that your organization writes and maintains. You reference a Git module using the full repository URL or an abbreviated GitHub format. You can pin to a specific commit hash, branch name, or Git tag using the `ref` query parameter.

**Local paths** (starting with `./` or `../`) reference modules in the same repository or filesystem. Local path modules do not support versioning because the module changes whenever the local file changes. This is usually the right approach for modules you manage alongside the configuration that calls them.

**Private Registries** work identically to the public Terraform Registry from the caller's perspective. HashiCorp's HCP Terraform platform and other enterprise tools support private registries where you can publish internal modules with the same versioning semantics as the public registry.

## The version Argument

The `version` argument pins a Registry module call to an allowed release. It is the module equivalent of choosing a package version in application code. Example: `version = "5.1.2"` means Terraform should download exactly release `5.1.2` of that Registry module.

For Registry modules, you add a `version` argument to the module block:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.2"

  name = "main-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.4.0/24", "10.0.5.0/24", "10.0.6.0/24"]
}
```

`version = "5.1.2"` pins this module call to exactly version 5.1.2. When you run `terraform init`, Terraform downloads that specific version and stores it in the `.terraform/modules/` directory. Everyone on your team who runs `terraform init` gets the same version.

If you do not include the `version` argument at all, Terraform downloads the latest available version. This is almost never what you want in a production configuration. The first time you run it, you get version 5.1.2. A year later, when a colleague sets up a fresh workspace, they might get version 6.0.0. If 6.0.0 has breaking changes, the configuration breaks for them. Always specify a version.

## Version Constraint Syntax

A version constraint is a rule for which module releases are acceptable. Exact pins give maximum stability, while ranges allow selected updates. Example: `"~> 5.1.2"` allows `5.1.x` patch releases but blocks `5.2.0` and `6.0.0`.

Pinning to an exact version (`"5.1.2"`) is the most conservative approach but requires you to manually update the version number any time you want the latest bug fixes. Terraform's version constraint syntax lets you express more flexible rules.

**Exact version**: `"5.1.2"`, only use this exact version.

**Minimum version**: `">= 5.1.2"`, use 5.1.2 or anything newer. This is rarely what you want for modules because it has no upper bound.

**Version range**: `">= 5.1.2, < 6.0.0"`, use any version from 5.1.2 up to (but not including) 6.0.0.

**Pessimistic constraint**: `"~> 5.1"`, use any version in the 5.x series, but do not jump to 6.x. This is equivalent to `">= 5.1, < 6.0"`.

**Pessimistic constraint on patch**: `"~> 5.1.2"`, use 5.1.2 or any 5.1.x patch release, but do not move to 5.2.0. This is equivalent to `">= 5.1.2, < 5.2.0"`.

The pessimistic constraint operator `~>` is particularly useful because it aligns with semantic versioning (semver). Under semver, a major version change (5 to 6) may have breaking changes. A minor version change (5.1 to 5.2) adds new features but should not break existing ones. A patch change (5.1.2 to 5.1.3) only fixes bugs.

Using `~> 5.1` allows the module to receive minor version improvements and bug fixes automatically, while protecting you from major version breaking changes. Using `~> 5.1.2` is more conservative, you only get patch-level bug fixes automatically, and you explicitly upgrade to each minor version.

In practice, the most common patterns in production configurations are:
- Exact pins (`"5.1.2"`) for configurations that should only change when someone explicitly decides to upgrade.
- Pessimistic patch constraints (`"~> 6.1.2"`) for configurations that want automatic bug fixes but not feature changes.

Avoid open-ended constraints like `">= 6.0"` in production. The day a major breaking version is released, the next `terraform init` from a fresh workspace could download it and break things.

## What the .terraform.lock.hcl File Does Not Lock

`.terraform.lock.hcl` locks provider selections, not Registry module selections. Module versions still need to be pinned in each `module` block or Git `ref`. Example: committing `.terraform.lock.hcl` can lock `hashicorp/aws`, but it will not pin `terraform-aws-modules/vpc/aws` unless the module block has a `version`.

When you run `terraform init`, Terraform resolves provider version constraints and writes the exact provider versions and checksums to `.terraform.lock.hcl`. This file is a provider dependency lock file. It does not lock Registry module versions.

Here is the kind of provider entry the lock file contains:

```hcl
# This file is maintained automatically by "terraform init".
# Manual edits may be lost in future updates.

provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.46.0"
  constraints = "~> 6.0"
  hashes = [
    "h1:abc123...",
  ]
}
```

Notice that the example is a `provider` entry, not a `module` entry. Registry module versions are controlled by the `version` argument in the `module` block. Git module versions are controlled by the `ref` query parameter. Local module versions are controlled by the files in your repository.

The important thing is still to commit `.terraform.lock.hcl` to version control for provider consistency. Just do not rely on it to pin modules. Pin modules explicitly in the module source configuration.

## Upgrading a Module Version

A module upgrade changes reusable infrastructure code that your root configuration depends on. Treat it like changing your own Terraform code because it can alter resources, defaults, and internal behavior. Example: upgrade the VPC module in staging first, read the plan, then promote the same version change to production after verification.

When a new version of a module is released, upgrading is a deliberate, reviewable process.

![A safe module upgrade moves through changelog review, plan diff, tests, and approval before apply.](/content-assets/articles/article-iac-terraform-modules-versioning/upgrade-review-path.png)

First, check the module's changelog or release notes for the new version. Most well-maintained modules publish changelogs that describe what changed, which attributes were renamed, which defaults changed, and whether any breaking changes are included.

Second, update the version constraint in your module block:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.2.0"  # previously 5.1.2
  ...
}
```

Third, run `terraform init -upgrade` to download the new version. The `-upgrade` flag tells Terraform to re-evaluate all version constraints and download the newest matching version, ignoring the cached versions in `.terraform/modules/`. Without `-upgrade`, `terraform init` reuses whatever is already in `.terraform/modules/` if the existing version still satisfies the constraints.

Fourth, run `terraform plan` and review the output carefully. A module version change can produce a plan with many more changes than you expected, the module might now tag resources differently, use different resource types internally, or have new default values for attributes you did not explicitly set.

Fifth, apply the plan if it looks correct. If the plan shows unexpected changes that concern you, roll back the version constraint and investigate before proceeding.

Never upgrade multiple modules at the same time. Upgrading one module at a time means that if a problem appears, you know exactly which module caused it. Upgrading five modules at once and then seeing an unexpected resource replacement in the plan leaves you guessing which module introduced the change.

## Pinning Modules to Git References

A Git reference is the exact Git target Terraform should download for a module. Tags and commit hashes are stable choices; branches move over time. Example: `?ref=v2.3.1` pins a module to a release tag, while `?ref=main` can change whenever someone merges to main.

For modules stored in Git repositories, versioning works differently. Instead of a version number, you pin to a Git reference: a tag, a branch name, or a specific commit hash.

```hcl
module "network" {
  source = "git::https://github.com/myorg/terraform-modules.git//network?ref=v2.3.1"

  region     = var.region
  cidr_block = var.cidr_block
}
```

The `?ref=v2.3.1` at the end pins to the Git tag `v2.3.1`. When the module author pushes a new version, they create a new tag. You update the `ref` parameter to upgrade.

Git branches are not stable version pins, the content at `?ref=main` changes every time someone commits to main. Release tags are usually a better human-readable choice than branches, but a Git tag is only as stable as the repository's protections and team process. Git allows tags to be moved or replaced unless your hosting platform and permissions prevent that. If you need the strongest pin, use a commit hash.

A commit hash (`?ref=abc1234567890...`) is the most stable reference possible. A commit hash identifies a specific state of the code. Some teams use commit hashes for the highest level of stability, at the cost of making it less obvious which version they are running. A protected tag like `v2.3.1` is easier for humans to read, but it depends on tag protection and release discipline.

The double slash in the URL (`//network`) separates the repository URL from the subdirectory within the repository. If your modules are organized as separate top-level directories in one repository, `terraform-modules.git//network`, `terraform-modules.git//database`, `terraform-modules.git//compute`, you reference each module by pointing to its subdirectory.

## The Upgrade Workflow in Practice

A safe upgrade workflow makes the module change visible, testable, and reversible. The key idea is to change one module version at a time and let the plan show exactly what that module changed. Example: update only the network module, run `terraform init -upgrade`, review the staging plan, and avoid mixing the change with a database module upgrade.

Here is the full workflow a team should follow when upgrading a module:

```
1. Check the module's releases page or changelog for what changed in the new version.
2. Update the version constraint in the module block in your configuration.
3. Run `terraform init -upgrade` to download the new version.
4. Run `terraform plan` and read the full output carefully.
5. If the plan looks correct, apply it in a non-production environment first.
6. Verify everything works correctly in the non-production environment.
7. Apply the same change in production.
8. Commit the updated module version constraint. Also commit `.terraform.lock.hcl` if the upgrade changed provider selections or checksums.
```

The non-production-first approach is important. A module upgrade is a change to your infrastructure. Like any other infrastructure change, it should be tested before it reaches production. Even if the module changelog says "no breaking changes," the plan might reveal that the module now creates a resource that conflicts with something in your account, or removes a tag that your monitoring system depends on.

## When to Trust a Module and When to Write Your Own

Trusting a module means trusting someone else's Terraform code to create and change your infrastructure. Use a public module when its assumptions match your needs and its maintenance quality is clear. Example: a standard VPC module may be worth adopting, while a module that conflicts with your organization's tagging and network rules is usually better written internally.

Public modules on the Terraform Registry vary widely in quality and stability. Before adopting a module, evaluate it on a few dimensions.

**Maintenance**: Is the module actively maintained? Does it have recent commits and a responsive issue tracker? A module that has not been updated in two years might not support recent AWS features or Terraform versions.

**Popularity**: How many downloads and stars does it have? A module used by tens of thousands of teams has been stress-tested across many environments and configurations.

**Test coverage**: Does the module have automated tests? The best public modules run automated tests that verify the module works correctly across multiple scenarios.

**Customizability**: Does the module expose enough input variables for your use case? If you have to fork the module to make it fit your needs, you are better off writing your own from the start.

For simple, well-understood resources, creating a VPC with standard settings, creating an S3 bucket with standard encryption, a well-maintained community module is often better than writing your own. The community has already handled the edge cases and compatibility issues.

For resources with complex, organization-specific requirements, custom tagging schemes, non-standard network layouts, proprietary compliance controls, writing your own module gives you full control and avoids fighting against a community module's assumptions.

The guideline is: use a community module when it fits your use case well, fork nothing, write your own when the requirements are genuinely organization-specific.

## Putting It All Together

Module versioning keeps your infrastructure stable. When you pin a module to a specific version, updates to that module do not affect your infrastructure until you explicitly decide to upgrade. When you do upgrade, you follow a deliberate process: check the changelog, run `terraform init -upgrade`, review the plan, test in a non-production environment, then apply to production.

The version constraint syntax gives you flexibility in how tightly you pin. Exact pins give the strongest stability guarantee. Pessimistic constraints allow automatic patch-level fixes while protecting against major breaking changes.

The `.terraform.lock.hcl` file, committed to version control, ensures every member of your team and every run of your CI/CD pipeline uses the same provider versions. Module versions are pinned separately in `module` blocks or Git `ref` values, so a stable Terraform dependency story needs both: provider locks and explicit module version pins.

## What's Next

You now know how to call modules, wire their inputs and outputs, and keep them pinned to specific versions. The next article covers how to design modules that are genuinely reusable, how to decide what should be a variable, how to make modules composable, and what makes the difference between a module that works for one team and one that works for many.


![Module versioning summary: pin versions, choose sources carefully, review upgrades, and lock providers separately.](/content-assets/articles/article-iac-terraform-modules-versioning/module-versioning-summary.png)

---

**References**

- [Module Sources (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/sources), Complete reference for all supported module sources including Registry, Git, and local paths.
- [Version Constraints (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/version-constraints), Full reference for the version constraint syntax including the pessimistic constraint operator.
- [Dependency Lock File (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/files/dependency-lock), Official reference for what `.terraform.lock.hcl` records for providers.
- [Terraform Registry: Modules](https://registry.terraform.io/browse/modules), Browse publicly available Terraform modules across all providers.
- [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/), Microsoft-backed catalog and guidance for Azure Verified Modules.

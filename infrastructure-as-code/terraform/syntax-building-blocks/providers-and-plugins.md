---
title: "Providers, Versions, and the Lock File"
description: "Learn how provider dependencies, configurations, aliases, constraints, checksums, and the dependency lock file connect Terraform Core to remote APIs reproducibly."
overview: "Terraform Core delegates platform-specific behavior to provider plugins. Learn to separate provider source identity, compatible version policy, the exact locked selection, configured runtime instances, aliases, module requirements, initialization, and deliberate upgrades."
tags: ["terraform", "providers", "versions", "lock-file"]
order: 2
id: article-iac-terraform-foundations-providers-plugins
aliases:
  - infrastructure-as-code/terraform/foundations/providers-and-plugins.md
---

## Table of Contents

1. [Why Does Terraform Core Need Provider Plugins?](#why-does-terraform-core-need-provider-plugins)
2. [How Do Requirements, Local Names, Source Addresses, and Configurations Differ?](#how-do-requirements-local-names-source-addresses-and-configurations-differ)
3. [How Do Provider Version Constraints Define Compatibility?](#how-do-provider-version-constraints-define-compatibility)
4. [Why Does Terraform Need a Dependency Lock File?](#why-does-terraform-need-a-dependency-lock-file)
5. [What Does terraform init Do with Providers?](#what-does-terraform-init-do-with-providers)
6. [How Do Default and Aliased Provider Configurations Select Targets?](#how-do-default-and-aliased-provider-configurations-select-targets)
7. [How Should Modules and Teams Manage Provider Upgrades?](#how-should-modules-and-teams-manage-provider-upgrades)
8. [How Does the Full Provider Dependency Chain Fit Together?](#how-does-the-full-provider-dependency-chain-fit-together)
9. [Check Your Answers](#check-your-answers)

Terraform Core cannot contain complete knowledge of every cloud, SaaS product, database, DNS service, identity platform, and API. Core understands general infrastructure-management concepts:

```text
configuration
expressions and dependencies
state and resource identity
planning
applying
```

It does not inherently know how an EC2 instance is created, which Cloudflare API manages a DNS record, how GitHub authentication works, which attributes an Azure virtual network exposes, or whether a provider-specific property can update in place.

A **provider** supplies that platform-specific layer. Providers are plugins released separately from Terraform Core. They contribute resource types and data sources, define schemas, validate arguments, authenticate to remote systems, refresh existing objects, translate planned lifecycle actions into API calls, and return computed values.

```text
Terraform configuration
        ↓
Terraform Core
generic graph and lifecycle protocol
        ↓
provider plugin
platform-specific behavior
        ↓
remote API
```

For this configuration:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

Keep these questions in view as you work through the lesson:

1. **Why Does Terraform Core Need Provider Plugins?**
2. **How Do Requirements, Local Names, Source Addresses, and Configurations Differ?**
3. **How Do Provider Version Constraints Define Compatibility?**
4. **Why Does Terraform Need a Dependency Lock File?**
5. **What Does terraform init Do with Providers?**
6. **How Do Default and Aliased Provider Configurations Select Targets?**
7. **How Should Modules and Teams Manage Provider Upgrades?**
8. **How Does the Full Provider Dependency Chain Fit Together?**

## Why Does Terraform Core Need Provider Plugins?
<!-- section-summary: Terraform Core owns general reconciliation logic, while independently released providers understand platform-specific schemas, lifecycle rules, authentication, and APIs. -->

Core can reason that the desired graph includes `aws_instance.web`. The AWS provider understands what the `aws_instance` type means, which EC2 API calls are relevant, what each argument supports, what remote attributes should be refreshed, and which edits require replacement.

This separation allows Core and providers to evolve independently. AWS can add or change services without requiring every platform-specific update to wait for a new Terraform Core release. It also lets the same Core workflow manage AWS, Azure, GitHub, Cloudflare, Kubernetes, Datadog, and other systems through different plugins.

![Terraform provider boundary showing configuration and Core on one side, a provider plugin in the middle, and platform APIs on the other](/content-assets/articles/article-iac-terraform-foundations-providers-plugins/provider-plugin-boundary.png)

*Providers extend Terraform's generic reconciliation engine with the vocabulary and behavior of particular remote systems.*

Once provider behavior lives outside Core, provider software becomes a dependency. Terraform must know which provider project is meant, which versions are compatible, which exact package the team selected, and how each runtime instance should connect. The rest of the article derives those four answers.

## How Do Requirements, Local Names, Source Addresses, and Configurations Differ?
<!-- section-summary: Requirements identify provider software and compatible versions, while provider blocks configure runtime instances of that software. -->

Every module should declare the providers it depends on:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.3.0"
    }
  }
}
```

Read this as a software dependency declaration:

```text
module-local provider name: aws
global provider source:     hashicorp/aws
acceptable version set:     ~> 6.3.0
```

It does not select an AWS region, account, role, or credentials. Those runtime choices belong to a provider configuration:

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

The distinction is similar to requiring a client library versus configuring a client instance to connect to one endpoint:

```text
required_providers
= which provider software does this module need?

provider "aws" { ... }
= how should one configured instance operate?
```

The two must remain separate because one provider implementation can be configured several ways. Infrastructure in London and Virginia does not require two AWS binaries. It requires one selected `hashicorp/aws` implementation and two runtime configurations with different regions.

The requirement contains two kinds of name. `aws` is local to the module. It appears in `provider "aws"`, resource-type conventions, and references such as `aws.virginia`. `hashicorp/aws` is the globally meaningful provider source address. Its full form is `registry.terraform.io/hashicorp/aws`, with the default registry hostname omitted in normal configuration.

Provider source addresses follow a hostname, namespace, and type model. Namespaces distinguish two organizations that both publish a provider with the same short type. A private provider might use an address such as `terraform.example.com/acme/database`. The source answers “which software project?” while the local name gives that dependency a concise name inside the module.

Conventional local names help Terraform infer the provider for a resource from its type prefix. The resource type `aws_instance` normally uses the local provider named `aws`. An unusual local name is possible in some designs but may require more explicit provider association and makes common configuration harder to read.

Keeping the concepts separate prevents several mistakes:

- `required_providers` does not authenticate to AWS;
- `provider "aws"` does not declare which plugin source should be installed;
- `aws` is not the provider's complete global identity;
- multiple provider blocks do not imply multiple plugin versions.

This separation also explains why requirements belong in every module. A child module cannot assume that the root's short name automatically gives the child a complete dependency declaration. The child states the source address and compatibility it needs; the root participates in selecting a single provider version and supplies usable configurations through the module hierarchy.

Source addresses solve the same ambiguity that namespaces solve in other package ecosystems. A short type such as `database` is not globally unique. `company-a/database`, `company-b/database`, and `terraform.example.com/acme/database` can identify different provider projects. The source address remains meaningful outside one module, while the local name can stay concise and conventional inside it.

A provider block is also different from credentials themselves. It may contain a region, endpoint, profile, assumed-role configuration, or other connection settings, but secure authentication can arrive through the provider's supported environment or workload identity mechanisms. The provider block creates a configuration object; it should not be interpreted as permission to hard-code long-lived secrets.

## How Do Provider Version Constraints Define Compatibility?
<!-- section-summary: A version constraint describes the set of provider releases a configuration accepts, not necessarily the exact release installed. -->

Provider versions affect resource schemas, defaults, validation, computed attributes, API behavior, deprecations, and replacement rules. If identical `.tf` files use different provider implementations, they can validate or plan differently. A module therefore declares which versions it considers compatible.

An exact constraint selects one acceptable release:

```hcl
version = "= 6.3.2"
```

An inequality defines a wider set:

```hcl
version = ">= 6.3.0, < 7.0.0"
```

The value means every version at least `6.3.0` and lower than `7.0.0` is acceptable. Terraform still needs to choose one concrete member of that set.

The pessimistic operator is common and must be read carefully:

```hcl
version = "~> 6.3.0"
```

This permits versions from `6.3.0` up to, but excluding, `6.4.0`. Patch releases such as `6.3.1` and `6.3.9` may qualify. By contrast:

```hcl
version = "~> 6.3"
```

permits versions from `6.3.0` up to, but excluding, `7.0.0`. Omitting the patch component creates a much wider allowed range.

Think of a constraint as policy over a version set:

```text
Allowed = { provider releases satisfying every configured constraint }
```

Terraform must select one `v` from `Allowed`. If no version satisfies all constraints from the module tree, initialization fails rather than picking incompatible provider software.

Constraints alone do not make fresh installations reproducible. Suppose `~> 6.3.0` permits `6.3.2` today and `6.3.8` next month. The configuration text has not changed, but the newest acceptable version has. Terraform therefore separates “which versions could work?” from “which exact version did this working directory and team choose?”

## Why Does Terraform Need a Dependency Lock File?
<!-- section-summary: Version constraints express compatibility policy, while the lock file records one selected provider release and trusted package checksums. -->

Terraform writes its concrete provider selections to `.terraform.lock.hcl`. The relationship is:

```text
required_providers constraint
= acceptable releases

.terraform.lock.hcl
= selected acceptable release
```

If `~> 6.3.0` permits a family of versions, a simplified lock entry may record:

```hcl
provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.3.2"
  constraints = "~> 6.3.0"

  hashes = [
    "...",
    "...",
  ]
}
```

`version` is the selected provider release. `constraints` records relevant selection constraints. `hashes` records acceptable package checksums.

The checksum list solves a second reproducibility and integrity problem. A version number says which release is expected, but a corrupted package, untrusted mirror, or substituted binary could claim the same version. Terraform compares downloaded provider packages with the recorded hashes and stops when the package does not match a trusted checksum.

The lock file therefore supports both exact provider selection and package verification. It should normally be committed with configuration so local machines and CI can repeat the same dependency decision. A provider-selection change then appears as a reviewable Git diff.

Imagine three execution environments. Alice initializes on a laptop, Bob initializes after cloning the same commit, and CI starts from a clean worker. The constraint alone might allow several releases. With the committed lock, all three prefer `6.3.2` as long as it still satisfies the configuration. That common selection removes one major reason for otherwise identical plans to differ.

The `constraints` field in a lock entry is useful context, but the configuration remains the source of compatibility policy. Terraform recomputes the effective constraints from the module tree. The lock cannot force a version that no longer satisfies those declarations; it records a selection within the allowed set rather than overriding the set.

Package hashes may cover packages or authentication schemes relevant to installation on supported platforms. The important first-principles behavior is unchanged: Terraform does not accept arbitrary bytes merely because the filename advertises the right version. The recorded trust material lets installation detect a package that differs from what the dependency decision permits.

Do not confuse the lock file with the `.terraform/` directory:

```text
.terraform/
= local working data, downloaded material, and cache-related files

.terraform.lock.hcl
= portable provider dependency-selection record
```

The local working directory is normally ignored by version control. The lock file is intentionally committed.

The dependency lock file currently tracks provider selections, not remote module versions. A module call's `source` and `version` arguments control module selection; `.terraform.lock.hcl` should not be treated as a universal package-manager lock for every Terraform dependency.

Constraints and locks are both necessary because they answer different questions:

```text
source      → Which provider project?
constraint  → Which releases could work?
lock file   → Which exact release and packages did we select?
```

Hand-editing the selected version or hashes bypasses Terraform's dependency resolution and package verification. The safe workflow changes constraints when necessary and lets `terraform init` update the lock file through an explicit selection process.

## What Does terraform init Do with Providers?
<!-- section-summary: Initialization combines module constraints with the lock file, selects or reuses a provider release, downloads it, verifies checksums, and prepares the working directory. -->

When a working directory contains provider requirements but lacks installed plugins, `terraform init` performs the dependency setup:

```text
1. Read provider requirements from the module tree.
2. Combine all version constraints for each provider source.
3. Inspect existing locked selections.
4. Choose an acceptable version when no reusable lock exists.
5. Download the provider package.
6. Verify the package against recorded or trusted checksums.
7. Prepare the working directory for later commands.
```

Initialization also prepares the backend and installs referenced modules, but provider selection is one of its central responsibilities.

On the first init, suppose the constraint is `~> 6.3.0` and available releases include `6.3.0`, `6.3.1`, `6.3.2`, and `6.4.0`. Terraform can select the newest release that satisfies the constraint, here `6.3.2`, install it, and create `.terraform.lock.hcl`.

On a later normal init, if the lock selects `6.3.2` and that version still satisfies every configured constraint, Terraform reuses it. A newly published `6.3.8` does not trigger a silent upgrade merely because it is allowed. Reusing the lock is the behavior that makes a new laptop or CI worker reproduce the team's selected provider.

An intentional upgrade uses:

```bash
terraform init -upgrade
```

`-upgrade` tells Terraform to reconsider existing selections and choose newer releases permitted by the configured constraints. With `~> 6.3.0`, a lock at `6.3.2`, and `6.3.8` available, an upgrade init may select `6.3.8` and rewrite the lock file.

Changing the constraint can make the existing lock invalid. If configuration moves to `~> 6.6.0` while the lock still selects `6.3.2`, Terraform cannot pretend they agree. An upgrade initialization must resolve a version in the new set and update the lock entry.

This is why provider upgrades commonly change two version-controlled files:

```text
Terraform configuration
→ compatibility policy changed

.terraform.lock.hcl
→ exact provider selection changed
```

Initialization does not prove that the new provider produces a safe plan. It prepares and records the dependency. Validation, planning, review, and environment verification still follow.

Initialization is designed to be safe to run repeatedly. Configuration changes that add a provider, module, or backend setting commonly require another init. Re-running it refreshes working-directory setup while continuing to honor valid selections. This is different from apply: init prepares dependencies and backend access; it does not reconcile the declared resources with remote infrastructure.

When dependency resolution fails, read the combined constraints rather than repeatedly deleting local files. Two modules may require disjoint release families, or the lock may no longer satisfy an edited requirement. The useful diagnosis asks which module contributed each bound, whether the module truly needs that bound, and whether an intentional upgrade should move the root's selected provider.

## How Do Default and Aliased Provider Configurations Select Targets?
<!-- section-summary: One selected provider implementation can have a default configuration and several aliases for different regions, accounts, projects, credentials, or endpoints. -->

A provider block without an alias creates the default configuration:

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

A resource such as `aws_instance.web` can implicitly use that default because its resource-type prefix points to the local provider name `aws`.

One infrastructure graph may need the same provider configured for several targets. An additional block can use an alias:

```hcl
provider "aws" {
  alias  = "virginia"
  region = "us-east-1"
}
```

The default reference is `aws`; the additional configuration is `aws.virginia`. A resource selects it with an unquoted provider reference:

```hcl
resource "aws_instance" "virginia" {
  provider = aws.virginia

  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

`provider = "aws.virginia"` would be an ordinary string, not the required provider-configuration reference.

Aliases do not install different provider versions. The dependency remains one selected `hashicorp/aws` release, perhaps `6.3.2`. `aws`, `aws.virginia`, `aws.production`, and `aws.security` are several configured instances of that same implementation.

![One locked AWS provider implementation branching into default, Virginia, production-account, and security-account configurations](/content-assets/articles/article-iac-terraform-foundations-providers-plugins/provider-alias-map.png)

*Aliases choose where and how one provider implementation operates; they do not create separate plugin versions.*

Configuration differences can represent more than regions. Aliases may select accounts, subscriptions, projects, credentials or assumed roles, API endpoints, or separate service environments:

```hcl
provider "aws" {
  alias  = "production"
  region = "eu-west-2"

  assume_role {
    role_arn = var.production_role_arn
  }
}

provider "aws" {
  alias  = "security"
  region = "eu-west-2"

  assume_role {
    role_arn = var.security_role_arn
  }
}
```

The same plugin can now manage resources in two accounts through different roles.

Provider configuration also participates in lifecycle. State remembers which provider configuration managed a resource. If a resource still exists under `aws.virginia`, Terraform needs that configuration to refresh or destroy it. Removing both the resource declaration and its provider alias at once can leave Terraform unable to perform the cleanup. A safer order is to destroy or move the dependent resources first, apply that transition, and only then remove the unused configuration.

Aliases make target selection explicit at the resource boundary. That matters in multi-account designs because the same resource type may have very different authority depending on the selected configuration. A review should trace `provider = aws.production` or `provider = aws.security` to the corresponding region, role, and account settings instead of assuming that every `aws_*` block uses the default connection.

The parent-to-child mapping follows the same principle. A child can declare `aws.replica` in `configuration_aliases`; the parent chooses which concrete configuration fulfills that role:

```hcl
module "database" {
  source = "./modules/database"

  providers = {
    aws         = aws
    aws.replica = aws.virginia
  }
}
```

The child expresses a logical need for primary and replica connections. The root translates those roles into deployment-specific targets. This keeps reusable module code independent of one company's account layout.

## How Should Modules and Teams Manage Provider Upgrades?
<!-- section-summary: Child modules declare compatible provider requirements, root modules supply configurations and tighter release policy, and upgrades move through review like code changes. -->

Every module declares its own provider requirements, but Terraform must select one version of a provider source that satisfies the combined module tree. Suppose the constraints are:

```text
root module: >= 6.0
module A:    >= 6.2
module B:    < 7.0
```

The effective allowed range is at least `6.2` and lower than `7.0`. If another child requires `~> 5.0`, the intersection may be empty and initialization must fail.

Reusable child modules and directly applied root modules have different versioning goals. A reusable module should normally declare the minimum provider version required by the features it uses, for example `>= 6.2.0`. An unnecessarily narrow upper policy can conflict with other reusable modules. The root module controls the complete deployment and is the natural place for tighter bounds plus the committed lock selection.

Provider configurations also flow differently from requirements. A child module states which provider sources and additional configuration names it expects. Deployment-specific regions, accounts, and credentials are supplied from the parent hierarchy. If a child needs a second AWS connection called `replica`, it declares that expectation:

```hcl
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"

      configuration_aliases = [
        aws.replica
      ]
    }
  }
}
```

The parent then maps suitable provider configurations into the module call. This keeps the reusable module responsible for saying “I need primary and replica AWS connections” without embedding one organization's regions, accounts, or credentials.

A provider upgrade is a code change even if no `.tf` resource block changes. Provider implementation affects schema interpretation, validation, API calls, computed attributes, and replacement decisions. A team upgrade should therefore be explicit:

```text
1. Choose the intended provider upgrade.
2. Read relevant release and migration notes.
3. Change constraints when the compatibility policy must move.
4. Run terraform init -upgrade.
5. Review the .terraform.lock.hcl diff.
6. Run terraform validate.
7. Produce a Terraform plan.
8. Inspect infrastructure consequences.
9. Commit configuration and lock changes together.
10. Let CI repeat the checks with the committed selection.
```

Do not hand-edit lock hashes or a selected version. Terraform should update them after dependency resolution and package verification.

The plan after an upgrade deserves comparison with the plan from the prior provider. A no-op plan is reassuring but does not remove the need to read migration notes or run validation. A changed plan may reflect a deliberate provider fix, a new default, normalized state, a schema migration, or an unexpected lifecycle difference. The team should understand that cause before committing the new lock.

Rollout scope also matters. A provider used by several environments can be upgraded first in a lower-risk root configuration, then promoted through the remaining roots after the team sees stable plans and applies. The exact environment workflow belongs to the repository, but the source-backed principle remains that provider behavior is executable infrastructure logic and should change intentionally.

Terraform Core and provider versions remain independent software dependencies:

```hcl
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.3.0"
    }
  }
}
```

The Terraform CLI must satisfy `required_version`; the AWS plugin must satisfy its provider constraint and lock selection. Terraform `1.x` and AWS provider `6.x` do not share one version line, even though providers can declare compatibility expectations about Core.

## How Does the Full Provider Dependency Chain Fit Together?
<!-- section-summary: Source, constraint, lock selection, initialization, configuration, alias, and resource association answer separate questions in one dependency chain. -->

The complete provider model answers four independent questions:

| Question | Terraform mechanism |
| --- | --- |
| Which provider software project is required? | `source = "hashicorp/aws"` |
| Which releases are compatible? | `version = "~> 6.3.0"` |
| Which exact release and package hashes did the team select? | `.terraform.lock.hcl` |
| How should an installed provider instance connect and operate? | `provider "aws" { ... }` |

Aliases answer a fifth question: which configured instance should manage a particular resource or module?

Follow one resource through the chain. The module maps local name `aws` to global source `hashicorp/aws` and permits releases `>= 6.3.0, < 6.4.0`. The lock file selects version `6.3.2` and records package hashes. `terraform init` installs and verifies that plugin. Provider blocks configure a default London target and aliased Virginia target. The resource chooses `aws.virginia`:

```text
resource aws_instance.web
        ↓ uses
provider configuration aws.virginia
        ↓ instance of
provider source hashicorp/aws
        ↓ selected by
constraint ~> 6.3.0 plus lock version 6.3.2
        ↓ installed and verified by
terraform init
        ↓ communicates with
AWS APIs in the configured target
```

![Provider summary showing source address, version constraint, lock selection and checksums, init, configured aliases, and resources](/content-assets/articles/article-iac-terraform-foundations-providers-plugins/provider-summary.png)

*Each layer narrows a different ambiguity: provider identity, compatible release set, exact package selection, and runtime target.*

This separation produces reproducible and composable behavior. Requirements allow child modules to describe dependencies without choosing credentials. Constraints let modules express compatibility. The root's lock file records a shared concrete decision. Initialization installs the trusted package. Provider configurations turn one implementation into connections for specific accounts, regions, projects, or endpoints. State keeps the relevant configuration associated with managed resources throughout their lifecycle.

The deepest model is:

```text
source      → who is the provider?
constraint  → which releases are acceptable?
lock file   → which exact release and packages are trusted?
provider    → where and how should it operate?
alias       → which configured instance should this object use?
```

Keeping those answers separate prevents most provider-version confusion and makes upgrades deliberate instead of incidental.

Use that model to diagnose a few common failures. “Required provider is not installed” points to initialization or the working directory. “Locked provider does not match configured constraint” points to disagreement between compatibility policy and the recorded selection. “No available releases match the constraints” points to an empty intersection across modules. A checksum mismatch points to package integrity rather than HCL resource syntax. A resource reaching the wrong account or region points to provider configuration or alias selection rather than dependency versioning.

The same model tells you what belongs in review. A changed source address changes which software project Terraform trusts. A widened constraint changes the future set of acceptable releases. A lock diff changes the exact executable provider package. A provider-block diff changes the remote target or operating context. A resource-level `provider` diff changes which configured identity owns that object. Each edit reaches a different layer, so “provider change” is too broad a description for a careful review.

Finally, preserve the dependency record and discard the machine-local cache when cloning or rebuilding. The repository should provide configuration plus `.terraform.lock.hcl`; `terraform init` reconstructs `.terraform/` from those declarations and the selected dependency information. This division lets a clean worker reproduce dependencies without committing downloaded binaries and working-directory internals.

## Check Your Answers

Provider selection is part of reproducibility. Declare source addresses and compatible versions, commit the dependency lock where the workflow expects it, and initialize in a controlled runtime. A provider upgrade can change schemas, defaults, planning behavior, and authentication requirements without a resource block changing. Review the lock-file diff, read upgrade guidance, and plan representative states before promotion. Provider configuration should also make account, region, and alias intent explicit so the same resource does not silently operate against another endpoint when environment credentials change.

:::expand[Why Does Terraform Core Need Provider Plugins?]{kind="recap"}
Core owns general parsing, graph, state, plan, and apply logic. Providers independently supply platform schemas, lifecycle semantics, authentication, remote inspection, and API operations so Terraform can manage many systems without embedding them all in Core.
:::

:::expand[How Do Requirements, Local Names, Source Addresses, and Configurations Differ?]{kind="recap"}
`required_providers` declares software dependency identity and compatibility. A local name such as `aws` maps to a global source such as `hashicorp/aws`. Provider blocks create runtime configurations for particular targets.
:::

:::expand[How Do Provider Version Constraints Define Compatibility?]{kind="recap"}
A constraint defines a set of acceptable releases. `~> 6.3.0` allows the `6.3.x` family, while `~> 6.3` extends up to but excludes `7.0.0`. Terraform still needs one concrete version satisfying every module constraint.
:::

:::expand[Why Does Terraform Need a Dependency Lock File?]{kind="recap"}
Constraints describe policy; `.terraform.lock.hcl` records the exact selected provider and trusted package hashes. Commit it for repeatable installations. It locks providers, not remote module versions, and should be updated by Terraform rather than hand-edited.
:::

:::expand[What Does terraform init Do with Providers?]{kind="recap"}
Init combines requirements, constraints, and the lock; selects or reuses a provider; downloads and verifies it; and prepares the working directory. Normal init preserves a valid lock, while `-upgrade` deliberately reconsiders selections.
:::

:::expand[How Do Default and Aliased Provider Configurations Select Targets?]{kind="recap"}
One provider implementation can have a default and several aliases for regions, accounts, projects, roles, or endpoints. Resources select aliases with unquoted references. Keep a configuration available until every resource associated with it is gone.
:::

:::expand[How Should Modules and Teams Manage Provider Upgrades?]{kind="recap"}
Reusable modules usually state minimum compatibility and expected aliases; roots supply concrete configurations, tighter policy, and the lock. Provider upgrades deserve release-note review, upgrade init, validation, plan review, and a committed lock diff.
:::

:::expand[How Does the Full Provider Dependency Chain Fit Together?]{kind="recap"}
Source identifies the plugin, constraints define acceptable versions, the lock records one verified package, init installs it, provider blocks configure runtime targets, and resources or modules select the appropriate default or aliased instance.
:::

### References

- [Terraform providers](https://developer.hashicorp.com/terraform/language/providers) - Introduces providers as plugins for remote systems.
- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - Documents local names, source addresses, version constraints, and module requirements.
- [Version constraints](https://developer.hashicorp.com/terraform/language/expressions/version-constraints) - Defines supported constraint operators and their ranges.
- [Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - Explains provider selections, constraints, hashes, and lock behavior.
- [terraform init](https://developer.hashicorp.com/terraform/cli/commands/init) - Documents provider installation and explicit upgrades.
- [Provider blocks](https://developer.hashicorp.com/terraform/language/block/provider) - Defines default and aliased provider configurations.
- [Providers within modules](https://developer.hashicorp.com/terraform/language/modules/develop/providers) - Explains module requirements, configuration inheritance, and aliases.
- [Lock and upgrade provider versions](https://developer.hashicorp.com/terraform/tutorials/configuration-language/provider-versioning) - Shows a deliberate provider upgrade workflow.

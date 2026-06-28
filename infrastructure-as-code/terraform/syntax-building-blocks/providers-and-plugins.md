---
title: "Providers, Versions, and the Lock File"
description: "Learn how Terraform providers connect to real platforms, how required_providers and provider blocks fit together, and why teams commit the lock file."
overview: "Terraform uses providers to work with real APIs. This article follows a small AWS and GitHub setup so you can see how provider names, source addresses, version constraints, provider blocks, aliases, terraform init, and .terraform.lock.hcl work together."
tags: ["terraform", "providers", "versions", "lock-file"]
order: 2
id: article-iac-terraform-foundations-providers-plugins
aliases:
  - infrastructure-as-code/terraform/foundations/providers-and-plugins.md
---

## Table of Contents

1. [Why Terraform Needs Providers](#why-terraform-needs-providers)
2. [Declaring Provider Requirements](#declaring-provider-requirements)
3. [Configuring Provider Instances](#configuring-provider-instances)
4. [Local Names, Source Addresses, and Versions](#local-names-source-addresses-and-versions)
5. [Aliases for More Than One Target](#aliases-for-more-than-one-target)
6. [terraform init and the Lock File](#terraform-init-and-the-lock-file)
7. [Provider Upgrades in Real Teams](#provider-upgrades-in-real-teams)
8. [Putting It All Together](#putting-it-all-together)

## Why Terraform Needs Providers
<!-- section-summary: Terraform needs provider plugins because each platform has its own API, authentication rules, and resource behavior. -->

Terraform Core understands the Terraform language, plans, state, and dependency graph. Platform-specific knowledge lives in providers because AWS, Azure, Google Cloud, Kubernetes, GitHub, Cloudflare, Datadog, and other platforms each have their own APIs and resource rules.

A **provider** is the plugin that teaches Terraform how to work with one of those platforms. A **resource type** is a provider-owned kind of managed object, such as an S3 bucket or IAM role. The AWS provider knows resource types such as `aws_s3_bucket` and `aws_iam_role`. The GitHub provider knows resource types such as `github_repository_environment`. The Kubernetes provider knows Kubernetes objects.

Imagine `devpolaris-orders-api` needs an S3 bucket for exports and a GitHub repository environment named `production`. Terraform can manage both in one project, but it needs the AWS provider for AWS API calls and the GitHub provider for GitHub API calls.

That is why provider setup appears near the start of every Terraform project. The team has to say which providers the project uses, which versions are acceptable, and how each provider should connect during a run.

The plugin split also keeps Terraform extensible. Terraform Core stays focused on the language, graph, plan, and state, while providers carry knowledge of AWS services, Kubernetes objects, GitHub APIs, and other platform behavior. Providers are released separately, have their own documentation, and carry schemas for the resource types and read-only lookup types they support. A project gets the platform behavior it needs by declaring provider packages.

During a plan, Terraform Core starts provider plugins as separate processes and communicates with them through Terraform's provider protocol. Core asks for schemas, sends configuration, asks providers to read existing remote objects, and later asks providers to create, update, or delete objects during apply. Beginners only need the practical point: provider versions and provider configuration affect real plans.

![Provider Plugin Boundary](/content-assets/articles/article-iac-terraform-foundations-providers-plugins/provider-plugin-boundary.png)

*The boundary view shows Terraform Core coordinating the workflow while the provider plugin handles platform-specific resource behavior.*

## Declaring Provider Requirements
<!-- section-summary: required_providers tells Terraform which provider packages the project depends on before init installs them. -->

Provider requirements live inside the top-level `terraform` block. Terraform's [provider requirements documentation](https://developer.hashicorp.com/terraform/language/providers/requirements) covers the full syntax, and the beginner version is that this block tells Terraform the provider package source and the version range the project accepts.

The AWS provider requirement can come first:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

The local name `aws` points to the provider source address `hashicorp/aws`. Terraform uses that requirement during `terraform init` to find a provider package in the Terraform Registry or another configured registry.

The same project can add a GitHub provider requirement beside AWS:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}
```

The local name `github` points to `integrations/github`. The two entries together say that this root module depends directly on AWS and GitHub provider packages.

This block answers one question: which provider packages can this configuration use? AWS regions, GitHub owners, and other connection settings belong in provider configuration blocks.

Provider requirements also help future readers. A reviewer can see that `hashicorp/aws` and `integrations/github` are direct dependencies of the root module. Later, reusable modules can add their own requirements, and Terraform will select versions that satisfy the compatible constraints.

New projects usually use the official Terraform Registry source address unless the organization has a private registry or mirror. The source address is part of the package identity, and changing it is a dependency change. The lock file records checksums for the selected packages, which helps Terraform verify downloads on other machines and CI runners.

## Configuring Provider Instances
<!-- section-summary: Provider blocks configure how a selected provider connects for the current Terraform run. -->

A **provider block** configures a provider instance. For AWS, that often means a region. For GitHub, that often means an owner. Credentials usually come from the run environment rather than from hardcoded secrets in `.tf` files.

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "github" {
  owner = "devpolaris"
}
```

The resources can use those providers:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-prod-exports"
}

resource "github_repository_environment" "production" {
  repository  = "orders-api"
  environment = "production"
}
```

The `aws_` prefix tells Terraform the AWS provider owns the S3 bucket type. The `github_` prefix tells Terraform the GitHub provider owns the repository environment type. Terraform Core coordinates the plan, and each provider handles the API calls for its resources.

Provider blocks configure the current Terraform folder, which Terraform calls the current module. Later, reusable modules can receive provider configurations from their caller, but the beginner habit starts here: platform connection settings stay in provider blocks, and managed objects stay in resource blocks.

Credentials usually stay out of provider blocks unless a provider has a very specific non-secret setting that belongs there. A provider block is a good place for `region`, `owner`, `project`, or feature flags. It is a risky place for access keys, client secrets, tokens, or JSON key contents because those values can move into Git history, plan logs, or state-related workflows.

## Local Names, Source Addresses, and Versions
<!-- section-summary: The local name is used inside the module, while the source address and version constraint identify the provider package Terraform installs. -->

Three names are easy to mix up, so it helps to separate them early. The **local name** is the short name used inside this module, such as `aws`. The **source address** is the registry identity of the provider package, such as `hashicorp/aws`. The **version constraint** tells Terraform which provider versions are acceptable for this project.

The version constraint `~> 6.0` means the project accepts compatible `6.x` releases and excludes a future `7.0` release. Teams use constraints because provider releases can add new arguments, change defaults, deprecate older behavior, and sometimes require code changes during major upgrades.

The provider documentation matters here. Terraform language docs explain the `required_providers` block, while the provider registry docs explain resources, provider settings, authentication options, and upgrade guides for a specific provider. A careful upgrade starts with those provider release notes and upgrade guides.

A beginner project usually starts with direct provider sources and conservative version constraints. A production team treats provider upgrades as deliberate work with a plan diff and a review, separate from unrelated feature branches.

The `~>` operator is common because it lets teams accept patch and minor updates within a chosen compatibility line. For example, `~> 6.0` accepts `6.x` versions and excludes `7.0`. A tighter constraint such as `~> 6.2.0` accepts patch releases in the `6.2` line. The right choice depends on the team's upgrade rhythm and the provider's release history.

Unbounded constraints create risk in team projects. A missing provider version can let a fresh `terraform init` select a much newer provider than the one another engineer used. The lock file reduces that risk for a committed project, and the constraint still matters during an intentional `terraform init -upgrade`.

## Aliases for More Than One Target
<!-- section-summary: Provider aliases let one configuration use more than one configuration of the same provider, such as two regions. -->

Sometimes one Terraform project needs the same provider twice. A common example is a primary AWS region and a disaster recovery region. The default provider can point at `us-east-1`, and an aliased provider can point at `us-west-2`.

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "dr"
  region = "us-west-2"
}

resource "aws_s3_bucket" "primary_exports" {
  bucket = "devpolaris-orders-api-prod-exports"
}

resource "aws_s3_bucket" "dr_exports" {
  provider = aws.dr

  bucket = "devpolaris-orders-api-dr-exports"
}
```

The first bucket uses the default AWS provider. The second bucket uses the aliased provider because the resource includes `provider = aws.dr`. This is a meta-argument, which means Terraform Core uses it to choose provider behavior rather than passing it to the AWS S3 API.

Aliases are useful, and they also add review responsibility. Reviewers need to check that the right resources use the right provider instance, especially for production, disaster recovery, or multiple-account projects.

Aliases also matter later at module boundaries. A module can receive a specific provider configuration from its caller, which lets reusable code run in the intended region or account. The module articles return to that pattern after the core building blocks are in place.

![Provider Alias Map](/content-assets/articles/article-iac-terraform-foundations-providers-plugins/provider-alias-map.png)

*The alias map shows why reviewers check provider targets carefully because one configuration can reach more than one region or account.*

## terraform init and the Lock File
<!-- section-summary: terraform init installs selected provider packages and records exact versions in .terraform.lock.hcl. -->

`terraform init` prepares a Terraform working directory. For providers, it reads `required_providers`, finds versions that match the constraints, downloads the provider plugins, and writes the selected versions into `.terraform.lock.hcl`.

```bash
terraform init
```

A successful first init usually ends with output like this:

```console
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 6.0"...
- Finding integrations/github versions matching "~> 6.0"...
- Installing hashicorp/aws v6.0.0...
- Installing integrations/github v6.0.0...

Terraform has been successfully initialized!

Terraform has created a lock file .terraform.lock.hcl to record the provider
selections it made above.
```

The important line is the lock file line. It tells you Terraform selected exact provider packages for this working directory, and those selections now need normal code review. The exact version numbers can differ in a real project because Terraform selects the newest available versions that satisfy the configured constraints and the existing lock file rules.

After init, the project might have a lock entry for the AWS provider. Terraform's [dependency lock file documentation](https://developer.hashicorp.com/terraform/language/files/dependency-lock) explains the file in detail, and the beginner version is that it includes the provider source, selected version, constraints, and checksums. The checksums help Terraform verify that the provider package it downloads later matches the expected package.

Teams usually commit `.terraform.lock.hcl`. That gives everyone the same selected provider version during initialization of the same project. The version constraint says what range is allowed, and the lock file says what version this project actually selected.

The `.terraform/` directory should stay local because init creates it as working data. The committed set is the configuration files plus the lock file, and each machine or CI runner runs `terraform init` in its own environment.

The lock file is also a review artifact. If a pull request changes only application infrastructure but also changes `.terraform.lock.hcl`, reviewers should ask why the provider selection changed. That may be a legitimate upgrade, or it may mean someone ran `terraform init -upgrade` during unrelated work.

In larger organizations, teams may use a provider mirror so CI runners download providers from an approved internal location. The project still uses the same provider source addresses in configuration, while Terraform CLI configuration can redirect installation to the mirror. That keeps the code portable and lets the platform team control download policy.

## Provider Upgrades in Real Teams
<!-- section-summary: Provider upgrades should be reviewed separately because schema and behavior changes can change plans. -->

Provider upgrades deserve their own pull request as often as possible. The change usually starts with updating the version constraint or running an init upgrade command such as:

```bash
terraform init -upgrade
terraform plan
```

The `-upgrade` flag asks Terraform to look for newer provider versions that still match the constraints. After the lock file changes, the team reads provider release notes, runs a plan, and checks whether any resources show unexpected updates or replacements. A boring and healthy upgrade plan might end like this:

```console
Terraform has been successfully initialized!

Plan: 0 to add, 0 to change, 0 to destroy.
```

That output means this configuration proposed no infrastructure changes after the provider selection changed. Reviewers should still read `.terraform.lock.hcl`, provider release notes, and any warnings Terraform printed during init or plan before approving the upgrade.

This review protects production changes. Providers translate Terraform into real API calls, and provider schemas define which arguments cause in-place updates or replacements. A provider upgrade can change warnings, defaults, validation, or plan output.

For `devpolaris-orders-api`, a safe provider upgrade review would include the changed lock file, any required code updates, the plan output, and a short note about the provider upgrade guide. That gives reviewers enough context to approve the dependency change.

A simple upgrade runbook looks like this:

```bash
terraform init -upgrade
terraform validate
terraform plan -out=tfplan
terraform show tfplan
```

The review then reads the provider release notes and scans the plan for replacements, removed arguments, new warnings, and changed defaults. If the provider upgrade produces infrastructure changes, the pull request should explain whether those changes are expected. If the upgrade only changes checksums and selected versions, the plan should make that clear too.

For a clean validation and no-change plan, the important output is short:

```console
Success! The configuration is valid.

Saved the plan to: tfplan

Plan: 0 to add, 0 to change, 0 to destroy.
```

`terraform show tfplan` should display the same reviewed actions from the saved plan file. Teams save the plan in automation so the later apply can use the same plan reviewers approved.

## Putting It All Together
<!-- section-summary: Providers connect Terraform Core to real platforms, and the lock file keeps selected provider versions stable across machines. -->

Providers are the bridge between Terraform configuration and real platform APIs. The Terraform block declares which provider packages the project can use. Provider blocks configure how those providers connect for a run. Resources use those providers to create, update, delete, or read platform objects, and read-only lookup blocks use the same providers for configurations that need existing platform information.

The lock file gives the team stable provider selections. `terraform init` installs the providers and records exact versions. Later, a provider upgrade changes the lock file and should come with a reviewed plan.

![Provider Summary](/content-assets/articles/article-iac-terraform-foundations-providers-plugins/provider-summary.png)

*The summary board turns provider setup into a repeatable review path: provider requirements, provider configuration, initialization, a committed lock file, and deliberate upgrades.*

For beginners, the practical habit is clear: provider packages belong in `required_providers`, secrets stay out of provider blocks, `terraform init` prepares the working directory, `.terraform.lock.hcl` belongs in review, and provider upgrades count as real infrastructure changes.

The next article studies resources directly. It gives `aws_s3_bucket.orders_exports` an address, lifecycle, state record, and plan actions.

---

**References**

- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - Documents `required_providers`, provider source addresses, and version constraints.
- [Provider configuration](https://developer.hashicorp.com/terraform/language/providers/configuration) - Explains provider blocks, default provider instances, and alias configurations.
- [Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - HashiCorp reference for `.terraform.lock.hcl`, selected provider versions, constraints, and checksums.
- [terraform init](https://developer.hashicorp.com/terraform/cli/commands/init) - Documents provider installation, backend initialization, and the `-upgrade` flag.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) and [GitHub provider documentation](https://registry.terraform.io/providers/integrations/github/latest/docs) - Provider references for the resource examples used in this article.

---
title: "Providers, Versions, and the Lock File"
description: "Learn how Terraform providers connect to real platforms, how required_providers and provider blocks fit together, and why teams commit the lock file."
overview: "Terraform uses providers to work with real APIs. This article follows a small AWS and GitHub setup so you can see how provider names, source addresses, version constraints, provider blocks, aliases, terraform init, and .terraform.lock.hcl work together."
tags: ["terraform", "providers", "versions", "lock-file"]
order: 4
id: article-iac-terraform-foundations-providers-plugins
---

## Table of Contents

1. [The Project Needs More Than Terraform Syntax](#the-project-needs-more-than-terraform-syntax)
2. [What Providers Do](#what-providers-do)
3. [Declaring Providers with required_providers](#declaring-providers-with-required_providers)
4. [Source Addresses and Local Names](#source-addresses-and-local-names)
5. [Version Constraints](#version-constraints)
6. [Provider Configuration Blocks](#provider-configuration-blocks)
7. [Provider Aliases](#provider-aliases)
8. [terraform init and the Lock File](#terraform-init-and-the-lock-file)
9. [Reviewing Provider Upgrades](#reviewing-provider-upgrades)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Project Needs More Than Terraform Syntax
<!-- section-summary: Terraform needs providers before it can turn HCL into real AWS and GitHub API calls. -->

The DevPolaris team is creating infrastructure for `devpolaris-orders-api`. The service needs an S3 bucket for order exports, an IAM role for a deployment workflow, and a GitHub repository environment called `production` so deployments can require review before they run. The Terraform files can describe all of that in one project, but Terraform still needs a way to talk to AWS and GitHub.

That is where **providers** enter the story. Terraform itself understands the Terraform language, the dependency graph, the state file, and the plan workflow. The AWS API, GitHub API, Kubernetes API, and hundreds of other APIs each have their own authentication rules, request formats, resource names, retry behavior, and error messages. A provider teaches Terraform how to work with one of those outside systems.

So in this article, we will keep the setup very practical. The project will use the **AWS provider** for cloud infrastructure and the **GitHub provider** for repository settings. Then we will follow the small chain that every Terraform project uses: declare the required providers, configure them, run `terraform init`, commit the lock file, and review upgrades deliberately.

## What Providers Do
<!-- section-summary: A provider is the Terraform plugin that knows how to create, read, update, and delete resources in one outside platform. -->

A **provider** is a Terraform plugin that connects Terraform to a real platform. The AWS provider knows how to work with AWS resources such as S3 buckets, IAM roles, VPCs, and Lambda functions. The GitHub provider knows how to work with GitHub resources such as repositories, teams, branch protection rules, and repository environments.

The provider gives Terraform two important things. First, it gives Terraform a list of supported resource types. When Terraform sees `resource "aws_s3_bucket" "orders_exports"`, the `aws_` prefix tells Terraform that the AWS provider handles that resource. When Terraform sees `resource "github_repository_environment" "production"`, the `github_` prefix tells Terraform that the GitHub provider handles that resource.

Second, the provider translates Terraform's planned changes into API calls. If the plan says an S3 bucket must be created, the AWS provider makes the AWS request, waits for the response, and returns the real bucket details that Terraform stores in state. If the plan says a GitHub repository environment must be created, the GitHub provider calls the GitHub API and returns the result.

In day-to-day work, the practical provider workflow matters most. You need to know which provider your project requires, which version range your team accepts, how the provider authenticates, and how the lock file keeps the chosen version stable.

The `devpolaris-orders-api` project needs two providers, so the next step is telling Terraform exactly which providers belong to this configuration.

## Declaring Providers with required_providers
<!-- section-summary: The required_providers block tells Terraform which provider packages the project depends on and which versions are acceptable. -->

The **required_providers** block lives inside the top-level `terraform` block. It is the dependency list for providers. It tells Terraform the provider's local name, where the provider comes from, and which versions the configuration can use.

For the `devpolaris-orders-api` project, the starting point could look like this:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}
```

There are two provider requirements here. The local name `aws` points to the provider source address `hashicorp/aws`, and the local name `github` points to `integrations/github`. Terraform uses this block during `terraform init` to find and install provider packages that match the version constraints.

This block declares only the provider dependencies. Credentials, regions, owner names, and other connection settings belong in provider configuration. That separation matters because provider selection and provider configuration answer different questions. The requirement says, "Which provider package and version range does this project use?" The provider block says, "How should this provider connect for this project?"

Before provider configuration, the names inside `required_providers` deserve a closer look. The local names and source addresses look small, but they explain how Terraform finds the right provider.

## Source Addresses and Local Names
<!-- section-summary: A source address identifies the provider package globally, while the local name is the short name used inside one Terraform module. -->

A **provider source address** is the global name Terraform uses to locate a provider package. Most public providers use the pattern `namespace/type`, with the public Terraform Registry host implied. For example, `hashicorp/aws` is the AWS provider published in the `hashicorp` namespace, and `integrations/github` is the GitHub provider published in the `integrations` namespace.

You may also see a fully qualified address with the registry host included, such as `registry.terraform.io/hashicorp/aws`. In normal Terraform files, teams usually write the shorter form for public registry providers. Terraform understands that the public registry is the default host.

A **local name** is the name your module uses after the provider has been declared. In this project, the local names are `aws` and `github`. Terraform uses those names in provider blocks, and it also uses the first part of a resource type as the default provider name. That is why `aws_s3_bucket` naturally maps to the local provider name `aws`, and `github_repository_environment` naturally maps to the local provider name `github`.

This naming convention keeps the code readable:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-exports"
}

resource "github_repository_environment" "production" {
  repository  = "devpolaris-orders-api"
  environment = "production"
}
```

The source address is about where Terraform gets the provider. The local name is about how this module refers to the provider after Terraform knows about it. Most teams keep the local name the same as the provider type because it matches the resource prefixes and makes the files easier to scan.

Now Terraform knows which provider packages are acceptable. The next question is how strict the version selection should be.

## Version Constraints
<!-- section-summary: Version constraints define the provider versions Terraform may select, so teams can accept updates deliberately through review. -->

A **version constraint** tells Terraform which provider versions are compatible with the configuration. Providers change over time. New versions add resources, add arguments, fix bugs, change validation, deprecate behavior, and sometimes introduce breaking changes. The version constraint is the project's first guardrail around those changes.

In the example, the AWS provider uses this constraint:

```hcl
version = "~> 5.0"
```

The `~>` operator is often called the pessimistic constraint operator. In this shape, `~> 5.0` allows versions in the `5.x` line, such as `5.1.0` or `5.80.0`, while keeping the project out of the next major line. A major provider upgrade can change behavior in ways that deserve a planned review, so teams commonly keep root modules inside one major version line until they choose to upgrade.

Some projects use a tighter constraint:

```hcl
version = "~> 5.46.0"
```

That allows patch releases in the `5.46.x` line. This tighter pattern fits teams that want a slower upgrade rhythm. It also means the team must edit the constraint more often when they want provider features from a newer minor version.

There is one practical detail that beginners often miss. The version constraint is usually a range rather than one exact version. The exact version Terraform chose for the project gets recorded in `.terraform.lock.hcl` after initialization. The constraint says what Terraform may choose. The lock file records what Terraform did choose.

Once the allowed provider versions are declared, the project still needs connection settings for each provider.

## Provider Configuration Blocks
<!-- section-summary: Provider blocks configure how a selected provider connects, including details such as region, owner, tokens, profiles, or endpoint settings. -->

A **provider block** configures a provider for the current Terraform run. It uses the provider's local name. For AWS, the configuration often includes a region. For GitHub, the configuration often includes the repository owner or organization. Authentication usually comes from environment variables, CLI profiles, workload identity, or the provider's documented credential chain.

The `devpolaris-orders-api` project could configure its two providers like this:

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "github" {
  owner = "devpolaris"
}
```

The AWS block says that default AWS resources in this module should target `us-east-1`. The GitHub block says that default GitHub resources should target the `devpolaris` owner. The provider documentation defines the full set of configuration arguments for each provider, so the exact settings vary by platform.

Secrets belong outside these blocks. GitHub tokens belong in a secure secret source such as an environment variable or CI secret store. AWS credentials usually come from a configured CLI profile, single sign-on session, environment-provided credentials, or an assumed role. Terraform reads those credentials through the provider's normal authentication behavior.

With the provider blocks in place, the earlier resources have enough context to run. The S3 bucket uses the default AWS provider configuration. The GitHub repository environment uses the default GitHub provider configuration.

Sometimes one default configuration is enough for a whole project. The moment the project spans two AWS regions, two AWS accounts, or two GitHub owners, the team needs aliases.

## Provider Aliases
<!-- section-summary: A provider alias creates another named configuration for the same provider, which lets selected resources use a different region, account, or owner. -->

A **provider alias** is a second named configuration for the same provider. The default provider block handles most resources, and the aliased provider block handles the resources that need a different connection setting.

For example, `devpolaris-orders-api` might store normal exports in `us-east-1`, while a disaster recovery copy must live in `us-west-2`. The project can keep `us-east-1` as the default AWS configuration and add an aliased AWS configuration for the west region:

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "west"
  region = "us-west-2"
}

resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-exports"
}

resource "aws_s3_bucket" "orders_exports_replica" {
  provider = aws.west
  bucket   = "devpolaris-orders-api-exports-replica"
}
```

The first bucket uses the default AWS provider because it has no `provider` argument. The replica bucket uses `provider = aws.west`, so Terraform sends that resource through the aliased AWS configuration. The alias name belongs to this module, so teams usually choose plain names that describe the purpose, such as `west`, `audit`, `shared_services`, or `production`.

Aliases stay light at the beginner level. You need them when one provider needs multiple configurations in the same root module. You will see them again when modules enter the picture, because child modules need provider configurations passed into them intentionally.

Now the project declares providers and configures them. The next thing that actually makes providers available on disk is `terraform init`.

## terraform init and the Lock File
<!-- section-summary: terraform init installs matching providers and creates or updates .terraform.lock.hcl with the exact provider selections. -->

`terraform init` prepares a Terraform working directory. For providers, it reads the `required_providers` blocks, checks the configured version constraints, downloads provider packages, and writes the selected provider versions into the dependency lock file.

For the orders API project, the first run usually looks like this:

```bash
terraform init
```

After that command succeeds, the working directory has local provider files under `.terraform/`, and the repository usually has a `.terraform.lock.hcl` file. The `.terraform/` directory is local working data. Teams normally ignore it in Git. The **dependency lock file**, named `.terraform.lock.hcl`, belongs in version control because it records the provider selections for the project.

A simplified lock file entry looks like this:

```hcl
provider "registry.terraform.io/hashicorp/aws" {
  version     = "5.84.0"
  constraints = "~> 5.0"
  hashes = [
    "h1:example",
    "zh:example"
  ]
}
```

The important part is the relationship between the constraint and the selected version. The Terraform configuration allowed any compatible AWS provider in the `5.x` line. During initialization, Terraform selected one concrete version and recorded it in the lock file. Future `terraform init` runs use that recorded version by default, so teammates and CI runners install the same provider version and avoid silent drift to a newer release.

The lock file also records hashes. Those hashes let Terraform verify that a downloaded provider package matches what the lock file expects. Beginners can leave hash editing to Terraform. Terraform maintains the lock file for you, and the team reviews the file when provider selections change.

This is the practical sentence to remember: **terraform init installs providers and updates `.terraform.lock.hcl` based on the configured version constraints**. If the project adds the GitHub provider, `terraform init` records a new GitHub provider selection. If the team intentionally upgrades the AWS provider, `terraform init -upgrade` can update the selected version inside the allowed range.

Because the lock file changes automatically, provider upgrades need a review habit.

## Reviewing Provider Upgrades
<!-- section-summary: Teams review provider upgrades by changing constraints intentionally, running init with upgrade when needed, checking the lock file diff, and validating the resulting plan. -->

Teams pin provider versions through the lock file because infrastructure code should run the same way on every machine. A new provider version can change validation, add default behavior, fix a bug that changes a planned diff, or introduce a deprecation warning that blocks a later upgrade. Those changes may be good changes, but they still deserve review.

For a normal provider upgrade in `devpolaris-orders-api`, the team follows a small workflow. Someone opens a branch, changes the provider constraint if the project is moving to a new range, and runs initialization with upgrade:

```bash
terraform init -upgrade
```

That tells Terraform to look for the newest provider versions that still satisfy the configured constraints while ignoring the existing lock file selections. If the AWS constraint stays at `~> 5.0`, Terraform can move to a newer `5.x` release. If the team wants AWS provider `6.x`, the `required_providers` constraint must change too.

The pull request should include the Terraform file change when the constraint changed, plus the `.terraform.lock.hcl` change that records the new provider selection and hashes. Reviewers look at both. A lock file diff by itself usually means the selected provider changed. A constraint diff explains the new range the team wants to allow.

After initialization, the reviewer also expects normal Terraform checks:

```bash
terraform fmt
terraform validate
terraform plan
```

The plan matters most because provider upgrades can change what Terraform notices. Maybe the AWS provider now validates a bucket setting more strictly. Maybe the GitHub provider returns a new computed field. Maybe the plan shows resource replacement, and the team needs to understand whether that replacement comes from the intended provider change or from an unrelated configuration change.

Good provider upgrade reviews ask a few plain questions. Which provider changed? Which exact version did the lock file select? Did the version constraint also change? Does the plan show any resource changes? Did the team check the provider release notes for breaking changes or deprecations? Those questions keep upgrades routine and predictable.

Now we can connect the whole flow from a blank Terraform directory to a reviewed provider setup.

## Putting It All Together
<!-- section-summary: Provider requirements, provider configuration, init, the lock file, and upgrade review form one practical workflow for repeatable Terraform runs. -->

Here is the complete beginner version of the provider setup for `devpolaris-orders-api`:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

provider "github" {
  owner = "devpolaris"
}

resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-exports"
}

resource "github_repository_environment" "production" {
  repository  = "devpolaris-orders-api"
  environment = "production"
}
```

The `required_providers` block declares the provider dependencies. The source addresses tell Terraform where the provider packages come from. The version constraints tell Terraform which provider versions the project can accept. The provider blocks configure how those providers connect for this root module.

Then `terraform init` installs matching providers and records the exact selections in `.terraform.lock.hcl`. The team commits that lock file so laptops and CI runners use the same provider versions. When the team wants an upgrade, they run it through a branch, review the constraint and lock file changes, and check the resulting plan before merging.

That workflow keeps provider management boring in the best possible way. The code says which providers are allowed. The lock file records which ones were selected. The review process decides when those selections should change.

## What's Next

The next Terraform foundation is authentication and credentials. Providers can only call AWS, GitHub, Azure, Google Cloud, or any other API after the Terraform run has a trusted identity. That identity may come from a local CLI login, environment variables, a CI/CD role, or OIDC federation.

---

**References**

- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - HashiCorp documentation for `required_providers`, provider source addresses, local names, and version constraints.
- [Provider block reference](https://developer.hashicorp.com/terraform/language/block/provider) - HashiCorp documentation for provider configuration blocks and aliases.
- [Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - HashiCorp documentation for `.terraform.lock.hcl`, provider selections, checksums, and lock file review.
- [terraform init command](https://developer.hashicorp.com/terraform/cli/commands/init) - HashiCorp documentation for initialization, provider installation, lock file updates, and the `-upgrade` option.

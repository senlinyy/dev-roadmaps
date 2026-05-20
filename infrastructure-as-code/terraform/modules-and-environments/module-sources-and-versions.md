---
title: "Module Sources and Versions"
description: "Choose Terraform module sources, pin versions, and review local, registry, and Git modules before they affect AWS infrastructure."
overview: "A module source is part of your infrastructure supply chain. This article uses the AWS web server example to explain local paths, registry modules, Git refs, version constraints, init behavior, and upgrade review."
tags: ["terraform", "opentofu", "modules", "versions", "supply-chain"]
order: 2
id: article-infrastructure-as-code-terraform-module-sources-versions
---

## Table of Contents

1. [Why Sources Matter](#why-sources-matter)
2. [Module Source](#module-source)
3. [Local Sources](#local-sources)
4. [Registry Sources](#registry-sources)
5. [Git Sources](#git-sources)
6. [Version Constraints](#version-constraints)
7. [Init and Upgrades](#init-and-upgrades)
8. [Reviewing Module Changes](#reviewing-module-changes)
9. [Common First Mistakes](#common-first-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Sources Matter

The orders team now has a reusable `aws-web-server` module. Dev uses it successfully, and prod is next. Then a second question appears: where should the module come from?

There are several real choices:

- The web server module can live in the same repository as the root modules.
- A VPC module can come from the public Terraform Registry.
- A shared company module can come from a private Git repository.

Those choices are not cosmetic. A module source decides which code Terraform downloads and runs as part of the plan. A module version decides when that code changes. If the source is unclear or the version floats, a routine plan can include code the reviewer did not expect.

This article follows the same AWS web server example and focuses on module supply. You will see how local paths, registry sources, Git refs, and upgrades should be reviewed before Terraform changes real infrastructure.

## Module Source

The `source` argument tells Terraform where to find a child module.

```hcl
module "web" {
  source = "../../modules/aws-web-server"

  name_prefix   = "orders-dev"
  ami_id        = var.web_ami_id
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.public.id
  instance_type = "t3.micro"
  allowed_cidrs = ["10.0.0.0/16"]
  common_tags   = local.common_tags
}
```

The source is part of the module call. It is as important as the input values. The inputs decide how the module behaves for this environment. The source decides which module code is being used at all.

Terraform can load modules from local paths, registries, Git repositories, object storage, and other supported locations. The common choices are local paths for modules inside one repository, registry addresses for published modules, and Git URLs for modules stored in a version control repository.

## Local Sources

A local source points at a directory on disk. It is common when the root modules and reusable modules live in the same repository:

```text
infra/
  modules/
    aws-web-server/
      main.tf
      variables.tf
      outputs.tf
  live/
    dev/
      main.tf
    prod/
      main.tf
```

The dev root module calls the local module with a relative path:

```hcl
module "web" {
  source = "../../modules/aws-web-server"

  name_prefix   = "orders-dev"
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.public.id
  instance_type = "t3.micro"
  allowed_cidrs = ["10.0.0.0/16"]
  common_tags   = local.common_tags
}
```

Local sources are easy to review because a pull request can show both sides of the change: the module code and the root module call. If the module changes the security group rule, the reviewer can see that diff in the same repository.

Local modules do not use the `version` argument. They share the same repository version as the caller. That is convenient, but it also means a module change can affect every root module that points at that local directory once those roots plan with the updated code.

The review question for a local module change is, "Which root modules call this path?" A small change in `modules/aws-web-server` may affect dev, prod, and every service that consumes the same module.

## Registry Sources

A registry source points at a module published in a Terraform registry. Public registry addresses use a compact shape:

```hcl
module "network" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name            = "orders-dev"
  cidr            = "10.0.0.0/16"
  azs             = ["us-east-1a", "us-east-1b"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets = ["10.0.11.0/24", "10.0.12.0/24"]
}
```

The source address identifies the module. The `version` constraint tells Terraform which published module versions are acceptable. Registry modules are useful when a team wants a maintained, documented module for a common pattern such as a VPC.

Registry modules also change the review responsibility. The module code may live outside your repository. Before using one, read its inputs, outputs, examples, provider requirements, upgrade notes, and open issues that affect your use case. A VPC module can create many AWS resources, including route tables, gateways, subnet resources, security group rules, and outputs that other modules depend on.

The plan remains the final evidence. A trusted registry module still needs a plan review in your AWS account, with your values, your provider version, and your state.

## Git Sources

A Git source points Terraform at a repository. This is common for private company modules that are not published to a registry.

```hcl
module "web" {
  source = "git::https://git.example.com/platform/terraform-modules.git//aws-web-server?ref=v1.4.2"

  name_prefix   = "orders-prod"
  ami_id        = var.web_ami_id
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.private.id
  instance_type = "t3.small"
  allowed_cidrs = ["10.20.0.0/16"]
  common_tags   = local.common_tags
}
```

There are two details in that source string. The `//aws-web-server` part selects a subdirectory inside the repository. The `?ref=v1.4.2` part selects a Git ref, such as a tag, branch, or commit SHA.

For production root modules, a tag or commit SHA is easier to review than a moving branch name. A branch name like `main` can point at different code tomorrow. A tag or commit SHA gives reviewers a stable target.

Git sources do not use the registry `version` argument. Their version selection happens through the Git ref inside the source URL. That means your upgrade process is a source change, such as moving from `?ref=v1.4.2` to `?ref=v1.5.0`.

## Version Constraints

Registry modules use the `version` argument. Terraform treats it as a version constraint, not always a single exact version.

```hcl
module "network" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"
}
```

The `~> 6.0` constraint allows compatible releases in the `6.x` line according to Terraform's version constraint rules. An exact version is stricter:

```hcl
module "network" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.0.1"
}
```

The right constraint depends on the team's upgrade habit. A broad constraint can receive more updates after `terraform init -upgrade`. An exact pin makes upgrades explicit, but it also means someone must intentionally move the version forward.

For important AWS infrastructure, the useful habit is simple: every module version change deserves its own review. The reviewer should look at the module changelog, the root module inputs, and the plan output. A module upgrade can change defaults, add resources, remove outputs, or alter replacement behavior.

## Init and Upgrades

Terraform installs child modules during `terraform init`. After you add or change a module source, run init so Terraform can download or prepare the module code.

```bash
$ terraform init
```

If a registry module is already installed and you want Terraform to choose a newer version allowed by the constraint, use the upgrade flag:

```bash
$ terraform init -upgrade
```

This is why module changes often show up in two places: the `.tf` file and the dependency files Terraform uses locally. The important review artifact is still the plan. Init prepares module code. Plan shows what that module code would do to your infrastructure.

Changing a module source or version can also change the installed code without changing the module inputs. A pull request that updates only this line can still be a high-risk infrastructure change:

```hcl
version = "~> 6.0"
```

Treat that line as infrastructure code, because it controls the code Terraform will execute.

## Reviewing Module Changes

A module source review asks three practical questions.

| Question | Why it matters |
| --- | --- |
| Where does the code come from? | Local, registry, and Git modules have different trust and review paths. |
| Which version or ref is selected? | Floating sources can change without a clear code diff in the root module. |
| What does the plan show? | The same module code can behave differently with different inputs, provider versions, and state. |

For the web server module, a local change might widen `allowed_cidrs` handling or add a new egress rule. For the registry VPC module, an upgrade might change default subnet tags or NAT gateway behavior. For a Git module, moving the `ref` might bring several commits at once.

Good review makes those changes visible. Read the module diff or release notes first. Then run a plan in each root module that consumes the changed module. Dev and prod may pass different inputs, use different providers, and store different state. A clean dev plan does not prove the prod plan is clean.

## Common First Mistakes

Module source mistakes usually come from treating the source line as a small detail.

**Using a moving Git branch for prod.** A branch can point at different commits over time. Prefer a tag or commit SHA for production roots.

**Skipping the version argument for registry modules.** Registry modules should be constrained so upgrades happen through review.

**Assuming local modules affect one root.** A local module directory may be called by many root modules. Search callers before changing it.

**Running init but skipping plan review.** Init downloads code. Plan shows proposed infrastructure changes. Both steps answer different questions.

**Upgrading several modules at once.** Bundled upgrades make it harder to identify which module caused a resource replacement or output change.

## Putting It All Together

The orders team now knows that a module call has two kinds of review surface.

The first is the contract: the inputs and outputs. That is where the root module says which VPC, subnet, CIDR range, instance size, and tags apply.

The second is the supply path: the source and version. A local source keeps code in the same repository. A registry source should use the `version` argument. A Git source should use a stable ref for important environments.

When module code changes, Terraform may propose real AWS changes even if the root module inputs did not move. The safe habit is to review the source, pin the selected version or ref, run init intentionally, and read the plan for every root module that consumes the change.

## What's Next

The next article uses the same module ideas to separate dev and prod. A reusable child module can be shared, but each environment still needs a clear root module, state key, values, credentials, and review boundary.

---

**References**

- [Module block reference](https://developer.hashicorp.com/terraform/language/block/module) - Terraform reference for `module` block arguments, source addresses, and the registry-only `version` argument.
- [Use modules in your configuration](https://developer.hashicorp.com/terraform/language/modules/configuration) - Terraform documentation for installing modules, selecting versions, and using Git refs.
- [Modules overview](https://developer.hashicorp.com/terraform/language/modules) - Terraform overview of module hierarchy, module sources, and public or private registries.
- [Find and use modules in the Terraform registry](https://developer.hashicorp.com/terraform/registry/modules/use) - Terraform Registry documentation for finding modules and using module version constraints.
- [Terraform version constraints](https://developer.hashicorp.com/terraform/tutorials/configuration-language/versions) - Terraform tutorial explaining version constraint forms such as exact versions and pessimistic constraints.

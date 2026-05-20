---
title: "What Is Terraform"
description: "Understand what Terraform does, how providers and resources work, and why plans and state matter before managing AWS infrastructure."
overview: "Terraform turns infrastructure choices into configuration files that can be reviewed, planned, applied, and remembered. This article uses a small AWS S3 example to explain the model before the module moves into larger AWS resources."
tags: ["terraform", "opentofu", "iac", "aws", "state"]
order: 1
id: article-infrastructure-as-code-terraform-what-is-terraform
aliases:
  - what-is-terraform
  - what-is-iac
  - why-infrastructure-as-code-exists
  - infrastructure-as-code-fundamentals
  - article-infrastructure-as-code-fundamentals-why-infrastructure-as-code-exists
  - infrastructure-as-code/terraform/what-is-terraform.md
  - infrastructure-as-code/fundamentals/what-is-iac.md
  - infrastructure-as-code/fundamentals/why-infrastructure-as-code-exists.md
  - cloud-providers/infrastructure-as-code/fundamentals/why-infrastructure-as-code-exists.md
---

## Table of Contents

1. [Why Terraform Matters](#why-terraform-matters)
2. [Infrastructure as Files](#infrastructure-as-files)
3. [Providers](#providers)
4. [Resources](#resources)
5. [AWS S3 Hello World](#aws-s3-hello-world)
6. [Plan](#plan)
7. [State](#state)
8. [OpenTofu](#opentofu)
9. [Common First Mistakes](#common-first-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Terraform Matters

You need to create one private S3 bucket for a learning service. It sounds like a small change. Open the AWS console, choose a region, type a bucket name, add a tag, block public access, and the work is done.

That is a reasonable way to learn AWS. It becomes a weak operating model when the same choice has to be reviewed, repeated, or explained later. A console page can show the bucket that exists now, but it does not show the full story of why that bucket exists, which defaults were accepted, who approved the public access settings, or how the same shape should be rebuilt in another account.

The problem appears a week later when the same bucket needs to exist in staging, production, or a recovery account.

- The console shows the bucket that exists now, but it does not show the review that approved it.
- A shell script can call AWS APIs, but reviewers have to imagine the final infrastructure from the command sequence.
- A second environment needs the same pattern with a different name, region, tags, and credentials.
- A teammate may change the bucket manually, leaving the files and the account with different stories.

Terraform was built for this kind of cloud-provisioning work. It lets the team describe AWS resources in files, ask for a plan before changing anything, apply the approved change through provider APIs, and keep state so future runs know which real objects the files manage.

The rest of this article follows that idea through one AWS S3 hello world. The example is small, but the same model is used for VPCs, subnets, route tables, security groups, IAM roles, EC2 instances, databases, and production platforms.

## Infrastructure as Files

Terraform is an infrastructure as code tool. Infrastructure as code means the desired infrastructure is written in configuration files, kept in version control, reviewed like application code, and changed through a repeatable workflow.

Terraform configuration is declarative. You describe the result the infrastructure should have. Terraform compares that desired result with what it already knows and what the provider reports from the real platform. Then it proposes the actions needed to make the managed infrastructure match the files.

For Terraform, the important shift is that cloud intent moves out of private console memory and into a root module. A VPC CIDR, an S3 public access block, an IAM policy attachment, and a database backup setting become text that can be reviewed before provider APIs touch the account. Git records who changed the intended shape. Terraform state records which remote objects belong to that shape.

A command script often reads like this:

```bash
aws s3api create-bucket --bucket dp-terraform-hello-123456
aws s3api put-public-access-block --bucket dp-terraform-hello-123456 ...
aws s3api put-bucket-tagging --bucket dp-terraform-hello-123456 ...
```

The commands are actions. They tell AWS what to do right now. A reader has to mentally run the sequence to understand the final shape.

A Terraform configuration reads more like a description:

```text
an S3 bucket named dp-terraform-hello-123456 should exist
the bucket should have learning tags
public bucket access should be blocked
the bucket name and ARN should be available as outputs
```

That description is still precise. Terraform can turn it into API calls. The difference is where the review starts. A reviewer can ask, "Is this the bucket we want?" before thinking through every API operation.

The beginner model has five pieces:

| Piece | What it means | Why it matters |
| --- | --- | --- |
| Configuration | The `.tf` files in a root module | The desired infrastructure written down |
| Provider | A plugin for one platform or API | How Terraform talks to AWS |
| Resource | One managed object | What Terraform may create, update, replace, or delete |
| Plan | The proposed change | What reviewers inspect before apply |
| State | Terraform's memory | How Terraform connects file addresses to real AWS objects |

Terraform's main job is comparison. It reads configuration, reads state, asks providers about managed objects, builds a dependency graph, and creates a plan. That plan is the point where infrastructure changes become reviewable.

## Providers

Terraform's core engine does not know what an S3 bucket is. It also does not know the arguments for an EC2 instance, the API for a VPC route table, or the behavior of an IAM role. That platform knowledge lives in providers.

A provider is a plugin that teaches Terraform how to work with a platform. The AWS provider defines resource types such as `aws_s3_bucket`, `aws_vpc`, `aws_subnet`, and `aws_instance`. It also knows how to call AWS APIs, validate provider-specific arguments, read remote objects, and report attributes back to Terraform.

A module declares its provider requirements in a `terraform` block:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

The local name `aws` is the name this module uses for the provider. The source address `hashicorp/aws` tells Terraform where the provider comes from. The version constraint keeps installation inside the provider version family the project expects.

Provider versions matter because providers are released separately from Terraform. A provider release can add a new resource, change validation, fix a bug, or adjust behavior for an AWS API. The selected provider version is recorded in `.terraform.lock.hcl` after initialization so the team can repeat the same dependency choice.

The provider also needs configuration. For AWS, the most visible setting is the region:

```hcl
provider "aws" {
  region = "us-east-1"
}
```

Credentials usually do not belong in this file. The AWS provider can use the normal AWS credential chain: environment variables, shared config files, IAM Identity Center, instance profiles, web identity, or a CI identity. Keeping credentials outside Terraform files matters because those files are usually committed to Git.

## Resources

A resource block tells Terraform to manage one object.

The syntax has a regular shape:

```hcl
resource "resource_type" "local_name" {
  argument = value
}
```

The first label is the resource type. The provider defines that type and decides which arguments it accepts. The second label is the local name inside this module. Together, the type and local name form a resource address.

For an S3 bucket, the address can look like this:

```hcl
resource "aws_s3_bucket" "hello" {
  bucket = "dp-terraform-hello-123456"
}
```

The resource type is `aws_s3_bucket`. The local name is `hello`. The address is:

```text
aws_s3_bucket.hello
```

That address appears in plans, state, imports, references, and error messages. It is Terraform's stable name for the object inside the configuration. The real AWS object has its own identity, such as the S3 bucket name. State is what binds the Terraform address to the real object after apply.

Resources have arguments and attributes. Arguments are values you set, such as `bucket` and `tags`. Attributes are values the provider reports, such as the bucket ARN. Other blocks can reference those values:

```hcl
output "bucket_arn" {
  value = aws_s3_bucket.hello.arn
}
```

The expression `aws_s3_bucket.hello.arn` means "read the `arn` attribute from the resource at address `aws_s3_bucket.hello`." This reference system becomes more important as infrastructure grows. A security group can reference a VPC ID. An EC2 instance can reference a subnet ID. An IAM policy can reference an S3 bucket ARN. Terraform uses those references to understand dependency order.

## AWS S3 Hello World

The smallest useful AWS example creates a private S3 bucket and blocks public bucket access. It is still real AWS infrastructure, so use a sandbox account and choose a bucket name that belongs to you. S3 bucket names must be globally unique across an AWS partition. Replace the example name before running it.

Put this in `main.tf`:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "hello" {
  bucket = "dp-terraform-hello-123456"

  tags = {
    Name        = "terraform-hello"
    Environment = "learning"
  }
}

resource "aws_s3_bucket_public_access_block" "hello" {
  bucket = aws_s3_bucket.hello.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "bucket_name" {
  value = aws_s3_bucket.hello.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.hello.arn
}
```

Read the file from top to bottom once, then read it by role.

The `terraform` block says this directory needs the AWS provider from `hashicorp/aws`. Terraform uses that during initialization to install the provider plugin and write the selected version to the lock file.

The `provider "aws"` block says AWS API calls should target `us-east-1` unless another provider configuration overrides it. S3 bucket names are global within a partition, but the bucket still has a region. Later AWS examples use the same provider block for strongly regional resources such as VPCs, subnets, EC2 instances, and security groups.

The `aws_s3_bucket.hello` resource describes the bucket. The `bucket` argument sets the real S3 bucket name. The `tags` argument records ownership and purpose. Tags are small, but they matter in real accounts because cost reports, cleanup scripts, dashboards, and humans all rely on them.

The `aws_s3_bucket_public_access_block.hello` resource describes a guardrail attached to the bucket. Its `bucket` argument references `aws_s3_bucket.hello.id`. That reference tells Terraform the public access block depends on the bucket. Terraform can then create the bucket first and apply the guardrail after AWS returns the bucket identity.

The outputs expose values a human or another workflow may need after apply. The bucket name comes from an argument. The bucket ARN comes from an attribute reported by the provider.

Even in this small file, the main Terraform model is visible: provider, resource, reference, plan, apply, output, and state.

## Plan

Terraform does not change AWS the moment you save `main.tf`. The usual first steps are initialization and planning.

```bash
terraform init
terraform plan
```

Initialization prepares the directory. It installs the AWS provider, creates Terraform working files under `.terraform`, and records dependency selections in `.terraform.lock.hcl`.

Planning asks Terraform to compare configuration, state, and provider data. For the S3 hello world, the first plan should propose bucket creation and public access block creation:

```text
Terraform will perform the following actions:

  # aws_s3_bucket.hello will be created
  + resource "aws_s3_bucket" "hello" {
      + arn    = (known after apply)
      + bucket = "dp-terraform-hello-123456"
      + id     = (known after apply)
      + tags   = {
          + "Environment" = "learning"
          + "Name"        = "terraform-hello"
        }
    }

  # aws_s3_bucket_public_access_block.hello will be created
  + resource "aws_s3_bucket_public_access_block" "hello" {
      + block_public_acls       = true
      + block_public_policy     = true
      + bucket                  = (known after apply)
      + ignore_public_acls      = true
      + restrict_public_buckets = true
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

The `+` symbol means Terraform plans to create the resource. The phrase `(known after apply)` means Terraform cannot know the final value until the provider creates or reads something in AWS. The summary line is the first safety check. For this example, two creates are expected. In a shared account, an unexpected destroy count would stop the review.

When the plan looks right, `terraform apply` performs the approved actions:

```bash
terraform apply
```

Terraform shows a plan and asks for confirmation unless you give it a saved plan file. When you approve, the AWS provider calls AWS APIs. After a successful apply, Terraform writes state so future runs can connect `aws_s3_bucket.hello` to the real bucket.

## State

State is Terraform's memory of managed objects.

After the S3 hello-world apply, state records that the address `aws_s3_bucket.hello` maps to the bucket named `dp-terraform-hello-123456`. It also records provider-reported attributes such as IDs, ARNs, and other values Terraform needs for future comparisons.

That binding explains several beginner surprises.

If the configuration contains `aws_s3_bucket.hello` but the state has no matching entry, Terraform may plan to create a bucket. If the state says the bucket exists but the AWS provider reports that it was deleted manually, Terraform may plan to recreate it. If you rename the resource address from `aws_s3_bucket.hello` to `aws_s3_bucket.orders` without moving state, Terraform can read that as one object removed and another object added.

State can contain sensitive values. Cloud providers often return generated IDs, policy contents, connection information, or other data that should be protected. A single-user learning directory may start with local state in `terraform.tfstate`. A team project usually stores state in a remote backend with access control and locking so two applies do not race each other.

State also gives Terraform a memory boundary. Terraform manages objects that are in its configuration and state. An existing S3 bucket created by hand is outside that boundary until the team imports it or recreates it through Terraform. This is why state becomes one of the central topics in any serious Terraform project.

## OpenTofu

OpenTofu is a separate infrastructure as code project that follows the same beginner model: configuration files, providers, resources, plans, applies, and state.

The command names are familiar:

| Terraform CLI | OpenTofu CLI | Same beginner idea |
| --- | --- | --- |
| `terraform init` | `tofu init` | Prepare the directory and install providers |
| `terraform plan` | `tofu plan` | Preview the proposed change |
| `terraform apply` | `tofu apply` | Make the approved change |
| `terraform state` | `tofu state` | Inspect or adjust state bindings |

OpenTofu keeps familiar language concepts, including the `terraform` settings block for compatibility. There are real differences in licensing, registry behavior, ecosystem choices, and version timelines. Those differences matter when a team chooses a production toolchain. For learning the core model, the same mental path carries across both tools.

## Common First Mistakes

The first S3 example is small enough that most mistakes are easy to understand.

**Skipping initialization.** Terraform needs the provider plugin before it can understand `aws_s3_bucket`. Run `terraform init` when you start a directory and when provider, module, or backend settings change.

**Using the example bucket name unchanged.** S3 bucket names must be globally unique. If another account already owns the name, AWS rejects the create call during apply.

**Running in the wrong AWS account or region.** Terraform uses the credentials and region available to the provider. Check the active AWS identity before applying in any account that matters.

**Reading `.tf` files like scripts.** Terraform reads the full module and builds a graph from references. The line order in a file rarely decides operation order. The reference from the public access block to the bucket is what creates the dependency.

**Ignoring the plan summary.** The plan body is important, but the add, change, and destroy counts are the first alarm. A destroy or replacement in production deserves careful inspection.

**Putting credentials in provider blocks.** Use the AWS credential chain or a managed automation identity. Long-lived access keys in Terraform files usually become long-lived secrets in Git.

**Committing state.** State can contain sensitive data and ownership bindings. Keep local state out of Git and use a protected remote backend for team environments.

**Forgetting cleanup.** A learning bucket is still a real AWS resource. Use the same directory and state when you destroy it, then verify the bucket is gone.

## Putting It All Together

The opening problem was simple: create one private S3 bucket in a way the team can repeat and review.

Terraform solves that by changing where the infrastructure story lives. The `.tf` file records the desired bucket, tags, public access guardrail, and outputs. The AWS provider supplies the platform knowledge. Resource addresses give Terraform stable names for managed objects. The plan shows proposed AWS actions before they happen. Apply performs the approved actions. State remembers which real AWS objects belong to which resource addresses.

The example is deliberately small. The structure is the same when the managed objects become VPCs, subnets, security groups, EC2 instances, IAM roles, load balancers, and databases. Terraform still reads files, providers, and state; builds a graph; proposes a plan; applies through provider APIs; and records the result.

## What's Next

The next article turns this model into a daily workflow. It follows a small AWS environment through `init`, `fmt`, `validate`, `plan`, `apply`, verification, and `destroy`, so the commands have a clear job instead of feeling like a memorized sequence.

---

**References**

- [What is Terraform?](https://developer.hashicorp.com/terraform/intro) - Overview of Terraform as infrastructure as code for cloud and on-premises resources.
- [HashiCorp Terraform announcement](https://www.hashicorp.com/en/blog/terraform-announcement) - Historical context for Terraform's 2014 release and multi-provider design.
- [Terraform language overview](https://developer.hashicorp.com/terraform/language) - Core language concepts, including blocks, arguments, expressions, providers, resources, and dependencies.
- [Terraform configuration syntax](https://developer.hashicorp.com/terraform/language/syntax/configuration) - Syntax rules for blocks, labels, arguments, identifiers, and expressions.
- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - Provider source addresses, local names, and version constraints.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Terraform Registry documentation for configuring and using the AWS provider.
- [aws_s3_bucket resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) - Resource reference for managing S3 buckets with the AWS provider.
- [aws_s3_bucket_public_access_block resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block) - Resource reference for managing S3 public access block settings with the AWS provider.
- [Amazon S3 bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html) - AWS rules for globally unique S3 bucket names.
- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - CLI reference for previewing changes from configuration, state, and provider data.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explanation of state as the binding between configuration and real objects.
- [OpenTofu settings](https://opentofu.org/docs/language/settings/) - OpenTofu settings documentation, including compatibility with the `terraform` block.
- [OpenTofu state](https://opentofu.org/docs/language/state/) - OpenTofu state model and state file behavior.

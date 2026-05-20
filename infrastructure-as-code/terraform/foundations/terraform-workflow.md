---
title: "Terraform Workflow"
description: "Use the Terraform and OpenTofu workflow to initialize a directory, format and validate configuration, review a plan, apply an AWS change, verify it, and clean it up."
overview: "Terraform workflow is the daily path from configuration files to real infrastructure. This article follows a small AWS S3 environment through init, fmt, validate, plan, apply, verification, and destroy."
tags: ["terraform", "opentofu", "workflow", "aws", "plan", "apply"]
order: 2
id: article-cloud-iac-infrastructure-as-code-provisioning-terraform
aliases:
  - terraform-workflow
  - provisioning-terraform
  - infrastructure-as-code/terraform/terraform-workflow.md
  - cloud-iac/infrastructure-as-code/provisioning-terraform.md
  - infrastructure-as-code/terraform/provisioning-terraform.md
  - child-infrastructure-as-code-provisioning-terraform
---

## Table of Contents

1. [Why Workflow Matters](#why-workflow-matters)
2. [The Working Directory](#the-working-directory)
3. [The Example Environment](#the-example-environment)
4. [Init](#init)
5. [Fmt](#fmt)
6. [Validate](#validate)
7. [Plan](#plan)
8. [Apply](#apply)
9. [Verify](#verify)
10. [Destroy](#destroy)
11. [OpenTofu Workflow](#opentofu-workflow)
12. [Common First Mistakes](#common-first-mistakes)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## Why Workflow Matters

The previous article showed what Terraform is: files describe desired infrastructure, providers talk to AWS, plans preview changes, and state remembers what Terraform manages. The next question is more practical: what do you actually run on a normal day?

Imagine the orders team needs a tiny development environment for generated invoice exports. The environment is only an S3 bucket with tags, versioning, and public access blocked. It is still real infrastructure. The team wants to know the exact path from a file change to an AWS change.

- A new engineer has the `.tf` files but no provider plugin installed yet.
- A pull request changes the bucket guardrails, and reviewers need a plan they can read.
- The apply succeeds, but the team still needs proof from AWS that versioning and public access settings are actually in place.
- The learning environment should be destroyed when the exercise is done so it does not linger in the account.

Terraform workflow gives each step a job. `init` prepares the directory. `fmt` makes formatting consistent. `validate` checks whether Terraform can understand the configuration. `plan` shows the proposed AWS changes. `apply` performs the approved changes. Verification checks the result outside Terraform. `destroy` removes temporary managed resources when the environment is finished.

## The Working Directory

Terraform runs from a root module. In the CLI workflow, the root module is usually the directory where you run the command. Terraform reads all `.tf` files in that directory together as one module.

For the orders export environment, the directory might look like this:

```text
infra/orders-exports/dev/
  main.tf
  outputs.tf
  providers.tf
```

Splitting blocks across files helps people read the project. Terraform still treats those files as one module. A resource in `main.tf` can reference a provider declared in `providers.tf` because both files belong to the same root module.

The directory choice matters. Running Terraform from `infra/orders-exports/dev` is different from running it from `infra/orders-exports/prod`. The files, variables, backend, credentials, state, and region may all be different.

Start by naming the environment in your shell:

```bash
cd infra/orders-exports/dev
```

That small habit prevents one of the most expensive workflow mistakes: reviewing one environment while applying from another.

## The Example Environment

The example environment creates one private S3 bucket for invoice exports. It also enables bucket versioning so overwritten objects can be recovered during learning, and it blocks public access at the bucket level.

The important resources are:

| Resource address | AWS object | Why it exists |
| --- | --- | --- |
| `aws_s3_bucket.exports` | S3 bucket | Stores generated invoice files |
| `aws_s3_bucket_public_access_block.exports` | Bucket public access settings | Keeps accidental public policies and ACLs from taking effect |
| `aws_s3_bucket_versioning.exports` | Bucket versioning settings | Keeps object versions when files are overwritten |

A compact version of the configuration looks like this:

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

resource "aws_s3_bucket" "exports" {
  bucket = "dp-orders-exports-dev-123456"

  tags = {
    Name        = "orders-exports-dev"
    Environment = "dev"
    Service     = "orders"
  }
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket = aws_s3_bucket.exports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "exports" {
  bucket = aws_s3_bucket.exports.id

  versioning_configuration {
    status = "Enabled"
  }
}

output "bucket_name" {
  value = aws_s3_bucket.exports.bucket
}
```

This is enough infrastructure to make the workflow meaningful. The bucket name has to be unique. The two companion resources reference `aws_s3_bucket.exports.id`, so Terraform knows the bucket must exist before it configures public access blocking and versioning.

## Init

`terraform init` prepares the working directory:

```bash
terraform init
```

Terraform reads the provider requirements, installs the AWS provider, initializes modules, and prepares backend access. It also creates local working files under `.terraform`. That directory is generated by Terraform and should stay out of normal editing.

For the orders export environment, init answers practical questions:

| Question | Evidence from init |
| --- | --- |
| Can Terraform install the AWS provider? | Provider installation succeeds |
| Which provider version was selected? | `.terraform.lock.hcl` records the selected version |
| Is backend configuration usable? | Backend initialization succeeds |
| Is this directory ready for planning? | Init completes without an error |

Run init when you start in a new Terraform directory, when provider requirements change, when module sources change, or when backend configuration changes. A stale working directory can fail before Terraform reaches the useful review step.

## Fmt

`terraform fmt` rewrites Terraform configuration into the standard format:

```bash
terraform fmt
```

Formatting is mechanical. It aligns indentation, spacing, and expression layout so reviewers do not spend attention on style differences. It does not prove that the bucket name is correct, that public access is safe, or that the AWS account is the intended account.

Teams often run this locally before opening a pull request and in CI with `-check`:

```bash
terraform fmt -check
```

The local command rewrites files. The CI command reports whether files need formatting. That makes formatting a small, repeatable step instead of a review discussion.

## Validate

`terraform validate` checks whether Terraform can understand the configuration:

```bash
terraform validate
```

Validation catches syntax errors, missing references, invalid block shapes, and many type mistakes. In the example environment, it can catch a misspelled resource reference such as `aws_s3_bucket.export.id` when the real address is `aws_s3_bucket.exports.id`.

Validation has a clear boundary. It does not prove that the AWS credentials point to the intended account. It does not prove that the bucket name is available globally. It does not prove that the tags match the team's cost model. Those checks happen through plan review, provider API calls, and service verification.

Use validation as an early signal. If Terraform cannot understand the files, plan and apply are not ready.

## Plan

`terraform plan` creates the proposed change:

```bash
terraform plan
```

Terraform reads configuration, reads state, refreshes managed resources through providers by default, builds a graph, and proposes the actions needed to make managed infrastructure match the files.

For the first run of the orders export environment, the summary should look like this:

```text
Plan: 3 to add, 0 to change, 0 to destroy.
```

That summary should match the story: create one bucket, one public access block, and one versioning configuration.

The plan body shows the resources. A shortened version might include:

```text
  # aws_s3_bucket.exports will be created
  + resource "aws_s3_bucket" "exports" {
      + arn    = (known after apply)
      + bucket = "dp-orders-exports-dev-123456"
      + tags   = {
          + "Environment" = "dev"
          + "Name"        = "orders-exports-dev"
          + "Service"     = "orders"
        }
    }

  # aws_s3_bucket_public_access_block.exports will be created
  + resource "aws_s3_bucket_public_access_block" "exports" {
      + block_public_acls       = true
      + block_public_policy     = true
      + bucket                  = (known after apply)
      + ignore_public_acls      = true
      + restrict_public_buckets = true
    }

  # aws_s3_bucket_versioning.exports will be created
  + resource "aws_s3_bucket_versioning" "exports" {
      + bucket = (known after apply)

      + versioning_configuration {
          + status = "Enabled"
        }
    }
```

The `+` symbols mean create. The `(known after apply)` markers appear because the public access block and versioning settings need the bucket identity after AWS creates the bucket.

Plan review starts with the summary, then moves into the details that carry risk:

| Review question | What to inspect |
| --- | --- |
| Is this the expected environment? | Working directory, backend, workspace if used, AWS account, region |
| Are creates expected? | `Plan: 3 to add` for this first run |
| Are destroys or replacements present? | Any `-` or `-/+` resource actions |
| Is public exposure changing? | Public access block settings, bucket policies, ACL-related resources |
| Are names and tags right? | Bucket name, `Environment`, `Service`, ownership tags |
| Are unknown values acceptable? | Values marked `(known after apply)` |

For shared environments, teams often save the reviewed plan:

```bash
terraform plan -out=tfplan
```

A saved plan lets apply execute the exact plan that was reviewed. Treat it as short-lived. If the configuration, variables, provider selections, or real infrastructure changes afterward, create a fresh plan.

## Apply

`terraform apply` performs the approved actions:

```bash
terraform apply
```

If you use a saved plan, pass the plan file:

```bash
terraform apply tfplan
```

Apply is where Terraform calls real AWS APIs. For the example environment, the AWS provider creates the S3 bucket first. Then it configures public access blocking and versioning, because both resources reference the bucket.

Apply also writes state after successful operations. That state records which real bucket belongs to `aws_s3_bucket.exports`, along with provider-reported attributes Terraform needs later.

Before approving apply in a shared account, answer three questions:

- Does the plan match the approved change?
- Is the root module the intended environment?
- Are the credentials, region, and state backend for the intended AWS account?

If one answer is unclear, pause before apply. A Terraform command does exactly what its provider credentials allow.

## Verify

Terraform can report that AWS accepted the change. The system still needs evidence that the environment behaves the way the team intended.

Start with Terraform's output:

```bash
terraform output bucket_name
```

Then check AWS directly. The AWS CLI commands below read the bucket's location, public access block, and versioning status:

```bash
aws s3api get-bucket-location \
  --bucket dp-orders-exports-dev-123456

aws s3api get-public-access-block \
  --bucket dp-orders-exports-dev-123456

aws s3api get-bucket-versioning \
  --bucket dp-orders-exports-dev-123456
```

The exact output shape depends on the command, but the useful fields are small:

```json
{
  "PublicAccessBlockConfiguration": {
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }
}
```

```json
{
  "Status": "Enabled"
}
```

This verification step checks the provider result from the AWS side. For larger systems, verification might include an application health check, a route lookup, a security group test, a CloudWatch metric, or a smoke test. The habit is the same: Terraform success means the infrastructure operation completed. Verification proves the infrastructure serves the system.

## Destroy

`terraform destroy` removes resources managed by the current state:

```bash
terraform destroy
```

Destroy is useful for learning and short-lived development environments. Terraform reads state, builds the dependency graph in reverse, and proposes deletion of managed resources. For the S3 example, it removes Terraform's management records for the companion bucket settings and then attempts to remove the bucket itself.

S3 has two extra gotchas. First, a bucket with objects in it usually cannot be deleted until it is empty. Versioned buckets may also contain old object versions and delete markers, so "empty" has to include versions. Second, once bucket versioning has been enabled, AWS cannot return that bucket to a never-versioned state; it can only suspend versioning. That usually does not matter when the bucket itself is being deleted, but it matters if a later plan tries to turn versioning off on a live bucket. The example is a learning environment, so keep the bucket empty or delete test object versions before destroy. Some teams use `force_destroy` for disposable buckets, but that setting deserves careful review because it can delete objects during bucket removal.

Review the destroy plan the same way you review an apply plan:

```text
Plan: 0 to add, 0 to change, 3 to destroy.
```

For this learning environment, three destroys are expected. In production, a whole-environment destroy belongs behind strong review boundaries. Teams usually remove specific resources from configuration and review the resulting plan instead of destroying an entire root module.

After destroy, verify that the bucket is gone:

```bash
aws s3api head-bucket --bucket dp-orders-exports-dev-123456
```

AWS should return an error because the bucket no longer exists or is no longer accessible to the caller.

## OpenTofu Workflow

OpenTofu uses the same workflow shape with the `tofu` command:

| Terraform | OpenTofu | Job |
| --- | --- | --- |
| `terraform init` | `tofu init` | Prepare providers, modules, and backend |
| `terraform fmt` | `tofu fmt` | Format configuration |
| `terraform validate` | `tofu validate` | Check configuration structure |
| `terraform plan` | `tofu plan` | Preview proposed changes |
| `terraform apply` | `tofu apply` | Apply approved changes |
| `terraform destroy` | `tofu destroy` | Remove managed resources |

Use one toolchain consistently for a project. Mixing Terraform and OpenTofu against the same state, provider lock files, and automation path can create avoidable confusion unless the team has planned the migration carefully.

## Common First Mistakes

The workflow is simple, but the first mistakes tend to be practical.

**Running from the wrong directory.** Terraform reads the root module in the current working directory unless you use `-chdir`. Check the path before planning or applying.

**Skipping init after dependency changes.** Provider requirements, module sources, and backend settings can require a fresh `terraform init`.

**Expecting validate to check AWS reality.** Validation checks configuration shape. Plan, apply, and verification are where AWS account, region, resource name, and API behavior become visible.

**Trusting the summary without reading risky resources.** The summary tells you the count. The body tells you whether public access, replacement, names, tags, or data-bearing resources are changing.

**Applying from habit.** Apply makes real API calls using the active credentials. Confirm the plan, directory, account, region, and state backend before approval.

**Saving a plan for too long.** A saved plan should be used soon after review. If the code or infrastructure changes, make a new plan.

**Forgetting S3 cleanup behavior.** Destroying a bucket can fail when objects remain. Empty disposable learning buckets before destroy or use a reviewed cleanup policy.

## Putting It All Together

The opening problem was a small AWS environment that needed a safe path from files to reality.

The workflow gave each step a job. The working directory selected the root module and environment. `init` prepared providers, modules, and backend access. `fmt` removed formatting noise. `validate` checked whether Terraform could understand the configuration. `plan` showed the proposed S3 bucket, public access block, and versioning changes before anything happened. `apply` made the approved AWS changes and wrote state. Verification checked AWS directly. `destroy` cleaned up the temporary environment when the exercise was finished.

That sequence is the daily Terraform habit: prepare the directory, keep the files readable, validate early, review the plan carefully, apply deliberately, verify outside Terraform, and clean up temporary resources.

## What's Next

The next Terraform section opens the configuration model in more detail: providers, resources, data sources, references, variables, locals, outputs, and the patterns that keep larger AWS modules readable.

---

**References**

- [Terraform CLI overview](https://developer.hashicorp.com/terraform/cli/commands) - Overview of Terraform CLI commands, including `init`, `validate`, `plan`, `apply`, `destroy`, and `fmt`.
- [Initialize the Terraform working directory](https://developer.hashicorp.com/terraform/cli/init) - CLI reference for provider installation, module initialization, backend setup, and `.terraform` working files.
- [terraform fmt command](https://developer.hashicorp.com/terraform/cli/commands/fmt) - CLI reference for rewriting Terraform configuration in the standard format.
- [terraform validate command](https://developer.hashicorp.com/terraform/cli/commands/validate) - CLI reference for checking configuration syntax and internal consistency.
- [terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - CLI reference for previewing changes from configuration, state, and provider data.
- [terraform apply command](https://developer.hashicorp.com/terraform/cli/commands/apply) - CLI reference for applying an approved Terraform plan.
- [terraform destroy command](https://developer.hashicorp.com/terraform/cli/commands/destroy) - CLI reference for destroying managed resources.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Terraform Registry documentation for configuring and using the AWS provider.
- [aws_s3_bucket_versioning resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning) - Resource reference for managing S3 bucket versioning with the AWS provider.
- [aws_s3_bucket_public_access_block resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block) - Resource reference for managing S3 public access block settings with the AWS provider.
- [Using versioning in S3 buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) - AWS explanation of S3 bucket versioning behavior and version lifecycle.
- [AWS CLI get-public-access-block](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-public-access-block.html) - AWS CLI reference for reading bucket public access block settings.
- [AWS CLI get-bucket-versioning](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-bucket-versioning.html) - AWS CLI reference for reading S3 bucket versioning status.
- [OpenTofu CLI commands](https://opentofu.org/docs/cli/commands/) - OpenTofu command reference for the equivalent workflow commands.

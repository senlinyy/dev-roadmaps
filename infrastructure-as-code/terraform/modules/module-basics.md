---
title: "Module Basics"
description: "Terraform modules, why they exist, and how a first reusable module fits into real projects."
overview: "Terraform modules let teams package related resources into a reusable unit with clear inputs and outputs. This article starts with repeated bucket code, then extracts one folder that dev, staging, and production can all call safely."
tags: ["modules", "reuse", "terraform", "hcl"]
order: 1
id: article-iac-terraform-modules-basics
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/module-basics.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/module-basics.md
---

## Table of Contents

1. [The Copy-Paste Problem](#the-copy-paste-problem)
2. [What a Module Is](#what-a-module-is)
3. [Extracting One Private Bucket Module](#extracting-one-private-bucket-module)
4. [Calling the Module from an Environment](#calling-the-module-from-an-environment)
5. [How Terraform Tracks Module Resources](#how-terraform-tracks-module-resources)
6. [Where the Boundary Really Is](#where-the-boundary-really-is)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Copy-Paste Problem
<!-- section-summary: Modules remove repeated infrastructure code by letting several root configurations call the same reusable resource pattern. -->

A familiar Terraform story starts with the Orders team needing a private S3 bucket in development for build artifacts. The code is simple, so someone copies it into staging. A week later, production needs the same bucket with a longer retention policy, so the team copies it again.

The three folders now look almost the same:

```hcl
resource "aws_s3_bucket" "artifacts" {
  bucket = "dp-orders-artifacts-dev"

  tags = {
    service     = "orders"
    environment = "dev"
    managed_by  = "terraform"
  }
}
```

At first, the copied files look manageable. Then security asks for every artifact bucket to block public access, enable versioning, and declare the bucket's default server-side encryption configuration. Amazon S3 applies default encryption to new objects, and the team still wants the baseline written in Terraform so reviews can see the intended bucket policy clearly. Production gets the fix first. Staging gets it later. Development keeps the old copy because nobody noticed it.

That drift is the problem modules solve. A **Terraform module** lets the team write the bucket pattern once and call it from each environment with different values. The shared structure lives in one folder. The environment-specific choices stay in each root configuration.

The module changes where review happens. Reviewers now look at the module once for the shared pattern and look at each environment root for the values passed into that pattern.

## What a Module Is
<!-- section-summary: A module is just a Terraform directory with a public interface around the files inside it. -->

A module is a directory of Terraform files. The directory where you run `terraform plan` is the **root module**. A module called by the root is a **child module**.

Terraform accepts any `.tf` filenames, but reusable modules often use this small layout:

- `modules/private-bucket/main.tf` contains the resources the module creates.
- `modules/private-bucket/variables.tf` declares the inputs callers can set.
- `modules/private-bucket/outputs.tf` declares the values callers can consume.

`variables.tf` declares what callers can pass in. `main.tf` creates the resources. `outputs.tf` returns selected values to the caller. This convention helps reviewers find the module's public interface quickly.

The important shift is that callers stop copying resource blocks. They call a folder that owns the reviewed pattern. If the bucket pattern needs one more security control later, the module changes once, and each environment sees the proposed change in its own plan.

A reusable module has a small public contract. Inputs are the knobs callers can set. Outputs are the values callers can consume. Everything else inside the module should be treated as an implementation detail, even though Terraform will still show the internal resource addresses in plans and state.

## Extracting One Private Bucket Module
<!-- section-summary: A small private bucket module shows how variables feed resources and outputs return the useful result. -->

The team starts with a small module. It creates a private artifact bucket, enables versioning, blocks public access, declares default SSE-S3 encryption, and applies consistent tags.

The shape is simple before the details are filled in:

- `modules/private-bucket/variables.tf` declares the caller-facing inputs.
- `modules/private-bucket/main.tf` creates the bucket and the baseline controls.
- `modules/private-bucket/outputs.tf` returns the values callers can use.

The interface starts in `variables.tf`. The caller must provide a globally unique bucket name and an environment name. Extra tags stay optional because not every environment has the same ownership or billing tags.

```hcl
variable "bucket_name" {
  type        = string
  description = "Globally unique name for the private artifact bucket."
}

variable "environment" {
  type        = string
  description = "Environment name used for tags and review."
}

variable "tags" {
  type        = map(string)
  description = "Extra tags applied to resources created by this module."
  default     = {}
}
```

The first resource in `main.tf` creates the bucket itself and merges the module's standard tags with caller-provided tags. The caller can add ownership details, while the module keeps `service`, `environment`, and `managed_by` consistent.

```hcl
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name

  tags = merge(
    {
      service     = "orders"
      environment = var.environment
      managed_by  = "terraform"
    },
    var.tags
  )
}
```

The next resources attach the bucket controls. Each resource uses `aws_s3_bucket.this.id`, so Terraform knows the controls belong to the bucket created by this module.

```hcl
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
```

The encryption resource sets the bucket's default encryption rule to SSE-S3, shown as `AES256` in the AWS and Terraform settings. This example keeps the module small. A production module that needs customer-managed keys can accept a KMS key ARN as an input and switch this resource to SSE-KMS.

Public access blocking is a good example of a baseline the caller should not have to remember. The module always enables the four block settings.

```hcl
resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

Versioning is another baseline for artifact buckets because a bad upload or accidental overwrite should have a recovery path.

```hcl
resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

The final file, `outputs.tf`, returns the values callers are allowed to use. A bucket name helps humans and scripts. A bucket ARN helps IAM policies grant access without rebuilding the ARN string by hand.

```hcl
output "bucket_name" {
  value       = aws_s3_bucket.this.bucket
  description = "Name of the private bucket created by the module."
}

output "bucket_arn" {
  value       = aws_s3_bucket.this.arn
  description = "ARN of the private bucket, useful for IAM policies."
}
```

The module interface uses words the caller understands: bucket name, environment, tags, bucket ARN. The internal AWS resources can stay inside the module.

The module also makes a deliberate safety choice. It always enables public access blocking and versioning. The caller can choose the bucket name and tags, but it cannot accidentally turn off those baseline controls through this first interface. That is one reason teams create internal modules: the repeated pattern can include the organization's safe defaults.

## Calling the Module from an Environment
<!-- section-summary: A module block points at the module source and supplies the values declared in the child module's variables. -->

The production root module calls the child module with a `module` block:

![Module Reuse Flow](/content-assets/articles/article-iac-terraform-modules-basics/module-reuse-flow.png)

*The reuse flow shows how one module call can create the same safe pattern for dev and staging with different input values.*

```hcl
module "artifact_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "dp-orders-artifacts-prod"
  environment = "prod"

  tags = {
    owner       = "platform"
    cost_center = "orders"
  }
}
```

The `source` argument points to the module folder. The other arguments match variables declared by the child module. If the caller misspells `bucket_name`, Terraform reports an input error during planning.

A fresh checkout needs initialization before planning because Terraform has to load the module source:

```bash
terraform init
terraform validate
terraform plan
```

For a local module path, `terraform init` records the module relationship. For a remote module source, it downloads the module into `.terraform/modules/`. A local module init often shows the child module path directly:

```console
Initializing modules...
- artifact_bucket in ../../modules/private-bucket

Terraform has been successfully initialized!
```

`terraform validate` should report success or name the bad input. `terraform plan` should show module-scoped addresses such as `module.artifact_bucket.aws_s3_bucket.this` and a plan summary. Reviewers look there for surprise creates, replacements, or destroys:

```console
Terraform will perform the following actions:

  # module.artifact_bucket.aws_s3_bucket.this will be created
  + resource "aws_s3_bucket" "this" {
      + bucket = "dp-orders-artifacts-prod"
    }

  # module.artifact_bucket.aws_s3_bucket_public_access_block.this will be created
  + resource "aws_s3_bucket_public_access_block" "this" {
      + block_public_acls       = true
      + block_public_policy     = true
      + ignore_public_acls      = true
      + restrict_public_buckets = true
    }

  # module.artifact_bucket.aws_s3_bucket_server_side_encryption_configuration.this will be created
  + resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
      + rule {
          + apply_server_side_encryption_by_default {
              + sse_algorithm = "AES256"
            }
        }
    }

  # module.artifact_bucket.aws_s3_bucket_versioning.this will be created
  + resource "aws_s3_bucket_versioning" "this" {
      + versioning_configuration {
          + status = "Enabled"
        }
    }

Plan: 4 to add, 0 to change, 0 to destroy.
```

That plan shows both sides of the boundary. The caller is still one `module "artifact_bucket"` block, while the plan reveals the managed resources Terraform will create inside that child module.

The root can use module outputs with `module.<name>.<output>`. For example, an IAM policy can use the bucket ARN without copying it into a string:

```hcl
resource "aws_iam_policy" "artifact_writer" {
  name = "orders-artifact-writer"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject"
      ]
      Resource = "${module.artifact_bucket.bucket_arn}/*"
    }]
  })
}
```

That reference gives Terraform dependency information. The policy needs the module output, and the module output comes from the bucket.

The caller should use the output rather than rebuilding the ARN string by hand. The output is the module author's promise that this value is stable enough for other code. If the module later changes the internal bucket resource name, the caller can keep using `module.artifact_bucket.bucket_arn`.

## How Terraform Tracks Module Resources
<!-- section-summary: Terraform finds local modules directly and downloads remote modules during init, then gives every child resource a module-scoped address. -->

Terraform loads modules during `terraform init`. Local modules come from paths in your repository. Registry and Git modules are downloaded into `.terraform/modules/`.

![Root Child State Boundary](/content-assets/articles/article-iac-terraform-modules-basics/root-child-state-boundary.png)

*The state boundary shows that module resources still live in one graph and one state file for the root run.*

After loading the child module, Terraform gives each internal resource a full address. The bucket inside the production call is:

```hcl
module.artifact_bucket.aws_s3_bucket.this
```

That address appears in plans, state, and error messages. Another environment can call the same module with the same internal resource name, and the module path keeps the addresses separate.

If a plan says `module.artifact_bucket.aws_s3_bucket_public_access_block.this` will change, the reviewer knows the change came from the private bucket module. The module call tells which environment values were passed in.

State follows the full module address. If the team later renames the module call from `artifact_bucket` to `orders_artifact_bucket`, Terraform sees a different module path unless the refactor includes a `moved` block. Module names are part of the address, so a rename deserves the same care as a resource rename.

## Where the Boundary Really Is
<!-- section-summary: The root module owns the run, backend, and state boundary, while child modules contribute resources to that same run. -->

Modules organize Terraform code. Root modules and backends define the operational boundary.

If `live/prod` calls `module.artifact_bucket`, the bucket belongs to the production root run and production state. If `live/dev` calls the same module source, the development bucket belongs to the development root run and development state.

Provider configuration also starts at the root. A child module usually uses the provider configuration passed by the root. That means a module can be reusable while the environment still controls the account, region, credentials, backend, variables, and approval rules.

This is where beginners sometimes overfill a child module. A bucket module should create the bucket pattern. The root should decide which environment is running, which backend state is used, which provider account is targeted, and which module version or path is called. Keeping that boundary clean gives plan reviewers a direct path from the root call to the managed resources.

This is the beginner habit to keep: **reuse the structure, vary the values, and keep each environment's state separate**.

## Putting It All Together
<!-- section-summary: A useful module gives teams one reviewed resource pattern while each root configuration keeps its own values, state, and review flow. -->

The Orders team replaced three copied bucket files with one module and three module calls. The module owns the repeated pattern: bucket, public access block, default encryption, versioning, tags, and outputs. The environment roots own names, tags, backend state, provider target, and approval flow.

After the platform team improves the module, development can plan and apply first. Staging can follow. Production can wait for its normal review. The shared module gives consistency without forcing every environment to change at the same moment.

![Module Basics Field Guide](/content-assets/articles/article-iac-terraform-modules-basics/module-basics-field-guide.png)

*The field guide closes the article by separating the caller, the child module, the shared resource pattern, and the state boundary.*

## What's Next

The next article zooms in on the module contract: input types, validation rules, outputs, sensitive values, and how one module output feeds another module's input.

---

**References**

- [Terraform: Modules overview](https://developer.hashicorp.com/terraform/language/modules) - Explains root modules, child modules, and module reuse.
- [Terraform: Module block](https://developer.hashicorp.com/terraform/language/block/module) - Documents the `module` block arguments callers use.
- [Terraform: Standard module structure](https://developer.hashicorp.com/terraform/language/modules/develop/structure) - Documents common module file layout and public interface conventions.
- [Terraform: Module sources](https://developer.hashicorp.com/terraform/language/modules/configuration) - Documents local, registry, Git, and other module source formats.
- [AWS provider: aws_s3_bucket_server_side_encryption_configuration](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_server_side_encryption_configuration) - Documents the Terraform resource used to configure S3 bucket default encryption.
- [Amazon S3: Default bucket encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html) - Documents S3 default encryption behavior and SSE-S3/SSE-KMS choices.

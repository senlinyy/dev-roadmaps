---
title: "Module Basics"
description: "Learn what Terraform modules are, why they exist, and how to create and use your first reusable module."
overview: "Terraform modules let teams package related resources into a reusable unit with clear inputs and outputs. This article follows one platform team as it turns repeated infrastructure code into a shared module that still keeps each environment separate."
tags: ["modules", "reuse", "terraform", "hcl"]
order: 1
id: article-iac-terraform-modules-basics
---

## Table of Contents

1. [The Problem Modules Solve](#the-problem-modules-solve)
2. [What a Module Actually Is](#what-a-module-actually-is)
3. [Your First Module: A Private Bucket](#your-first-module-a-private-bucket)
4. [Calling a Module From the Root Configuration](#calling-a-module-from-the-root-configuration)
5. [How Terraform Resolves a Module Call](#how-terraform-resolves-a-module-call)
6. [The Root Module and Child Modules](#the-root-module-and-child-modules)
7. [What a Module Boundary Hides](#what-a-module-boundary-hides)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem Modules Solve
<!-- section-summary: Modules remove repeated infrastructure code by letting several root configurations call the same reusable resource pattern. -->

A **Terraform module** is a directory of Terraform configuration files that Terraform can load as one reusable unit. It can declare inputs, create resources, and return outputs to the configuration that called it. The simplest way to think about it is a reusable infrastructure recipe: the recipe stays in one place, and each environment gives it different ingredients.

Imagine the DevPolaris Orders team has three environments: development, staging, and production. Each environment needs the same kind of private artifact bucket for build outputs, invoice exports, and deployment packages. The names differ, the tags differ, and production keeps data for longer, but the core shape stays the same: one S3 bucket, versioning, encryption, and a public access block.

The first version often starts as copy and paste. Someone writes the bucket resources in `envs/dev`, copies them into `envs/staging`, and copies them again into `envs/prod`. A security review then asks every bucket to enable the same encryption rule. The team updates production, forgets staging, and leaves development with the old setting. Nobody wanted drift, but three copies created three places to miss.

Modules solve that kind of repetition. The platform team writes the private bucket pattern once in `modules/private-bucket`. Each environment calls that module and passes its own bucket name, tags, and retention settings. A future security fix happens in the module once, and every environment sees the same proposed change the next time it runs `terraform plan`.

This is the first important habit with modules: **reuse the structure, vary the values**. The module owns the common resource pattern. The root configuration owns the environment-specific decisions.

## What a Module Actually Is
<!-- section-summary: A module is just a Terraform directory with a public interface around the files inside it. -->

A module starts as a normal directory with `.tf` files. Terraform treats every configuration directory as a module, including the directory where the team runs `terraform plan` and `terraform apply`. That command directory is the **root module**, and any module it calls is a **child module**.

Inside a module, teams usually use three conventional files. `main.tf` holds resources and data sources. `variables.tf` declares the input values callers may provide. `outputs.tf` declares the selected values callers may read after the module has done its work. Terraform accepts any `.tf` filename, and the convention helps reviewers find the interface quickly.

![A Terraform module accepts caller inputs, creates resources inside a boundary, and exposes selected outputs.](/content-assets/articles/article-iac-terraform-modules-basics/module-reuse-flow.png)

*The module boundary keeps the repeated resource pattern in one place while callers pass only the values that change.*

Here is the private bucket module on disk:

```
modules/
  private-bucket/
    main.tf
    variables.tf
    outputs.tf
```

That directory becomes useful because it has a clear boundary. Callers can work from the inputs the module asks for and the outputs it gives back. A good module turns several low-level provider resources into one reviewed team pattern, so every caller avoids relearning which internal resource enables versioning or which resource blocks public access.

## Your First Module: A Private Bucket
<!-- section-summary: A small private bucket module shows how variables feed resources and outputs return the useful result. -->

The Orders team starts with a small module because small modules are easier to trust. The module creates a private S3 bucket for artifacts and exports. It also adds versioning and server-side encryption, because the team wants those controls on every bucket of this kind.

The module uses variables for the values that differ between environments. Development can pass `dp-orders-artifacts-dev`, production can pass `dp-orders-artifacts-prod`, and both environments still receive the same privacy and encryption pattern.

`variables.tf`:

```hcl
variable "bucket_name" {
  type        = string
  description = "Globally unique name for the private artifact bucket."
}

variable "environment" {
  type        = string
  description = "Environment name used for tagging and review."
}

variable "tags" {
  type        = map(string)
  description = "Extra tags applied to every resource created by this module."
  default     = {}
}
```

`main.tf`:

```hcl
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name

  tags = merge(
    {
      service     = "devpolaris-orders"
      environment = var.environment
      managed_by  = "terraform"
    },
    var.tags
  )
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
```

`outputs.tf`:

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

Notice how the module speaks in business terms at the edge. The caller provides a bucket name and an environment. The internals translate those values into several AWS resources. That is the practical value of a module: it gives the team one reviewed way to create a private bucket instead of asking every environment owner to remember each supporting resource.

## Calling a Module From the Root Configuration
<!-- section-summary: A module block points at the module source and supplies the values declared in the child module's variables. -->

A **module call** is a `module` block in the root configuration. It tells Terraform where the child module lives and which input values this specific call should use. The label after `module`, such as `"artifact_bucket"`, becomes the local name callers use to reference outputs.

The production root configuration might call the private bucket module like this:

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

The `source` argument points to the module code. A local path such as `../../modules/private-bucket` tells Terraform to read files from the repository checkout. The other arguments match variables in the child module. Terraform checks those names during planning, so a misspelled input becomes a clear error before any cloud API call happens.

The root can then use the child module outputs with `module.<name>.<output>`. If the deployment role needs permission to write artifacts into the bucket, the IAM policy can reference `module.artifact_bucket.bucket_arn` instead of copying a bucket ARN string by hand.

```hcl
resource "aws_iam_policy" "artifact_writer" {
  name = "orders-artifact-writer"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject"
      ]
      Resource = "${module.artifact_bucket.bucket_arn}/*"
    }]
  })
}
```

This reference creates a real dependency. Terraform understands that the policy needs the bucket ARN, so it evaluates the module output before it finishes the policy. The team gets wiring, ordering, and review evidence from one expression.

## How Terraform Resolves a Module Call
<!-- section-summary: Terraform finds local modules directly and downloads remote modules during init, then gives every child resource a module-scoped address. -->

Terraform resolves a module call by finding the source code for the module. Local paths such as `./modules/private-bucket` and `../shared/private-bucket` come from the filesystem. Registry, Git, HTTP archive, and other remote sources are installed during `terraform init`.

For a local module, the team usually edits the module files in the same repository as the root configuration. Terraform reads the latest local files during planning, so a change in `modules/private-bucket/main.tf` appears in the next plan for any environment that calls it. The team still runs `terraform init` when it adds a new module call or changes the `source` address, because Terraform has to refresh its module installation metadata.

For a remote module, Terraform downloads a copy into `.terraform/modules/` during `terraform init`. A Registry module can use a `version` argument, and a Git module can use a `ref` query parameter. Those choices matter because the root configuration depends on the downloaded code, just like an application depends on a library package.

After Terraform loads the module, it gives each internal resource a full address that includes the module path. The bucket resource inside the production call becomes `module.artifact_bucket.aws_s3_bucket.this`. Another module call could also contain an `aws_s3_bucket.this` resource, and the addresses stay separate because the module path scopes them.

This address shows up in plans, state, and error messages. When a production plan says `module.artifact_bucket.aws_s3_bucket_public_access_block.this` will change, the reviewer can trace the change back to the module call and the internal resource that produced it.

## The Root Module and Child Modules
<!-- section-summary: The root module owns the run, backend, and state boundary, while child modules contribute resources to that same run. -->

The **root module** is the directory where the team runs Terraform commands. It owns the backend configuration, the provider configuration, and the state boundary for that run. The **child modules** contribute resources to the root module's graph and share that root state file by default.

![The root module owns the Terraform run and state file while child modules contribute namespaced resources.](/content-assets/articles/article-iac-terraform-modules-basics/root-child-state-boundary.png)

*Child modules keep resource names scoped, while the root module still controls the shared state and apply boundary.*

This distinction matters in production. If `envs/prod` calls `module.artifact_bucket`, that bucket lands in the production state for `envs/prod`. If `envs/dev` calls the same module source with different inputs, the development bucket lands in the development state for `envs/dev`. The module code can be shared, while the managed infrastructure stays separated by root module and backend.

Provider configuration also starts at the root. If the root configures the AWS provider for `eu-west-2`, child modules that use the default AWS provider inherit that configuration. Provider aliases can pass different provider configurations to child modules, but the root still decides that wiring.

This is why modules and environments solve different problems. Modules reduce repeated code. Root modules and backends draw operational boundaries. A shared module can create the same resource pattern in several environments, but each environment needs its own root run and state if the team wants separate blast radius.

## What a Module Boundary Hides
<!-- section-summary: Modules hide internal resources from callers, but they still share provider credentials and state through the root run. -->

A module boundary hides internal resource names and implementation details. The root configuration reaches child module values through outputs. The module author exposes the bucket ARN with an output such as `bucket_arn`, and the root reads it through `module.artifact_bucket.bucket_arn`.

That output rule protects callers from internal refactors. The module author can add lifecycle rules, switch encryption configuration, or split one internal resource into several resource blocks. Callers keep working as long as the input and output contract stays stable.

The boundary also has limits. A Terraform module organizes configuration, while provider credentials still come from the root run. The child module uses the provider configuration and credentials that the root gives it. A data source inside the module can read whatever the active provider identity has permission to read.

In real teams, this means module review should include two questions. First, does the module expose only the outputs callers genuinely need? Second, does the module avoid surprising provider behavior, such as reading a shared resource by a hardcoded name? Those questions keep modules reusable instead of turning them into hidden bundles of assumptions.

## Putting It All Together
<!-- section-summary: A useful module gives teams one reviewed resource pattern while each root configuration keeps its own values, state, and review flow. -->

The Orders team now has a small but useful module. `modules/private-bucket` owns the repeated resource pattern: bucket, public access block, versioning, encryption, tags, and outputs. `envs/dev`, `envs/staging`, and `envs/prod` each call that module with their own values.

![Terraform module basics summary showing repeated roots calling one shared private bucket module with separate state.](/content-assets/articles/article-iac-terraform-modules-basics/module-basics-field-guide.png)

*A module removes copied resource code, while separate root modules keep dev, staging, and production runs independent.*

When the platform team improves the module, every environment sees the same proposed change through its own plan. Development can apply first, staging can follow after verification, and production can wait for normal approval. The module gives consistency, and the root modules preserve control.

The big idea is simple enough to keep using everywhere: **common structure belongs in a module, environment decisions belong in the root configuration**. That split gives Terraform code a shape that reviewers can read and teams can reuse.

## What's Next

The next article goes deeper into the module contract: input types, validation rules, sensitive values, outputs, and how one module output becomes another module's input without coupling the modules together.

---

**References**

- [Modules Overview (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules), Official overview of root modules, child modules, module sources, and common module workflows.
- [Module Block Reference (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/block/module), Reference for `module` block syntax, `source`, `version`, providers, `count`, `for_each`, and module output references.
- [Standard Module Structure (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/develop/structure), Guidance on common module file layout and reusable module packaging.
- [Module Sources (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/configuration), Details on local, Registry, Git, and other module source types.

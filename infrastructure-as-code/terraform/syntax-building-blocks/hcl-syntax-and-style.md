---
title: "HCL Syntax & Style"
description: "Learn how Terraform .tf files use blocks, arguments, expressions, formatting, and references to describe real infrastructure safely."
overview: "HCL is the language Terraform reads from .tf files. This article walks through a small web service configuration, shows where variables, locals, resources, and outputs are consumed, and connects the code to the plan output you review before apply."
tags: ["terraform", "hcl", "syntax", "formatting"]
order: 1
id: article-iac-terraform-config-hcl-syntax
aliases:
  - infrastructure-as-code/terraform/configuration/hcl-syntax-and-style.md
---

## Table of Contents

1. [The Tiny Configuration We Will Read](#the-tiny-configuration-we-will-read)
2. [Blocks, Labels, and Arguments](#blocks-labels-and-arguments)
3. [Values Flow Through Variables, Locals, Resources, and Outputs](#values-flow-through-variables-locals-resources-and-outputs)
4. [References Connect the Files](#references-connect-the-files)
5. [Formatting and Review Style](#formatting-and-review-style)
6. [Common Beginner Syntax Errors](#common-beginner-syntax-errors)
7. [Putting It All Together](#putting-it-all-together)

## The Tiny Configuration We Will Read
<!-- section-summary: HCL is easiest to learn by reading one small configuration that has inputs, computed names, a resource, and an output. -->

HCL stands for **HashiCorp Configuration Language**. Terraform uses HCL in `.tf` files to describe infrastructure. The language has a small number of shapes you will see everywhere: blocks, labels, arguments, expressions, references, variables, locals, resources, and outputs.

This first article is a guided preview. We will read each piece in one small file so the syntax has a real job, then the next articles slow down and study providers, resources, variables, locals, outputs, dependencies, and one real S3 project in that order.

Imagine the DevPolaris team wants one S3 bucket for status page files. The bucket name should include the service and environment. The deployment job also needs the final bucket name after apply so it can upload `index.html`.

Here is the outline first. It is intentionally incomplete, because the article will fill each part one by one:

```hcl
variable "service_name" {
  # input details go here
}

variable "environment" {
  # input details go here
}

locals {
  # derived values go here
}

resource "aws_s3_bucket" "site" {
  # provider resource arguments go here
}

output "site_bucket_name" {
  # published result goes here
}
```

This outline gives each syntax piece a job before the details arrive. Variables accept input values. The local value creates the bucket name once. The resource sends that name and a tag map to AWS. The output publishes the bucket name after apply.

Terraform reads the filled version as one configuration, then evaluates values as far as it can during plan. The variable defaults are known immediately. The local bucket name is known because it only depends on those variables. The resource arguments are therefore visible in the plan before apply. The output reads a resource attribute, so Terraform may know it during plan or mark it as `(known after apply)` based on provider behavior.

That value path is what makes HCL useful for infrastructure review. The reviewer can see where the bucket name comes from, which provider object consumes it, and which output exposes it. Larger modules use the same pattern with database endpoints, subnet IDs, IAM role ARNs, alert thresholds, and deployment environment names.

## Blocks, Labels, and Arguments
<!-- section-summary: Blocks create structure, labels identify a block, and arguments assign values inside the block. -->

A **block** is a container in HCL. A block starts with a type, may have labels, and then has `{ }` braces around its body. In `resource "aws_s3_bucket" "site" { ... }`, `resource` is the block type, `"aws_s3_bucket"` is the provider resource type, and `"site"` is the local name.

![HCL Block Anatomy](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-block-anatomy.png)

*The anatomy view labels the parts of an HCL block so the syntax has names before the examples grow.*

An **argument** assigns a value to a name inside a block. In the S3 bucket resource, `bucket = local.bucket_name` is an argument. The AWS provider defines which arguments are valid for `aws_s3_bucket`.

Nested blocks appear inside some resources. They look like smaller blocks inside a resource body. Provider documentation tells you whether a setting is an argument or a nested block, so unfamiliar resource shapes should lead you back to the provider docs.

The official [Terraform language docs](https://developer.hashicorp.com/terraform/language) use these same names: blocks, arguments, expressions, and references. That vocabulary helps with provider documentation because resource pages describe their schema with those terms.

An **expression** is any value calculation on the right side of an argument. `"status-page"` is a string expression. `local.bucket_name` is a reference expression. `"devpolaris-${var.service_name}-${var.environment}-assets"` is a template expression. `merge(var.default_tags, var.extra_tags)` is a function call expression. Terraform evaluates these expressions to build the final values sent to providers.

A **provider** is the plugin that teaches Terraform how to talk to a platform such as AWS. Provider schemas decide which arguments and nested blocks are valid for a resource. Terraform Core understands HCL syntax, while the AWS provider tells Terraform what an `aws_s3_bucket` accepts. That is why a typo in HCL punctuation produces a Terraform language error, and a wrong S3 argument produces a provider-schema error.

## Values Flow Through Variables, Locals, Resources, and Outputs
<!-- section-summary: A beginner should trace the same value from where it is declared to where it is consumed. -->

The next step is to fill the outline from the top down. The first real content is the two variable blocks. `service_name` identifies the thing we are publishing, and `environment` identifies the target environment:

![HCL Evaluation Pipeline](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-evaluation-pipeline.png)

*The pipeline view shows how variables, locals, resources, and outputs connect during Terraform evaluation.*

```hcl
variable "service_name" {
  type    = string
  default = "status-page"
}

variable "environment" {
  type    = string
  default = "dev"
}
```

The next part of the outline is `locals`. A **local value** is a named expression that belongs to this module. Here, the local builds the bucket name once:

```hcl
locals {
  bucket_name = "devpolaris-${var.service_name}-${var.environment}-assets"
}
```

With the default values, `local.bucket_name` evaluates to `devpolaris-status-page-dev-assets`. The resource can now consume that local value through `bucket = local.bucket_name`:

```hcl
resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name
}
```

The resource also consumes the original variables in its tags:

```hcl
resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name

  tags = {
    service     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }
}
```

The final part of the outline is the output. It reads the bucket attribute from the resource so a person or deployment job can see the bucket name after apply:

```hcl
output "site_bucket_name" {
  value = aws_s3_bucket.site.bucket
}
```

That path is the beginner skill that pays off quickly. If a plan shows a bucket name or tag value, you can walk backward through the code and find the source value.

The same path matters for values supplied outside the file. A person or CI job can pass variables through a `*.tfvars` file, a `-var` flag, or an environment variable such as `TF_VAR_environment`. Once Terraform receives the value, the rest of the path is the same: variables feed locals, locals feed resources, and resources feed outputs.

Here is a small value file:

```hcl
service_name = "status-page"
environment  = "prod"
```

And here is the matching command:

```bash
terraform plan -var-file=prod.tfvars
```

The plan should show the final bucket name with `prod` in it. If it still shows `dev`, the review should stop and check which values Terraform actually received.

The relevant part of the plan should look like this:

```console
  + bucket = "devpolaris-status-page-prod-assets"

Plan: 1 to add, 0 to change, 0 to destroy.
```

That line proves the value file reached the expression that builds the bucket name. The `prod` part came from `prod.tfvars`, and the `assets` suffix came from the local value expression. The exact action summary depends on the rest of the configuration, but the evaluated name should match the environment value.

## References Connect the Files
<!-- section-summary: Terraform connects blocks by references instead of file order, so split files can still form one configuration. -->

Terraform loads every `.tf` file in the same directory as one configuration. A team might split the example into `variables.tf`, `locals.tf`, `main.tf`, and `outputs.tf`. Terraform still evaluates the whole directory together.

A **parser** is the part of Terraform that reads the HCL files and turns the text into a structured configuration Terraform can understand. A **dependency graph** is Terraform's internal map of which objects depend on which other objects. The graph is why Terraform can create the bucket before it evaluates an output that reads `aws_s3_bucket.site.bucket`.

![HCL Parser To Graph](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-parser-to-graph.png)

*The parser-to-graph view shows Terraform reading files into structure, then using references to build the dependency graph.*

The references create the connections:

| Reference | What it reads |
| --- | --- |
| `var.service_name` | The input variable named `service_name`. |
| `local.bucket_name` | The local value named `bucket_name`. |
| `aws_s3_bucket.site.bucket` | The `bucket` attribute from the S3 bucket resource. |

This is why references control Terraform behavior more than file order. `outputs.tf` can read a resource in `main.tf`, and `main.tf` can read a variable in `variables.tf`. Terraform builds the relationship graph from the references.

References also make plans more useful. If the bucket name expression changes, Terraform can show the resource argument that receives the new value. Reviewers can follow the final string through Terraform code instead of searching through shell scripts.

References also create **dependencies**, which are ordering relationships between Terraform objects. `aws_s3_bucket.site.bucket` tells Terraform that the output depends on the bucket. A security policy that references `aws_s3_bucket.site.arn` depends on the bucket too. The same syntax gives Terraform a value and a graph edge.

Wrong references usually fail before apply. A misspelled resource name, missing local value, or wrong attribute can make `terraform validate` or `terraform plan` fail. That early failure is useful because it catches broken wiring before the provider changes infrastructure.

## Formatting and Review Style
<!-- section-summary: terraform fmt and simple layout habits keep HCL review focused before infrastructure changes. -->

Before review, teams usually run `terraform fmt`. It aligns arguments, normalizes indentation, and keeps the code in the standard Terraform style. That reduces noise in pull requests because reviewers can focus on infrastructure behavior.

```bash
terraform fmt
terraform validate
terraform plan
```

`fmt` rewrites files into Terraform's standard layout. It may print the names of files it changed, or it may print nothing for files that already match the standard format. `validate` should either report success or name the exact syntax, type, or provider-schema problem. `plan` is the behavior review: check for unexpected creates, replacements, destroys, wrong names, wrong tags, and wrong environment values before apply.

A clean validation and simple first plan usually include output like this:

```console
Success! The configuration is valid.

Plan: 1 to add, 0 to change, 0 to destroy.
```

That output tells the team two different things. Validation says Terraform can understand the configuration and provider schema. The plan summary says what Terraform proposes to do with real infrastructure.

A readable Terraform file groups related settings together. Simple required arguments usually sit near the top of a resource. Tag maps should stay consistent. Blank lines can separate the resource's main identity, operational settings, and tags as the block grows.

The official [Terraform style guide](https://developer.hashicorp.com/terraform/language/style) is a useful reference for ordering and layout details. Teams usually add their own module conventions too, such as keeping provider setup in `providers.tf`, input declarations in `variables.tf`, and outputs in `outputs.tf`.

Style affects production review in infrastructure code. A clean diff helps reviewers catch a replacement, a public access setting, a broad IAM action, or a wrong environment value before apply.

Most teams also keep file layout predictable. `versions.tf` declares Terraform and provider requirements. `providers.tf` configures provider targets. `variables.tf` declares inputs. `locals.tf` names derived values. `main.tf` or service-specific files hold resources. `outputs.tf` publishes the values that callers or operators need. Terraform accepts other file names, and the convention helps review.

Style should reveal intent. Resource names such as `orders_exports` or `site_public_access` tell reviewers what role the object plays. Vague names such as `this` hide the role of a root-module resource. Deeply nested JSON policies usually stay clear with `jsonencode` and normal HCL structures. Variable validation belongs near inputs that can create a bad plan.

## Common Beginner Syntax Errors
<!-- section-summary: Most early HCL errors come from missing quotes, wrong reference names, mixed collection types, or braces in the wrong place. -->

The first common mistake is treating references like strings. `bucket = local.bucket_name` passes the local value. `bucket = "local.bucket_name"` passes the literal characters to the provider.

The second mistake is using the wrong name. If the local is called `bucket_name`, the reference is `local.bucket_name`. A reference such as `local.name` fails because Terraform cannot find that local value.

The third mistake is mixing shapes in a collection. A tag map should have string keys and string values:

```hcl
tags = {
  service     = var.service_name
  environment = var.environment
}
```

The fourth mistake is losing a brace in nested structures. A syntax error near the end of a file often points back to the blocks above it. The parser can reach the end before it can explain which earlier `{` or `}` caused the problem.

Another common mistake is mixing assignment syntax across contexts. In HCL, arguments use `name = value`. Object values also use key assignments:

```hcl
tags = {
  service = var.service_name
}
```

Function calls use comma-separated arguments:

```hcl
bucket_name = join("-", ["devpolaris", var.service_name, var.environment, "assets"])
```

If an error mentions an invalid expression or missing separator, check whether the code is inside a block body, an object value, a list, or a function call. The punctuation rules depend on that location.

After syntax fixes, `terraform validate` can confirm that the configuration is internally consistent. A fresh `terraform plan` then confirms how provider objects would change.

## Putting It All Together
<!-- section-summary: HCL gives Terraform a structured value path from declared inputs to planned provider changes. -->

HCL is the readable structure Terraform uses to build a plan. Blocks create the shape, labels identify resources and variables, arguments assign values, and references connect one block to another.

![HCL Summary](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-summary.png)

*The summary board collects the HCL reading habits used by later Terraform examples.*

The small status page bucket showed the most important path. A variable supplied a value, a local shaped it into a name, a resource consumed it, and an output published a result. That same path appears in larger modules with networks, databases, IAM roles, load balancers, and monitoring.

Terraform reading starts with the value path. Terraform writing should make that path clear for the next reviewer.

---

**References**

- [Terraform language documentation](https://developer.hashicorp.com/terraform/language) - Official reference for Terraform configuration syntax, blocks, arguments, expressions, and references.
- [Terraform style guide](https://developer.hashicorp.com/terraform/language/style) - HashiCorp guidance for Terraform formatting, file layout, naming, and module style.
- [References to named values](https://developer.hashicorp.com/terraform/language/expressions/references) - Documents references such as `var.name`, `local.name`, and `aws_s3_bucket.site.bucket`.
- [terraform fmt](https://developer.hashicorp.com/terraform/cli/commands/fmt), [terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate), and [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - CLI references for the formatting, validation, and preview commands used in this article.
- [AWS provider aws_s3_bucket](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) - Provider resource reference for the S3 bucket examples.

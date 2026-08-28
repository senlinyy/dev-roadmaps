---
title: "Module Basics"
description: "Terraform modules, why they exist, and how a first reusable module fits into real projects."
overview: "Terraform modules organize related resources as reusable, parameterized parts of one configuration graph. This article derives a private-bucket module from repeated code, then follows its inputs, outputs, provider context, resource addresses, and state identity."
tags: ["modules", "reuse", "terraform", "hcl"]
order: 1
id: article-iac-terraform-modules-basics
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/module-basics.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/module-basics.md
---

## Table of Contents

1. [Why Does Repeated Terraform Code Become a Problem?](#why-does-repeated-terraform-code-become-a-problem)
2. [What Is a Terraform Module?](#what-is-a-terraform-module)
3. [How Do You Extract a Private Bucket Module?](#how-do-you-extract-a-private-bucket-module)
4. [How Do You Call and Reuse a Module?](#how-do-you-call-and-reuse-a-module)
5. [How Do Modules Change the Terraform Graph and Addresses?](#how-do-modules-change-the-terraform-graph-and-addresses)
6. [How Do Root Modules, Providers, and State Fit Together?](#how-do-root-modules-providers-and-state-fit-together)
7. [What Makes a Useful Module Boundary?](#what-makes-a-useful-module-boundary)
8. [How Does the Complete Module Model Fit Together?](#how-does-the-complete-module-model-fit-together)
9. [Check Your Answers](#check-your-answers)

A module does not replace Terraform's normal mechanism. Terraform still reads desired configuration, builds a dependency graph, uses providers to observe and change infrastructure, and records address-to-object bindings in state. A module organizes and parameterizes one part of that same graph.

Start with one development environment and no modules. It needs a private S3 logs bucket:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "myapp-dev-logs"

  tags = {
    Environment = "dev"
    Purpose     = "logs"
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

Terraform sees two managed objects. The reference to `aws_s3_bucket.logs.id` creates a dependency from the bucket to its public-access settings. State binds addresses such as `aws_s3_bucket.logs` to the actual AWS object named `myapp-dev-logs`.

Production needs the same pattern, so the team copies the blocks into another root and changes two values: the bucket name changes to `myapp-prod-logs`, and the environment tag changes to `prod`. The public-access rules remain identical. The repeated resource blocks now leave separate development and production roots that the team must keep aligned by hand.

Keep these questions in view as you work through the lesson:

1. **Why Does Repeated Terraform Code Become a Problem?**
2. **What Is a Terraform Module?**
3. **How Do You Extract a Private Bucket Module?**
4. **How Do You Call and Reuse a Module?**
5. **How Do Modules Change the Terraform Graph and Addresses?**
6. **How Do Root Modules, Providers, and State Fit Together?**
7. **What Makes a Useful Module Boundary?**
8. **How Does the Complete Module Model Fit Together?**

## Why Does Repeated Terraform Code Become a Problem?
<!-- section-summary: Copying a resource pattern across environments creates multiple implementations that can drift, while a module separates shared rules from values that vary. -->

```text
environments/
├── dev/
│   └── main.tf
└── prod/
    └── main.tf
```

The production copy still contains the same graph:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "myapp-prod-logs"

  tags = {
    Environment = "prod"
    Purpose     = "logs"
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

The duplicated reference still orders the access block after the bucket, and each root can have its own state. The problem is not that Terraform cannot manage the copies. The problem is that humans must now keep two representations of one policy synchronized.

Copying works once, but it creates two implementations of the same rule. A later correction must reach both roots. If production receives the change and development does not, the supposedly shared bucket policy has drifted. More environments multiply the review and maintenance cost.

The repeated code naturally divides into two categories. The invariant implementation is “create a bucket and block every form of public access.” The values that vary are the bucket name, environment, and perhaps additional tags. A module packages the invariant part and turns the variations into inputs.

![Module Reuse Flow](/content-assets/articles/article-iac-terraform-modules-basics/module-reuse-flow.png)

The result is not merely fewer lines. One reviewed implementation expresses what a private application bucket means, while each environment still chooses its own identity values.

## What Is a Terraform Module?
<!-- section-summary: A module is a directory of Terraform configuration that becomes a parameterized, named subtree inside the caller's graph. -->

At the filesystem level, a Terraform module is a directory containing `.tf` configuration. The directory where you run `terraform plan` is the **root module**. A module block can load another directory as a **child module**.

A conventional reusable-module layout is:

```text
modules/
└── private-bucket/
    ├── main.tf
    ├── variables.tf
    └── outputs.tf
```

The filenames help humans; Terraform reads all `.tf` files in the directory together. The same module could technically use a single `everything.tf`. The three-file convention makes its interface and implementation easier to locate:

```text
variables → values callers may supply
resources, locals, and expressions → implementation
outputs → values the module deliberately returns
```

This resembles `function(inputs) → outputs`, but the analogy has limits. A module does not run as an isolated function and then disappear. Its resources become nodes in the root configuration's persistent infrastructure graph.

One module source can create multiple module instances. The source directory is the reusable definition; a `module "logs_bucket"` block is one named call. Calling the same source as `module "uploads_bucket"` creates a second instance with a different namespace and potentially different inputs.

Think of the distinction as definition versus instance. `modules/private-bucket` contains the reusable declaration. `module.logs_bucket` is one configured use of that declaration. `module.uploads_bucket` is another. Both expand the same internal resource names, but their module paths keep the resulting instances distinct.

Terraform does not attach special meaning to `main.tf`, `variables.tf`, and `outputs.tf`. It merges the directory's configuration before evaluation. The convention is still valuable because it makes review predictable: interface decisions are visible without scanning every resource, and implementation changes can remain focused in the files that own them.

Inputs and outputs form the public interface. A module can contain many resources, locals, expressions, and data sources while exposing only `bucket_name`, `environment`, `bucket_id`, and `bucket_arn`. Callers depend on that contract instead of the module's internal layout.

## How Do You Extract a Private Bucket Module?
<!-- section-summary: Extracting a module turns the changing values into variables, keeps the common resources inside, and publishes only useful results as outputs. -->

Create `modules/private-bucket/variables.tf` with the decisions each caller must make:

```hcl
variable "bucket_name" {
  description = "Name of the S3 bucket"
  type        = string
}

variable "environment" {
  description = "Environment that owns the bucket"
  type        = string
}
```

The interface can be read as `private_bucket(bucket_name, environment)`. Concrete environmental values no longer appear inside the implementation.

Then move the common resources into `main.tf` and replace literals with input references:

```hcl
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name

  tags = {
    Environment = var.environment
    Purpose     = "logs"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

The local resource name `this` is meaningful within the module namespace. The reference between resources still creates the same dependency as before. Parameterization changes where values originate, not Terraform's graph rules.

Finally, `outputs.tf` publishes values callers may need:

```hcl
output "bucket_id" {
  description = "ID of the bucket"
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "ARN of the bucket"
  value       = aws_s3_bucket.this.arn
}
```

The module now owns the mechanism: the bucket resource, the public-access resource, their relationship, and the fixed purpose tag. The caller owns the intent that varies: which bucket and environment it needs. Outputs reveal only the stable capabilities another part of the graph should consume.

Its flow can be summarized as:

```text
bucket_name ─────┐
environment ─────┼──▶ private-bucket module
                 │       ├── aws_s3_bucket.this
                 │       └── aws_s3_bucket_public_access_block.this
                 │
                 └────────────▶ bucket_id, bucket_arn
```

The hard-coded environmental decision `bucket = "myapp-dev-logs"` became `bucket = var.bucket_name`. The fixed public-access rule did not become a caller option because it is part of what “private bucket” promises. Deriving interfaces this way—varying values out, invariant policy in—keeps modules focused.

This is encapsulation, not secrecy. Plans and state still show internal resource addresses. The boundary means the caller talks through a deliberate interface, allowing implementation details to evolve without forcing callers to rebuild identifiers or know every low-level resource.

## How Do You Call and Reuse a Module?
<!-- section-summary: A module block identifies one source and one named instance, supplies its inputs, and exposes its outputs to the caller. -->

The development root can call the local child module like this:

```hcl
module "logs_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-dev-logs"
  environment = "dev"
}
```

Two names have different jobs. `source` answers where the reusable implementation comes from. The label `logs_bucket` names this particular module instance in the current configuration. The label is not decorative; it becomes part of every resource address inside the call.

Initialize before planning so Terraform can load module sources:

```bash
terraform init
terraform validate
terraform plan
```

Local paths are discovered from the repository. Remote registry or Git sources are downloaded under `.terraform/modules/`. Validation checks that required inputs are present and correctly shaped. The plan expands the child resources into the complete graph.

A successful local initialization may identify the source directly:

```console
Initializing modules...
- logs_bucket in ../../modules/private-bucket

Terraform has been successfully initialized!
```

The plan does not stop at one “module object.” It lists the bucket and public-access block using their full module paths. Reviewers can therefore see exactly which provider resources the abstraction will manage and whether the action summary matches the intended call.

The same source can be called again:

```hcl
module "uploads_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-dev-uploads"
  environment = "dev"
}
```

There is still one definition under `modules/private-bucket`, but now there are two instances: `module.logs_bucket` and `module.uploads_bucket`. Each receives its own inputs and creates its own resource instances.

Callers consume an output as `module.<name>.<output>`. A root resource can use the logs bucket ARN without constructing it from copied knowledge:

```hcl
resource "some_resource" "example" {
  destination = module.logs_bucket.bucket_arn
}
```

That reference is both value flow and dependency flow. Terraform knows the bucket produces the ARN before the consuming resource can use it. The module boundary keeps the graph readable without blocking its edges.

Module calls also support `for_each` and `count`. Several buckets can be created from one source:

```hcl
module "bucket" {
  for_each = {
    logs    = "myapp-dev-logs"
    uploads = "myapp-dev-uploads"
    backups = "myapp-dev-backups"
  }

  source = "../../modules/private-bucket"

  bucket_name = each.value
  environment = "dev"
}
```

The keys become part of instance identity: `module.bucket["logs"]`, `module.bucket["uploads"]`, and `module.bucket["backups"]`.

For each key, Terraform expands two child resource instances. For example, the logs call contains `module.bucket["logs"].aws_s3_bucket.this`, while the uploads call contains `module.bucket["uploads"].aws_s3_bucket.this`. Removing or changing a key can therefore change state identity just as it does for a resource-level `for_each`.

## How Do Modules Change the Terraform Graph and Addresses?
<!-- section-summary: Child resources join the root graph under module-scoped addresses, so dependencies cross interfaces and module labels become state identity. -->

Terraform does not represent `module "logs_bucket"` as one opaque infrastructure object. It expands the child configuration into the overall graph:

```text
module.logs_bucket
├── aws_s3_bucket.this
└── aws_s3_bucket_public_access_block.this
```

The full addresses are:

```text
module.logs_bucket.aws_s3_bucket.this
module.logs_bucket.aws_s3_bucket_public_access_block.this
```

The module path is followed by the resource type and local resource name. A second call can contain the same internal `aws_s3_bucket.this` because its module path differs. Modules therefore introduce a hierarchical namespace without creating a separate graph.

![Root Child State Boundary](/content-assets/articles/article-iac-terraform-modules-basics/root-child-state-boundary.png)

An output gives another node a supported path across the interface:

```text
module.logs_bucket.aws_s3_bucket.this
                 │
                 ▼
module.logs_bucket.bucket_arn
                 │
                 ▼
some_resource.example
```

This dependency remains implicit because the consumer references the producer's output. The caller does not need to know the child resource's local name to participate in the graph.

Addresses also explain why extracting existing resources requires care. Moving text from `main.tf` to another filename does not change an address, so state identity remains stable. Moving `aws_s3_bucket.logs` into a child changes the desired address to `module.logs_bucket.aws_s3_bucket.this`. Terraform cannot infer that these two addresses should keep one bucket binding.

Record that refactor explicitly:

```hcl
moved {
  from = aws_s3_bucket.logs
  to   = module.logs_bucket.aws_s3_bucket.this
}

moved {
  from = aws_s3_bucket_public_access_block.logs
  to   = module.logs_bucket.aws_s3_bucket_public_access_block.this
}
```

A safe plan then moves state identity while keeping the real AWS objects. Without the move declarations, the old addresses appear removed and the new addresses appear new, which can produce destroy-and-create actions.

Renaming the module call has the same consequence. `module.logs_bucket.aws_s3_bucket.this` and `module.application_logs.aws_s3_bucket.this` are different addresses. A whole-module `moved` block can preserve the subtree:

```hcl
moved {
  from = module.logs_bucket
  to   = module.application_logs
}
```

Module labels and `for_each` keys are therefore durable identity choices, not presentation-only names.

Keep three worlds visible during a refactor:

```text
configuration → module.logs_bucket and its child resource blocks
state         → full module-scoped addresses bound to AWS identities
reality       → the actual S3 bucket and its access configuration
```

Changing the module structure starts in configuration. A `moved` block tells Terraform how the matching state identities should follow. The AWS objects should remain still. This is why “moving code into a folder” and “moving a managed address” are different operations.

The namespace also helps interpret failures. If a plan reports `module.logs_bucket.aws_s3_bucket_public_access_block.this`, the path identifies the module instance, resource type, and internal name. The source implementation can be shared, but the failing instance and its inputs remain clear.

## How Do Root Modules, Providers, and State Fit Together?
<!-- section-summary: The root owns execution, provider configuration, backend, and state, while child modules add namespaced resources to that same operational context. -->

If Terraform runs from `environments/dev`, that directory is the root module. It may contain resources and call one or more child modules. A child can call another child, producing nested paths such as `module.application.module.storage.aws_s3_bucket.this`, though a relatively flat tree is often easier to understand.

Default provider configurations also flow from the root into child modules. The development root can configure AWS once:

```hcl
provider "aws" {
  region = "eu-west-2"
}

module "logs_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-dev-logs"
  environment = "dev"
}
```

The child uses AWS resources without declaring a second configured provider. A reusable child should still state which provider source and versions it requires:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}
```

The distinction is important. `required_providers` declares a software dependency. A root `provider "aws"` block supplies an actual configured instance, including region and runtime credentials. Reusable modules declare requirements; roots own operational provider context.

A child module also does not automatically gain a separate state, backend, apply, credential, account, lifecycle, or failure domain. If one root calls network, database, and application modules, their resource addresses can all live in the root's single state and participate in the same plan.

Conceptually, the operational shape is one enclosing Terraform run:

```text
one root configuration
├── root resources
├── module.network resources
├── module.database resources
└── module.application resources

one backend and state context
one dependency graph
one plan and apply workflow
```

Modules can help humans reason about that graph, but they do not create an independent Terraform process around each subtree.

To give networking an independently authorized and deployed state, create a separate root configuration and backend boundary. Placing resources under `modules/network/` only creates a configuration and interface boundary. It does not create operational isolation.

This produces three distinct concepts:

```text
module boundary → how configuration is organized and exposed
state boundary → which resources Terraform manages together
infrastructure boundary → which account, network, cluster, or system owns objects
```

They can align, but Terraform does not make them equivalent.

## What Makes a Useful Module Boundary?
<!-- section-summary: A useful module represents a coherent idea, keeps policy and mechanism inside, and exposes caller intent through a small interface. -->

The first benefit is reuse: change one private-bucket implementation instead of repairing several copies. The deeper benefit is policy. The module can guarantee that public access is blocked and that the expected tags exist. Callers request a private logs bucket rather than assembling low-level AWS objects correctly every time.

Good module interfaces expose intent and hide mechanism. `bucket_name` and `environment` are choices the caller understands. The module decides which resources implement the private-bucket rule. `bucket_arn` is a useful capability to publish; the entire internal resource object is not automatically a good interface.

The distinction is visible in root code. Several low-level bucket resources tell the reader how AWS objects are assembled. A module call named `logs_bucket` tells the reader what the application needs. The internal module then carries the reviewed definition of that idea.

Internal implementation can then evolve. A module might add resources or expressions while retaining compatible inputs and outputs. Callers can receive the improved policy through their normal plans without rewriting how they consume the bucket ARN.

Not every resource deserves a wrapper. A module containing one resource, one pass-through variable for every provider argument, and one output for every attribute may add only indirection:

```text
caller → module variable → resource argument
resource attribute → module output → caller
```

Ask whether the group has a coherent abstraction, shared policy, genuine reuse, or meaningful simplification. Names such as `private-bucket`, `vpc`, `application-service`, `postgres-database`, and `monitoring-stack` describe caller-facing ideas. “Misc resources” and a wrapper for every individual resource do not.

One job per module also does not mean one resource. A private bucket needs both the bucket and the public-access policy to satisfy one promise. The useful boundary follows a reason to change and an idea the caller can understand.

Conversely, a module that owns an entire unrelated production environment is difficult to compose or test, while tiny resource wrappers fragment simple changes. The better question is not “can this become a module?” but “does this infrastructure have one coherent responsibility, interface, and reuse or policy benefit?”

Modules encode configuration boundaries, so dependency and policy design still matter. An output should expose a stable result rather than force callers to know internal names. An input should express a decision rather than leak every mechanism. Provider settings, backend selection, credentials, and environment isolation remain with the root.

## How Does the Complete Module Model Fit Together?
<!-- section-summary: A module is a reusable, parameterized graph subtree whose interface, namespace, provider context, and state identity remain part of the caller's Terraform run. -->

A complete structure can combine one shared source with separate environment roots:

```text
terraform/
├── modules/
│   └── private-bucket/
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── versions.tf
└── environments/
    ├── dev/
    │   ├── main.tf
    │   └── providers.tf
    └── prod/
        ├── main.tf
        └── providers.tf
```

The development and production roots call the same source with different inputs:

```hcl
module "logs_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-dev-logs"
  environment = "dev"
}
```

```hcl
module "logs_bucket" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
  environment = "prod"
}
```

Each root supplies provider context and owns a separate state. Inside either root, the module expands into a bucket and public-access resource under a namespaced address. Inputs flow into that subtree, outputs flow out, and references connect it to the larger graph.

![Module Basics Field Guide](/content-assets/articles/article-iac-terraform-modules-basics/module-basics-field-guide.png)

Keep configuration, state, and reality separate. Source code declares a module call and its child resources. State binds full module-scoped addresses to provider objects. AWS contains the actual bucket. Extracting a module primarily restructures configuration and therefore may change state addresses; it does not create an independent cloud universe.

The most useful definition is: a module is a parameterized subtree of Terraform's configuration graph with its own namespace and an explicit input/output interface. That model explains reuse, module instances, outputs, provider inheritance, `for_each` keys, refactoring moves, and the difference between module and state boundaries.

Trace one value through the complete system. The development root passes `bucket_name = "myapp-dev-logs"` to `module.logs_bucket`. Inside the child, `var.bucket_name` becomes the `bucket` argument of `aws_s3_bucket.this`. The provider creates or refreshes the bucket, and state binds the real AWS identity to `module.logs_bucket.aws_s3_bucket.this`. The child output reads the resulting ARN, and a root consumer references `module.logs_bucket.bucket_arn`. Every step is ordinary Terraform value, dependency, provider, and state behavior with a module namespace added.

The production root can follow the same flow with `myapp-prod-logs`, yet it is a separate deployment because the root and its state are separate. Sharing source does not share infrastructure identity. Conversely, two calls in one root share the root's operational state even though their module paths differ. This distinction prevents a common mistake: assuming reuse decides lifecycle isolation.

Review changes at both levels. At the call site, check the source, instance label, inputs, `for_each` keys, and provider context. In the expanded plan, check the module-scoped resources and action summary. When extracting existing code, map every old address to its new module address and require the plan to show moves rather than replacements. When adding a fresh call, require only the expected creates.

The interface is also a change-management boundary. Adding an internal access-control resource may preserve every caller input and output while improving the shared implementation. Renaming a required variable or removing an output changes the caller contract. Renaming an internal resource may require a `moved` block even if the public contract stays stable. API compatibility and state-address compatibility are related but distinct responsibilities for the module author.

Provider requirements add another compatibility layer. The child declares which provider it can work with, while the root chooses a compatible version and supplies configuration. The child should not hard-code the root's region or credentials because those values belong to the deployment context. Keeping requirement and configuration separate lets the same source serve development and production without confusing reuse with authority.

Finally, do not measure module quality by the percentage of code placed under `modules/`. Measure whether the boundary makes infrastructure intent clearer, centralizes a real rule, creates a stable contract, and can evolve without spreading provider mechanics across callers. A module is successful when it simplifies the caller's reasoning while remaining honest about the resources, addresses, and lifecycle that Terraform will manage.

That honesty also applies to nested modules. A child may call another child, and the namespace grows with every level. Nesting is valid when one abstraction genuinely contains another, but deep trees make addresses, provider routing, and upgrade effects harder to trace. Prefer a flatter root composition when independent building blocks can be wired directly. The goal is not the shortest root file; it is a graph whose ownership and dependencies remain explainable.

When deciding whether to introduce the first module, compare the expected callers and changes. If several environments need the same private-bucket policy, the abstraction has a clear audience and reason to evolve. If only one simple resource exists and no policy is hidden, direct configuration may remain clearer. Reuse is a benefit when it represents shared intent, not an obligation to add another directory.

A first module extraction should preserve resource identity deliberately. Moving existing resources behind a module changes their configuration addresses even when the remote objects remain the same. Use the source-supported refactoring mechanism and inspect a plan that shows address movement rather than destroy and create. Then run the module from more than one caller to prove the boundary actually removes duplication rather than relocating one root configuration into a folder with hidden environment assumptions.

Calling a module changes the root graph, so the normal lifecycle still applies. `terraform init` obtains referenced module packages, `terraform plan` expands the module calls and exposes their resource addresses, and `terraform apply` executes the approved graph. Reuse does not bypass review; it moves repeated implementation behind a versioned interface that the caller must still understand.

## Check Your Answers

:::expand[Why Does Repeated Terraform Code Become a Problem?]{kind="recap"}
Copies turn one shared infrastructure rule into several implementations that can drift. A module keeps invariant resources together and makes environmental choices explicit inputs.
:::

:::expand[What Is a Terraform Module?]{kind="recap"}
A module is a directory of Terraform configuration loaded as a named, parameterized subtree. Variables, implementation, and outputs form its basic contract.
:::

:::expand[How Do You Extract a Private Bucket Module?]{kind="recap"}
Move varying values into variables, keep the bucket and public-access rule inside, and publish only useful results such as the bucket ID and ARN.
:::

:::expand[How Do You Call and Reuse a Module?]{kind="recap"}
A module block names one instance, identifies its source, and passes inputs. Multiple calls or `for_each` create distinct module instances with distinct addresses.
:::

:::expand[How Do Modules Change the Terraform Graph and Addresses?]{kind="recap"}
Child resources join the root graph under a module path. Outputs carry dependencies across the interface, and address-changing refactors require `moved` blocks to preserve bindings.
:::

:::expand[How Do Root Modules, Providers, and State Fit Together?]{kind="recap"}
The root owns execution, configured providers, backend, and state. Child modules declare provider requirements and contribute resources to that same operational context.
:::

:::expand[What Makes a Useful Module Boundary?]{kind="recap"}
A good module represents a coherent caller-facing idea, encodes shared policy, hides implementation, and exposes a small intent-based interface instead of wrapping every resource.
:::

:::expand[How Does the Complete Module Model Fit Together?]{kind="recap"}
Inputs enter a reusable namespaced graph subtree, resources implement the idea, outputs connect consumers, full addresses enter state, and separate roots provide real environment isolation.
:::

### References

- [Creating modules](https://developer.hashicorp.com/terraform/language/modules/develop)
- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
- [Manage values in modules](https://developer.hashicorp.com/terraform/language/values)
- [Resource address reference](https://developer.hashicorp.com/terraform/cli/state/resource-addressing)
- [Use modules in configuration](https://developer.hashicorp.com/terraform/language/modules/configuration)
- [Modules overview](https://developer.hashicorp.com/terraform/language/modules)
- [Providers within modules](https://developer.hashicorp.com/terraform/language/modules/develop/providers)
- [Refactor modules](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [`module` block reference](https://developer.hashicorp.com/terraform/language/block/module)

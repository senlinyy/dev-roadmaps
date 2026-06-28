---
title: "Resource Dependencies"
description: "Understand how Terraform discovers resource order from references, where depends_on is useful, and how dependency choices appear in plan output."
overview: "Terraform follows references between resources and outputs to decide what runs first. This article uses a small application stack to show implicit dependencies, explicit dependencies, cycles, and plan output."
tags: ["terraform", "dependencies", "graph", "depends_on"]
order: 7
id: article-iac-terraform-config-dependencies
aliases:
  - infrastructure-as-code/terraform/configuration/dependencies.md
---

## Table of Contents

1. [The Ordering Question](#the-ordering-question)
2. [Implicit Dependencies from References](#implicit-dependencies-from-references)
3. [How the Plan Shows Dependency Results](#how-the-plan-shows-dependency-results)
4. [Hidden Ordering and depends_on](#hidden-ordering-and-dependson)
5. [Cycles and How to Break Them](#cycles-and-how-to-break-them)
6. [Larger Boundaries Come Later](#larger-boundaries-come-later)
7. [Putting It All Together](#putting-it-all-together)

## The Ordering Question
<!-- section-summary: Terraform decides ordering from relationships in the configuration rather than file or block order. -->

The `devpolaris-orders-api` stack has a bucket, an IAM policy, a role, and a compute service. The policy needs the bucket ARN. The compute service needs the role. The deployment might also need a log group to exist before the app starts writing logs.

A beginner might look for file order. Maybe `bucket.tf` should run before `iam.tf`, and `iam.tf` should run before `service.tf`. Terraform reads the whole configuration and builds a dependency graph from references.

A **dependency** tells Terraform that one object needs another object's value or side effect before planning or applying safely. Terraform finds most dependencies through references. A reference like `aws_s3_bucket.orders_exports.arn` gives Terraform a visible relationship.

That is the first rule for dependency design. Real values should move through references instead of copied strings. The reference gives Terraform ordering information and gives reviewers a visible path.

Under the hood, Terraform turns these relationships into a graph. Graph nodes include resources, provider configurations, and outputs. Later articles add data sources and modules to that same picture. Graph edges come from references and selected meta-arguments. Terraform walks that graph during plan and apply so independent work can run in parallel while dependent work waits for the values or side effects it needs.

The graph is one reason Terraform projects can be split across files without losing ordering. `iam.tf` can reference a bucket from `storage.tf`, and Terraform still knows the policy needs the bucket ARN. The file name helps humans; the reference builds the graph.

## Implicit Dependencies from References
<!-- section-summary: A reference from one block to another creates the usual Terraform dependency without extra syntax. -->

Here is the first object in the small example, an exports bucket:

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-prod-exports"
}
```

The next block configures versioning for that same bucket. The important line is the `bucket` argument:

![Dependency Edge Map](/content-assets/articles/article-iac-terraform-config-dependencies/dependency-edge-map.png)

*The edge map shows how references create ordering paths without extra syntax.*

```hcl
resource "aws_s3_bucket_versioning" "orders_exports" {
  bucket = aws_s3_bucket.orders_exports.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

The versioning resource references the bucket ID. Terraform can plan the bucket first because it needs the bucket value before it can configure versioning. This is called an **implicit dependency** because the dependency comes from the value reference.

The same rule applies across resources, locals, and outputs. If an output reads `aws_s3_bucket.orders_exports.bucket`, Terraform knows the output depends on the bucket.

Implicit dependencies should be your default. They keep the code honest because the resource that needs a value shows exactly where the value comes from.

Locals can carry dependencies too. If `local.bucket_policy_json` includes `aws_s3_bucket.orders_exports.arn`, then any resource that consumes `local.bucket_policy_json` indirectly depends on the bucket. That is useful, but keep the local name clear so reviewers can still find the real source of the value.

## How the Plan Shows Dependency Results
<!-- section-summary: The plan shows unknown values and ordering clues created by dependencies. -->

Terraform plans show dependency effects in several ways. A resource that depends on a value created during apply may show `(known after apply)`. That tells you Terraform understands the value will arrive later.

![Dependency Graph](/content-assets/articles/article-iac-terraform-config-dependencies/dependency-graph.png)

*The graph view turns references, unknown values, and blocked work into one visible dependency picture.*

```console
  + arn = (known after apply)
```

That line usually means the provider will return the ARN after the object exists. If another block references that ARN, Terraform can still order the work while the exact string remains unavailable during plan.

For example, the versioning resource references the bucket ID:

```hcl
resource "aws_s3_bucket_versioning" "orders_exports" {
  bucket = aws_s3_bucket.orders_exports.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

Terraform can see that versioning needs the bucket first. The plan may list resources in a readable order, and the references remain the real contract. The useful review target is the value path rather than the display order alone.

Daily review starts with the plan output:

```bash
terraform validate
terraform plan
```

`terraform validate` checks whether the configuration is structurally valid. `terraform plan` goes further by reading state, refreshing provider objects where possible, and showing the proposed infrastructure change. Both commands matter because a file can be valid syntax while still planning an unsafe replacement.

Successful validation is short:

```console
Success! The configuration is valid.
```

The first plan for the bucket and versioning example should show creates for both resources:

```console
Terraform will perform the following actions:

  # aws_s3_bucket.orders_exports will be created
  + resource "aws_s3_bucket" "orders_exports" {
      + arn    = (known after apply)
      + bucket = "devpolaris-orders-api-prod-exports"
      + id     = (known after apply)
    }

  # aws_s3_bucket_versioning.orders_exports will be created
  + resource "aws_s3_bucket_versioning" "orders_exports" {
      + bucket = (known after apply)
      + id     = (known after apply)
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

Reviewers should check whether unknown values make sense, whether replacements are expected, and whether resources are connected through references instead of copied IDs.

For deeper debugging, `terraform graph` can produce a graph description:

```bash
terraform graph
```

The raw output is DOT-format graph text. Resource addresses are graph nodes, and arrows show dependency direction. The beginning often looks like `digraph {`, followed by many quoted node names and arrows. Teams usually pipe it into Graphviz for genuinely confusing ordering problems; most dependency fixes still belong in the HCL references.

For the small bucket example, the raw graph may include edges shaped like this:

```console
digraph {
  "[root] aws_s3_bucket.orders_exports (expand)" -> "[root] provider[\"registry.terraform.io/hashicorp/aws\"]"
  "[root] aws_s3_bucket_versioning.orders_exports (expand)" -> "[root] aws_s3_bucket.orders_exports (expand)"
}
```

That second arrow is the important clue. The versioning resource points back to the bucket because its `bucket` argument references `aws_s3_bucket.orders_exports.id`.

The raw graph is usually more detail than beginners need during normal review. It belongs in the rare debugging case where the dependency problem is genuinely confusing. The code fix still usually returns to references and resource names.

Unknown values are normal if they come from provider-created attributes. They deserve attention if they hide a risky setting. For example, an IAM policy document should usually be reviewable during plan. If a policy document is mostly unknown until apply, the team should understand why before approving.

If a plan tries to create something before a hidden requirement is ready, the next section explains the tool for that rare case.

## Hidden Ordering and depends_on
<!-- section-summary: depends_on is for hidden operational ordering that Terraform cannot infer from a value reference. -->

Some ordering requirements are hidden from normal argument values. For example, an EC2 instance bootstrap script might call AWS APIs during startup and expect an IAM policy attachment to be fully in place. The instance resource might reference an instance profile while the specific policy attachment remains outside its arguments.

![Implicit Explicit Dependencies](/content-assets/articles/article-iac-terraform-config-dependencies/implicit-explicit-dependencies.png)

*The comparison separates normal value references from `depends_on` entries that carry hidden side effects.*

That hidden timing requirement can justify `depends_on`:

```hcl
resource "aws_iam_role_policy_attachment" "read_config" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.read_config.arn
}

resource "aws_instance" "app" {
  ami                  = var.app_ami_id
  instance_type        = "t3.micro"
  iam_instance_profile = aws_iam_instance_profile.app.name
  subnet_id            = var.private_subnet_id

  depends_on = [
    aws_iam_role_policy_attachment.read_config
  ]
}
```

The official [`depends_on` reference](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on) describes it as the tool for dependencies Terraform cannot infer automatically. It fits only cases with a real hidden behavior dependency.

Overusing `depends_on` makes plans more conservative and code difficult to understand. It can also make Terraform wait on whole modules or resources for a single value relationship. Normal references should come first; `depends_on` belongs to side-effect dependencies rather than value dependencies.

Good `depends_on` lists are small and specific. The instance above waits for one policy attachment because the boot script needs the permission. A broad dependency on an entire IAM module would hide the real reason and could make unrelated IAM changes block the instance.

A `depends_on` choice needs surrounding names that make the reason obvious. `aws_iam_role_policy_attachment.read_config` says much more than `aws_iam_role_policy_attachment.policy`. Terraform has no separate field for explaining a dependency, so clear resource names carry a lot of review value.

## Cycles and How to Break Them
<!-- section-summary: A dependency cycle means two objects need each other first, so the configuration must be redesigned. -->

A **cycle** happens after Terraform finds a loop in the graph. Resource A needs Resource B, and Resource B needs Resource A. Terraform cannot pick a safe starting point, so it fails the plan.

Beginners often hit cycles with security groups or IAM policies that exchange too many values. For example, one security group might include a rule referencing another security group, while the other group includes a rule referencing the first in the same tightly coupled shape.

The fix is usually to separate the pieces. Create the security groups first, then create separate security group rule resources that reference both groups. For IAM, create the role first, then attach policies that reference the role.

Terraform reports the loop before apply. A small cycle error can look like this:

```console
Error: Cycle: aws_security_group.app, aws_security_group.db
```

That message means Terraform cannot choose a starting point. A useful repair removes one of the two-way value requirements and turns the design into a one-way path Terraform can walk.

A practical cycle repair starts by drawing the two values that point at each other. For security groups, separate the group shells from the rules. For IAM, create the role first, then attach policies that reference the role. The module articles later apply the same one-way value habit across larger reusable boundaries.

After the repair, a plan should show that Terraform has a starting point. A good fix reduces coupling; a large `depends_on` block would make the graph difficult to understand later.

## Larger Boundaries Come Later
<!-- section-summary: The same dependency rules apply to modules later, but beginners should first learn resource references clearly. -->

The dependency rules in this article start with resources because resource references are the easiest place to see the graph. One block reads another block's attribute, Terraform draws an ordering path, and the plan follows that path.

Modules use the same idea later. A reusable module can publish outputs, and a caller can pass those outputs into another module. That larger boundary is more direct after resource references, `depends_on`, and cycle repair are clear. The module articles return to this topic with complete caller and child-module examples.

Provider configuration adds one more boundary later. A reusable module can receive provider settings from its caller, so review provider wiring and dependencies together for a module that deploys to multiple regions or accounts.

## Putting It All Together
<!-- section-summary: Terraform dependency design works best with references for values and depends_on for rare hidden ordering. -->

Terraform builds a dependency graph from your configuration. Most ordering should come from references like `aws_s3_bucket.orders_exports.id` or `aws_s3_bucket.orders_exports.arn`. Those references carry real values and explain the relationship to humans.

![Dependencies Summary](/content-assets/articles/article-iac-terraform-config-dependencies/dependencies-summary.png)

*The summary board keeps dependency review grounded in references, hidden ordering, cycles, and small fixes.*

`depends_on` fits hidden side effects that Terraform cannot infer from values. Clear resource names and a small dependency list should document that choice. Broad dependency blocks hide the actual reason for the order.

A cycle repair starts with the value flow. Terraform needs a graph it can walk, and your reviewers need relationships they can understand before apply.

---

**References**

- [Terraform resource dependencies](https://developer.hashicorp.com/terraform/tutorials/configuration-language/dependencies) - HashiCorp explains implicit dependencies, explicit dependencies, and dependency order in Terraform configurations.
- [depends_on meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on) - HashiCorp documents explicit dependencies for hidden behavior that Terraform cannot infer from references.
- [References to values](https://developer.hashicorp.com/terraform/language/expressions/references) - HashiCorp documents how references connect resources, locals, variables, and outputs.
- [terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate) - HashiCorp documents local configuration validation before planning.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - HashiCorp documents plan output, saved plans, refresh behavior, and planning modes.
- [terraform graph](https://developer.hashicorp.com/terraform/cli/commands/graph) - HashiCorp documents DOT graph output for dependency inspection.
- [AWS provider aws_s3_bucket_versioning](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning) - Terraform Registry documents the S3 versioning resource used in the dependency example.

---
title: "Data Sources: Querying Infrastructure"
description: "Safe read-only provider queries for referencing and consuming pre-existing infrastructure."
overview: "A data source is a read-only lookup that lets Terraform use existing infrastructure without taking ownership of it. This article contrasts resources that Terraform manages with data sources that Terraform reads, then shows filters, plan output, state behavior, and safer use around secret data."
tags: ["terraform", "data-sources", "querying", "state"]
order: 4
id: article-iac-terraform-config-data-sources
aliases:
  - infrastructure-as-code/terraform/configuration/data-sources.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/data-sources.md
---

## Table of Contents

1. [The Existing Network Problem](#the-existing-network-problem)
2. [Resources Manage, Data Sources Read](#resources-manage-data-sources-read)
3. [Writing the Lookup](#writing-the-lookup)
4. [Resources Consuming Lookup Results](#resources-consuming-lookup-results)
5. [Plan Timing and Lookup Failures](#plan-timing-and-lookup-failures)
6. [Secrets, State, and Safe Use](#secrets-state-and-safe-use)
7. [Putting It All Together](#putting-it-all-together)

## The Existing Network Problem
<!-- section-summary: Application stacks often need existing platform resources without taking ownership of those resources. -->

After resources and state, Terraform has one big idea in place: a resource block means Terraform should manage the lifecycle of something and remember that object in state. That is the right tool for objects the current stack owns from create through delete.

The DevPolaris platform team already owns the production VPC. They manage subnets, route tables, NAT gateways, and shared security groups in a separate Terraform stack. The `devpolaris-orders-api` team only needs to deploy its service into that network.

The orders stack needs three existing values: the VPC ID, the private subnet IDs, and the security group that allows application traffic to the database. Hardcoding those IDs would work for one day, then fail after the platform team rebuilds or renames something. Declaring the VPC as a resource in the app stack would give the app stack ownership it should not have.

This is where a **data source** helps. The app stack can ask AWS for existing objects by tags or filters, then use the returned IDs in resources it does own.

That keeps ownership clean. The platform stack manages the network lifecycle. The application stack reads network facts and manages only the application resources that sit inside that network.

This pattern is common in mature infrastructure teams. A platform stack owns shared networking, security baselines, DNS zones, or cluster foundations. Product stacks read the pieces they are allowed to use and manage service-specific resources. Data sources are the HCL bridge between those responsibilities.

The key review question is ownership. If the app team should create and delete the object, use a resource. If the app team should only read an object owned elsewhere, use a data source. Mixing those responsibilities creates confusing plans and can lead to two stacks fighting over the same platform setting.

## Resources Manage, Data Sources Read
<!-- section-summary: A data source performs a read-only provider query and exposes returned attributes for the rest of the configuration. -->

A **data source** is a read-only lookup. Terraform asks a provider for information about something that already exists, and the configuration consumes the returned attributes. The official [Terraform data source documentation](https://developer.hashicorp.com/terraform/language/data-sources) describes this as querying infrastructure data.

A data source fits objects owned by another team, another stack, or the provider. Common examples include reading a VPC by tags, selecting the latest machine image, reading a DNS zone, finding a GitHub team, or looking up an existing secret metadata record.

A data source gives Terraform read access rather than lifecycle ownership. Terraform can read the existing object, while creation, updates, and deletion stay with the stack or platform that owns it. That boundary is why data sources are useful in platform/application splits.

For beginners, the naming pattern helps. Resource addresses start with a resource type, such as `aws_s3_bucket.orders_exports`. Data source addresses start with `data`, such as `data.aws_vpc.platform_prod`.

The difference shows up in plan review:

| Block kind | Terraform's job | Typical state meaning | Example address |
|---|---|---|---|
| `resource` | Create, update, and delete the object | Terraform tracks the object it manages | `aws_s3_bucket.orders_exports` |
| `data` | Read an existing object and expose attributes | Terraform records the read result used by the run | `data.aws_vpc.platform_prod` |

A resource says, "this stack owns the lifecycle." A data source says, "this stack needs facts about something that already exists." Both can appear in state, but only the resource gives this stack ownership of changes to the remote object.

Data sources still use provider credentials. A plan role must have permission to describe the object being read. If a data source reads production network IDs, the plan identity needs production read permissions. If it reads secret material, the plan identity can access that secret, and state may store the returned value.

Some teams prefer explicit outputs from the owning stack over broad discovery filters. For example, the platform stack can publish subnet IDs through remote state or a parameter store, and the app stack can read those published values. Data sources are still useful, but the source of truth should be clear.

## Writing the Lookup
<!-- section-summary: A data block names the provider lookup type, a local name, and filters that should find one existing object or collection. -->

The lookup starts with a `data` block. The first label names the provider lookup type. The second label is the local name the rest of this configuration will use.

```hcl
data "aws_vpc" "platform_prod" {
  # provider-specific lookup arguments go here
}
```

For the platform VPC, tags make the lookup contract readable. The app team is not guessing a VPC ID; it is asking for the production VPC owned by the networking team.

![Data Source Lookup Path](/content-assets/articles/article-iac-terraform-config-data-sources/data-source-lookup-path.png)

*The lookup path shows data sources reading provider-owned objects and returning values Terraform can use in resources.*

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}
```

Terraform reads this as `data.aws_vpc.platform_prod`. The useful value for later blocks is usually `data.aws_vpc.platform_prod.id`, which is the VPC ID returned by AWS.

The next lookup uses that returned VPC ID and adds subnet filters. The `vpc-id` filter keeps the search inside the selected VPC. The tag filters narrow the result to the private subnets assigned to the orders service.

```hcl
data "aws_subnets" "orders_private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.platform_prod.id]
  }

  filter {
    name   = "tag:Tier"
    values = ["Private"]
  }

  filter {
    name   = "tag:Service"
    values = ["orders-api"]
  }
}
```

The subnet lookup references the VPC data source. Terraform can see that it should read the VPC result before it has enough information to read the subnets. This gives you a normal dependency path even though both blocks are read-only.

Filters should be specific enough to find the intended object. A loose filter can match the wrong VPC or too many subnets. Good platform tags make data sources precise and reviewable.

The lookup should fail loudly if the source of truth is wrong. If the production VPC tag is missing, a failed plan is useful. It tells the team to fix the platform tags or the lookup contract before the app stack deploys into the wrong network.

For collection data sources, sort or shape values before downstream resources depend on stable list order. Provider APIs may return lists in an order a human did not expect. If a resource uses subnet IDs for repeated instances, a stable mapping or documented sort step keeps a harmless API ordering change from creating a noisy plan.

The root module can normalize the subnet IDs before passing them further:

```hcl
locals {
  private_subnet_ids = sort(data.aws_subnets.orders_private.ids)
}
```

That local value has no provider behavior by itself. It gives the rest of the configuration one stable name for the ordered subnet list, so resources and module calls do not repeat the same sorting expression.

## Resources Consuming Lookup Results
<!-- section-summary: Resources can consume data source attributes the same way they consume resource attributes. -->

Now an application-facing resource can use the existing VPC and subnet values. The first owned resource is the application security group. It belongs to the app stack, but it must attach to the existing platform VPC.

```hcl
resource "aws_security_group" "orders_app" {
  name        = "devpolaris-orders-api-prod"
  description = "Application security group for orders API"
  vpc_id      = data.aws_vpc.platform_prod.id

  tags = {
    service     = "orders-api"
    environment = "prod"
    managed_by  = "terraform"
  }
}
```

The load balancer then consumes two things: the app security group created by this stack and the sorted private subnet IDs returned by the lookup path.

```hcl
resource "aws_lb" "orders_api" {
  name            = "devpolaris-orders-api-prod"
  internal        = true
  security_groups = [aws_security_group.orders_app.id]
  subnets         = local.private_subnet_ids

  tags = {
    service     = "orders-api"
    environment = "prod"
    managed_by  = "terraform"
  }
}
```

The VPC remains owned by the platform stack. The security group and load balancer belong to the app stack. The data source value is just the bridge between those ownership boundaries.

Outputs can publish values from data sources too, but only publish what a human or another tool actually needs. Too many outputs make modules noisy and can expose information that should stay internal.

In larger repositories, the root configuration usually stays responsible for this lookup because the root knows the target account, region, tags, and environment boundary. Reusable pieces can receive ordinary values such as `vpc_id` and `private_subnet_ids`, which keeps discovery rules close to the environment that owns them.

## Plan Timing and Lookup Failures
<!-- section-summary: Terraform usually reads data sources during planning, and failed or ambiguous lookups stop the plan before apply. -->

Terraform usually reads data sources during the planning phase. That is useful because a missing VPC, wrong tag, or ambiguous lookup fails before Terraform changes infrastructure. A failed lookup is annoying, but it is still preferable to applying into the wrong network.

![Unknown Value Timing](/content-assets/articles/article-iac-terraform-config-data-sources/unknown-value-timing.png)

*The unknown-value path shows why Terraform can delay a lookup whose inputs are available only after another change.*

![Data Source Timing Paths](/content-assets/articles/article-iac-terraform-config-data-sources/data-source-timing-paths.png)

*The timing view separates plan-time reads from apply-time reads, which is where many confusing lookup results come from.*

Some data sources are read during apply because their input values are unknown during plan. For example, Terraform may delay a read that depends on a value created by another resource in the same run. The plan output tells you that the read will happen during apply.

Stable platform objects deserve filters based on durable tags, names, or IDs. Human display names that change often make weak lookup keys. If a lookup must find exactly one object, the filters should be precise enough that a second matching object would be a real configuration error.

A failed data lookup points to the lookup or the source of truth. A copied ID may make the plan pass for the moment, and it also removes the safety that the data source was giving you. The durable repair is a precise filter or a corrected source object.

A plan can also show a data source read scheduled for apply. That usually means one of the data source arguments depends on a value Terraform will know only after creating or changing another object. Those cases deserve careful review because the lookup result will not be fully visible during plan review.

If a data source is meant to read stable shared infrastructure, its filters should usually be known during plan. A delayed read can be reasonable for generated resources, but it weakens pre-apply review for shared platform lookups.

The normal Terraform review commands make data source behavior visible:

```bash
terraform validate
terraform plan
```

```console
Success! The configuration is valid.
```

If the lookup succeeds, the plan should show the reads first and then show resources that consume the returned IDs:

```console
data.aws_vpc.platform_prod: Reading...
data.aws_vpc.platform_prod: Read complete after 1s [id=vpc-0f123456789abcde0]
data.aws_subnets.orders_private: Reading...
data.aws_subnets.orders_private: Read complete after 0s [id=eu-west-2]

Terraform will perform the following actions:

  # aws_security_group.orders_app will be created
  + resource "aws_security_group" "orders_app" {
      + vpc_id = "vpc-0f123456789abcde0"
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

If the lookup fails, Terraform stops before it proposes managed-resource changes:

```console
data.aws_vpc.platform_prod: Reading...

Error: no matching EC2 VPC found

  with data.aws_vpc.platform_prod,
  on network.tf line 1, in data "aws_vpc" "platform_prod":
   1: data "aws_vpc" "platform_prod" {
```

That error usually points to one of three places: the filters do not match the platform tags, the plan identity cannot read the object, or the object exists in a different account or region than the provider configuration targets. A copied ID may make the next plan pass, and it also removes the safety that the data source was giving you. The durable repair is a precise filter, corrected provider target, or corrected source object.

## Secrets, State, and Safe Use
<!-- section-summary: Data sources can place returned values in state, so secret and sensitive provider reads need care. -->

Data sources can return sensitive values depending on the provider and data source. Those values may be stored in Terraform state. That means state access can expose secrets, even if the value is hidden in normal CLI output.

For secrets, the safer pattern wires references without reading secret material if the provider supports that design. For example, a resource might refer to a secret ARN or name rather than reading the secret value itself. If Terraform must read a secret, protect the backend, limit state access, and keep the value out of outputs.

Data sources also need provider permissions. A plan role that reads production network details needs permission to describe those resources. A plan role that reads secret values needs much stronger review because the plan job can access the secret.

Data sources deserve the same care as other infrastructure reads with security impact. They are convenient, but they still call real APIs and can return important information.

Secret data sources need a stricter rule. Reading the value of a secret brings the secret into Terraform's process and often into state. Reading the secret's name, ARN, ID, or version metadata is usually safer for a downstream resource that only needs a reference. The exact behavior depends on the provider data source, so read the provider page before using secret-returning lookups.

You can inspect non-secret data source state the same way you inspect managed resources:

```bash
terraform state show data.aws_vpc.platform_prod
```

The output contains the attributes Terraform recorded from the read:

```console
# data.aws_vpc.platform_prod:
data "aws_vpc" "platform_prod" {
    cidr_block = "10.20.0.0/16"
    id         = "vpc-0f123456789abcde0"
    tags       = {
        "Environment" = "prod"
        "Owner"       = "platform-networking"
    }
}
```

That is useful for debugging a normal VPC lookup. The same behavior can expose too much if the provider returns secret material, private endpoints, customer names, or other sensitive data. State protection is part of the data-source design, not an afterthought.

A plan job that can read sensitive data pulls plan logs, state backend, CI artifacts, and local developer machines into the security boundary. That is a high price for convenience, so reference-based designs are safer wherever the provider supports them.

## Putting It All Together
<!-- section-summary: Data sources let Terraform consume existing infrastructure while keeping lifecycle ownership in the right stack. -->

Data sources solve a common team problem. One stack owns a shared resource, and another stack needs to use facts about it. The data source reads the existing object, exposes attributes, and lets resources consume those values without taking ownership.

![Data Sources Summary](/content-assets/articles/article-iac-terraform-config-data-sources/data-sources-summary.png)

*The summary board keeps the ownership boundary clear: resources manage, data sources read, and state still needs protection.*

The orders API stack used data sources to read a platform VPC and private subnets. Its own resources consumed those IDs, while the platform network stayed managed by the platform stack. That is the clean ownership boundary beginners should learn early.

Precise filters, plan review, protected state, and careful secret handling make data sources much safer. A lookup is still a provider API call, and the values it returns can shape real infrastructure changes.

---

**References**

- [Terraform: Data sources](https://developer.hashicorp.com/terraform/language/data-sources) - Documents read-only data blocks, plan-time reads, and data source behavior.
- [Terraform: State](https://developer.hashicorp.com/terraform/language/state) - Explains why data source results and managed resources can appear in state.
- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - Explains state, plans, and sensitive values.
- [AWS provider: aws_vpc data source](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/vpc) - Documents VPC lookups by filter and tags.
- [AWS provider: aws_subnets data source](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/subnets) - Documents subnet collection lookups and returned IDs.
- [AWS provider: aws_secretsmanager_secret data source](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/secretsmanager_secret) - Documents reading Secrets Manager secret metadata without retrieving the secret value.

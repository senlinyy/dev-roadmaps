---
title: "Data Sources: Querying Infrastructure"
description: "Reference and consume pre-existing infrastructure safely using read-only provider queries."
overview: "Learn how Terraform data sources read existing infrastructure, use filters, handle plan and apply timing, and let one team connect to resources owned by another team without taking ownership."
tags: ["terraform", "data-sources", "querying", "state"]
order: 3
id: article-iac-terraform-config-data-sources
---

## Table of Contents

1. [The Reader's Problem: Connecting to Shared Infrastructure](#the-readers-problem-connecting-to-shared-infrastructure)
2. [Anatomy of a Data Source Block](#anatomy-of-a-data-source-block)
3. [Systems Engineering Mechanics: Read-Only API Interactions](#systems-engineering-mechanics-read-only-api-interactions)
4. [Dynamic Filtering and Search Constraints](#dynamic-filtering-and-search-constraints)
5. [The Lifecycle Gap: Handling Unknown and Computed Attributes](#the-lifecycle-gap-handling-unknown-and-computed-attributes)
6. [Putting It All Together: The Pipeline Worker Deployment](#putting-it-all-together-the-pipeline-worker-deployment)
7. [What's Next](#whats-next)

## The Reader's Problem: Connecting to Shared Infrastructure
<!-- section-summary: Data sources let one Terraform configuration read shared infrastructure owned by another team. -->

A **Terraform data source** is a read-only lookup. Terraform asks a provider for information about something that already exists, then your configuration uses the returned attributes.

A small production story makes this easier to see. A data platform team is building a batch pipeline. The pipeline workers need to run inside the company's production VPC, land in private subnets, and talk to a shared warehouse database. The team needs three facts before it can create the workers: the VPC ID, the private subnet IDs, and the security group that the database already trusts.

The platform networking team owns those VPCs, subnets, route tables, NAT gateways, and shared security groups in a separate Terraform project. The data team only needs to attach workers to that network. The platform project keeps lifecycle ownership for updates, replacement, drift handling, and deletion.

If the data team writes `resource "aws_vpc" "prod"`, Terraform treats that as a VPC this project creates and manages. A resource block creates or manages objects tracked by the current state. It gains control of an existing cloud object through an import or an existing state entry. Import can be the right move during a planned ownership transfer, but it is the wrong move for a team that only needs to attach new workers to a shared network.

This is where data sources fit. They let the data team ask AWS, "Which production VPC does the platform team manage?" and then use the answer while creating only the pipeline resources.

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}

data "aws_subnets" "platform_private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.platform_prod.id]
  }

  filter {
    name   = "tag:Tier"
    values = ["Private"]
  }
}

data "aws_security_group" "warehouse_clients" {
  vpc_id = data.aws_vpc.platform_prod.id

  filter {
    name   = "group-name"
    values = ["prod-warehouse-clients"]
  }
}
```

The first block returns one existing VPC. The second returns the private subnets inside that VPC. The third returns the security group that the warehouse team expects pipeline clients to use. The data team's configuration can now create workers in the right place without copying VPC IDs into variables and without managing the platform team's network.

## Anatomy of a Data Source Block
<!-- section-summary: A data source block has a provider type, a local name, search arguments, and returned attributes. -->

A data source block is the Terraform syntax for one read-only lookup. It names the kind of thing to find, gives the lookup a local name, and provides enough search criteria for the provider to return the right object. Example: `data "aws_vpc" "platform_prod"` asks AWS for an existing VPC, while `data.aws_vpc.platform_prod.id` lets later resources use the VPC ID without creating or owning that VPC.

The block has four pieces that matter in daily Terraform work.

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}

resource "aws_security_group" "pipeline_workers" {
  name        = "prod-pipeline-workers"
  description = "Security group for data pipeline workers"
  vpc_id      = data.aws_vpc.platform_prod.id
}
```

| Piece | What it means | In the example |
|---|---|---|
| `data` | This block reads an existing object | Terraform queries AWS instead of creating a VPC |
| `aws_vpc` | The provider-defined data source type | The AWS provider knows how to look up VPCs |
| `platform_prod` | The local name inside this module | Other blocks reference `data.aws_vpc.platform_prod` |
| `tags` | The provider-specific search arguments | AWS should find the VPC with these exact tags |

The full address is `data.aws_vpc.platform_prod`. After Terraform reads the VPC, attributes hang off that address. The security group uses `data.aws_vpc.platform_prod.id` because AWS security groups need a VPC ID.

Provider documentation decides which arguments and attributes exist. For `aws_vpc`, a team can search by `id`, `cidr_block`, `default`, `tags`, or lower-level `filter` blocks. For `aws_ami`, the useful arguments look different because the real object is different. That is why the Terraform language defines the shape of the `data` block, while each provider defines the lookup details.

In real projects, teams usually prefer stable labels over generated IDs. The value `vpc-0abcd1234efgh5678` works, but it changes when the platform team rebuilds the VPC. Tags like `Environment = prod` and `Owner = platform-networking` can stay stable across a rebuild. The data source gives Terraform the current generated ID at plan time.

Once evaluated, the data source returns attributes. A VPC lookup can return the VPC ID, CIDR block, ARN, DNS settings, tags, and other provider-defined fields. Most configurations use only a few of those values. The rest still matter because Terraform stores the read result in state for the run.

## Systems Engineering Mechanics: Read-Only API Interactions
<!-- section-summary: Terraform Core asks the provider to read the data source, and the provider calls the cloud API. -->

A data source read is a provider API request that returns information without creating or changing the object being read. Terraform Core asks the provider plugin to perform the lookup, and the provider turns the HCL filters into the cloud service's read API call.

Example: `data "aws_vpc" "platform_prod"` turns into an AWS `DescribeVpcs` request. The result gives Terraform a VPC ID it can pass into later resources, while the VPC itself stays owned by the platform networking team.

![A Terraform data source reads existing infrastructure through a provider query and returns values for the plan.](/content-assets/articles/article-iac-terraform-config-data-sources/data-source-lookup-path.png)

*Data sources read existing infrastructure so new resources can connect to it without managing it.*

During `terraform plan`, the output often shows the read as a small step:

```console
data.aws_vpc.platform_prod: Reading...
data.aws_vpc.platform_prod: Read complete after 0s [id=vpc-0abcd1234efgh5678]
```

That tiny line hides a useful chain. Terraform loads the AWS provider, the provider resolves credentials from the normal AWS credential chain, and the provider sends a read request to the AWS API. AWS checks the caller's IAM permissions before returning anything. If the caller can describe the VPC, Terraform receives the response. If the caller cannot, the plan fails with an access error.

The provider then maps the API response into Terraform attributes. Terraform expects those attributes to match the provider schema. A VPC ID is a string. Tags are a map of strings. Subnet IDs are a list or set of strings, depending on the data source. This type checking is the reason `data.aws_vpc.platform_prod.id` can flow into `vpc_id` on a security group without Terraform treating it like an unstructured JSON blob.

To understand how these mappings align, we can examine the relationship between HCL types, the underlying cloud API operations, and the key response fields that populate our configuration workspace:

| HCL Data Source Type | Cloud Provider API Action | HTTP Method | Key Response Payload Field |
|---|---|---|---|
| aws_vpc | DescribeVpcs | POST | Vpcs.VpcId |
| aws_subnets | DescribeSubnets | POST | Subnets.SubnetId |
| aws_security_group | DescribeSecurityGroups | POST | SecurityGroups.GroupId |
| aws_ami | DescribeImages | POST | Images.ImageId |

Terraform serializes the read result into state with `mode` set to `data`. During a normal refreshed plan, Terraform asks the provider to read the data source again and update the state entry for this run. If refresh is skipped, Terraform may reuse the value already in state, so a lookup result can lag behind the real cloud object until the next refreshed run.

This is also why secret data sources need care. A data source that reads a password, token, or private key can place that returned value in state unless the provider and Terraform mark it carefully as sensitive. For shared network IDs, that state entry is usually fine. For raw secrets, state access is part of the security design.

## Dynamic Filtering and Search Constraints
<!-- section-summary: Filters turn team naming and tagging rules into precise provider searches. -->

A filter is a search rule for a data source. It tells the provider which existing objects are acceptable matches, usually by tag, name, parent resource, region, or another attribute the cloud API can search. Example: instead of hardcoding `vpc-0abcd1234efgh5678`, a configuration can search for a VPC where `Owner = platform-networking` and `Purpose = shared-platform`, then use the current VPC ID the platform team owns.

Dynamic filtering keeps configuration tied to stable labels instead of fragile generated identifiers. Cloud providers assign physical IDs when resources are created, and those IDs can change when a shared network is rebuilt. Tags and naming conventions are usually the durable contract between teams.

Here is a filter that is too broad for a real production account:

```hcl
data "aws_vpc" "prod" {
  filter {
    name   = "tag:Environment"
    values = ["prod"]
  }
}
```

Many accounts have more than one production VPC: one for shared services, one for data platforms, one for customer-facing apps, and one for experiments. A singular data source like `aws_vpc` needs one match, so a broad filter can fail when AWS returns several VPCs.

A production version uses the tags that both teams agree on:

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}
```

For subnets, the data team usually wants a collection. The pipeline can run workers in every private subnet reserved for that workload:

```hcl
data "aws_subnets" "pipeline_private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.platform_prod.id]
  }

  filter {
    name   = "tag:Tier"
    values = ["Private"]
  }

  filter {
    name   = "tag:Workload"
    values = ["DataPipeline"]
  }
}

locals {
  pipeline_subnet_ids = sort(data.aws_subnets.pipeline_private.ids)
}
```

That example uses `aws_subnets`, the plural data source, because an autoscaling group or ECS service can accept several subnet IDs. The `sort()` call gives a stable list order inside Terraform expressions. Sorting only prevents noisy diffs when the provider returns the same IDs in a different order.

For one specific subnet, a singular lookup needs enough constraints:

```hcl
data "aws_subnet" "pipeline_private_a" {
  vpc_id = data.aws_vpc.platform_prod.id

  filter {
    name   = "tag:Name"
    values = ["prod-pipeline-private-us-east-1a"]
  }
}
```

This is the practical rule: singular data sources need one clear answer, while plural data sources intentionally return a collection.

| Query Result | Engine Behavior | System Rationale |
|---|---|---|
| Zero Matches | Fatal Exception | Downstream attributes cannot resolve to empty structures, preventing deterministic plan generation. |
| Multiple Matches | Fatal Exception | The engine cannot make assumptions about which resource is the intended target, avoiding configuration drift. |
| Exactly One Match | Success | The unique resource attributes are mapped directly into the configuration memory space. |

In a real platform, this works only when tags are treated as a contract. The networking team should document which tags consumers can rely on, and the consuming team should keep filters narrow enough to fail loudly when the contract breaks. A plan that fails because it found zero VPCs is much better than a plan that deploys workers into the wrong network.

## The Lifecycle Gap: Handling Unknown and Computed Attributes
<!-- section-summary: Data sources can read during planning only when their search inputs are already known. -->

An unknown value is a value Terraform cannot know until an apply creates or reads something. Data sources can run early only when their search inputs are already known. Example: a data source can look up a VPC by fixed platform tags during plan, but it cannot look up an endpoint by an ID that will be generated by a resource later in the same apply.

The clean case looks like the platform VPC example. The tags are fixed strings, so Terraform can query the VPC during planning:

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}

resource "aws_security_group" "pipeline_workers" {
  name   = "prod-pipeline-workers"
  vpc_id = data.aws_vpc.platform_prod.id
}
```

Terraform can read the VPC first, then place the returned ID into the planned security group. The plan can show the real VPC ID because the lookup arguments were already known.

The confusing case appears when a data source points back at something this same apply will create or change. Suppose the data team creates its worker security group in this module. The direct resource reference is the useful value:

```hcl
resource "aws_security_group" "pipeline_workers" {
  name   = "prod-pipeline-workers"
  vpc_id = data.aws_vpc.platform_prod.id
}

locals {
  pipeline_worker_security_group_id = aws_security_group.pipeline_workers.id
}
```

Reading that same security group back through a data source adds timing trouble and extra API calls:

```hcl
data "aws_security_group" "pipeline_workers" {
  name   = aws_security_group.pipeline_workers.name
  vpc_id = data.aws_vpc.platform_prod.id
}
```

That second block asks AWS to find an object that this module is already managing. The resource address already has the ID, name, and VPC. Data sources work best for objects owned somewhere else. Resources work best for objects this module owns.

When another team owns the warehouse access group and gives the data team a stable name, a data source makes sense:

```hcl
data "aws_security_group" "warehouse_clients" {
  vpc_id = data.aws_vpc.platform_prod.id

  filter {
    name   = "group-name"
    values = ["prod-warehouse-clients"]
  }
}

locals {
  warehouse_client_security_group_id = data.aws_security_group.warehouse_clients.id
}
```

![Data source values depend on when Terraform can resolve filters, provider reads, and dependent resource inputs.](/content-assets/articles/article-iac-terraform-config-data-sources/unknown-value-timing.png)

*Data source values are only safe to use when Terraform can resolve them at the right point in the plan.*

Terraform builds a dependency graph from references like `data.aws_vpc.platform_prod.id` and `aws_security_group.pipeline_workers.id`. The graph tells Terraform which reads and writes must happen first. If a data source uses only known values, Terraform usually reads it during the plan. If a data source argument depends on a resource value that will exist only after apply, Terraform may defer the read and show related attributes as known after apply.

That timing affects every downstream value. If a launch template, security group rule, or application setting references a deferred data source attribute, that dependent argument also stays unknown during the plan. Terraform can still validate the expression shape, but it cannot show the final value yet.

There are three practical responses:

| Situation | Better choice |
|---|---|
| This module creates the object | Reference the resource attributes directly |
| Another module owns the object and publishes a stable name or tag | Provider data source with narrow filters |
| Another Terraform state is the intended contract | `terraform_remote_state` or a more explicit publishing mechanism such as SSM Parameter Store, DNS, or a service registry |

![Terraform data sources can read during plan when filters are known, or wait until apply when filters depend on newly created resources.](/content-assets/articles/article-iac-terraform-config-data-sources/data-source-timing-paths.png)

*Known filters can be queried during planning; filters that rely on pending resources produce known-after-apply values until the apply creates the upstream object.*

The main idea is simple: data sources read from the outside world, so the search inputs should usually be known before Terraform starts making changes. That gives the reader a plan with concrete values instead of a plan full of placeholders.

## Putting It All Together: The Pipeline Worker Deployment
<!-- section-summary: A full data-pipeline example shows data sources feeding managed resources without taking ownership of shared infrastructure. -->

The pieces connect in one small pipeline deployment. The data team owns the worker security group and worker instance. The platform networking team owns the VPC, subnets, and warehouse-client security group. Data sources provide the boundary between those responsibilities.

First, Terraform reads the shared network objects:

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}

data "aws_subnet" "pipeline_private_a" {
  vpc_id = data.aws_vpc.platform_prod.id

  filter {
    name   = "tag:Name"
    values = ["prod-pipeline-private-us-east-1a"]
  }
}

data "aws_security_group" "warehouse_clients" {
  vpc_id = data.aws_vpc.platform_prod.id

  filter {
    name   = "group-name"
    values = ["prod-warehouse-clients"]
  }
}
```

Then the module creates only the objects the data team owns:

```hcl
resource "aws_security_group" "pipeline_workers" {
  name        = "prod-pipeline-workers"
  description = "Security group for data pipeline workers"
  vpc_id      = data.aws_vpc.platform_prod.id
}

resource "aws_vpc_security_group_egress_rule" "workers_to_warehouse" {
  security_group_id            = aws_security_group.pipeline_workers.id
  referenced_security_group_id = data.aws_security_group.warehouse_clients.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_instance" "pipeline_worker" {
  ami                    = var.pipeline_worker_ami_id
  instance_type          = "t3.small"
  subnet_id              = data.aws_subnet.pipeline_private_a.id
  vpc_security_group_ids = [aws_security_group.pipeline_workers.id]

  tags = {
    Name      = "prod-pipeline-worker-a"
    Workload  = "DataPipeline"
    ManagedBy = "terraform"
  }
}
```

The ownership line is visible in the addresses. Every `data.*` address reads something owned elsewhere. Every `resource.*` address creates or manages something in this module. That pattern keeps reviews clear because a teammate can scan the file and see which objects this state can change.

Terraform also stores the resolved data source attributes in state. A VPC data source entry can look like this:

```json
{
  "mode": "data",
  "type": "aws_vpc",
  "name": "platform_prod",
  "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
  "instances": [
    {
      "schema_version": 0,
      "attributes": {
        "arn": "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-0abcd1234efgh5678",
        "cidr_block": "10.0.0.0/16",
        "id": "vpc-0abcd1234efgh5678",
        "tags": {
          "Environment": "Production",
          "Owner": "platform-networking",
          "Purpose": "shared-platform"
        }
      }
    }
  ]
}
```

This record helps Terraform remember what it read during the run. It also explains why state permissions matter even for read-only lookups. The state file may include network IDs, tags, endpoint names, ARNs, and sometimes sensitive data if a provider data source returns secrets.

The final shape is practical. The data team avoids hardcoded VPC IDs, avoids taking ownership of platform resources, and still creates a worker in the right private subnet with the right database egress path. The platform team can rebuild the VPC later as long as it preserves the agreed tags and names. The next refreshed plan will discover the current IDs.

## What's Next
<!-- section-summary: Remote state is another way to share values when teams want an explicit Terraform output contract. -->

Data sources are a good fit when the real cloud object is the source of truth. The data team asks AWS what exists right now, and Terraform uses the answer.

Some teams want a more explicit contract between Terraform projects. The networking project can publish outputs such as `vpc_id`, `private_subnet_ids`, and `warehouse_security_group_id`, and the pipeline project can read those outputs instead of searching AWS by tags. The next article covers `terraform_remote_state`, including where it helps and where state access creates security tradeoffs.

![A six-part summary infographic for Terraform data sources covering read-only lookup, filters, provider reads, returned values, unknown timing, and ownership boundaries.](/content-assets/articles/article-iac-terraform-config-data-sources/data-sources-summary.png)

*This summary is the quick data-source checklist before connecting to shared infrastructure.*


---

**References**

- [Data Sources Documentation](https://developer.hashicorp.com/terraform/language/data-sources) - Official reference on declaring and referencing data blocks in HashiCorp Configuration Language.
- [Data Block Reference](https://developer.hashicorp.com/terraform/language/block/data) - Official syntax reference for `data` blocks, including provider-specific arguments, meta-arguments, and lifecycle conditions.
- [Resources Documentation](https://developer.hashicorp.com/terraform/language/resources) - Official distinction between managed resources and read-only data sources.
- [AWS Provider EC2 Data Sources](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/vpc) - Technical reference for querying virtual networks and subnets using the AWS translation provider.
- [AWS VPC Security Group Egress Rule Resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_egress_rule) - Current AWS provider pattern for standalone security group rules.
- [DescribeVpcs API Reference](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeVpcs.html) - First-party AWS documentation on the service-level operations and query parameters for virtual networks.
- [Terraform Core Execution Graph](https://developer.hashicorp.com/terraform/internals/graph) - Technical description of the internal dependency graph mechanics and topological evaluation order.
- [The terraform_remote_state Data Source](https://developer.hashicorp.com/terraform/language/state/remote-state-data) - Official reference for reading root module outputs from another Terraform state snapshot and the related access tradeoffs.

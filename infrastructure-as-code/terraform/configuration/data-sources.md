---
title: "Data Sources: Querying Infrastructure"
description: "Reference and consume pre-existing infrastructure safely using read-only provider queries."
overview: "A data source is a read-only lookup that lets Terraform use existing infrastructure without taking ownership of it. This article shows data source filters, where returned values are consumed, how data reads appear during plan, and the security limits around secret data."
tags: ["terraform", "data-sources", "querying", "state"]
order: 3
id: article-iac-terraform-config-data-sources
---

## Table of Contents

1. [What a Data Source Does](#what-a-data-source-does)
2. [The Shared Network Scenario](#the-shared-network-scenario)
3. [Data Source Syntax](#data-source-syntax)
4. [Resources Consuming Data Source Values](#resources-consuming-data-source-values)
5. [Plan Output and Lookup Failures](#plan-output-and-lookup-failures)
6. [Data Sources, State, and Secrets](#data-sources-state-and-secrets)
7. [Putting It All Together](#putting-it-all-together)

## What a Data Source Does
<!-- section-summary: A data source reads existing information from a provider so your Terraform code can use it without managing that object. -->

A **data source** is a read-only lookup. Terraform asks a provider for information about something that already exists, then your configuration consumes the returned attributes.

Use a data source when another team, another stack, or the cloud platform owns the object. Your configuration needs the object's ID, ARN, name, CIDR block, image ID, or other attribute, but it should not create, update, or delete that object.

This is different from a resource. A resource means lifecycle ownership. A data source means lookup and consumption.

## The Shared Network Scenario
<!-- section-summary: Data sources let an application stack connect to a platform-owned network without importing or owning the network. -->

Imagine a data pipeline team deploying workers into a production VPC. The platform networking team owns the VPC, private subnets, route tables, NAT gateways, and shared security groups in a separate Terraform stack.

The data pipeline stack needs three values:

1. The production VPC ID.
2. The private subnet IDs for pipeline workers.
3. The security group ID that the warehouse database trusts.

Hardcoding those IDs works until the platform team rebuilds the network. Importing the VPC into the pipeline stack would transfer lifecycle ownership into the wrong place. Data sources let the pipeline stack ask AWS for the current values using stable tags.

## Data Source Syntax
<!-- section-summary: A data block names the provider lookup type, local name, and search arguments used to find the existing object. -->

Here are the lookups in `data.tf`:

```hcl
data "aws_vpc" "platform_prod" {
  tags = {
    Environment = "prod"
    Owner       = "platform-networking"
    Purpose     = "shared-platform"
  }
}

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

data "aws_security_group" "warehouse_clients" {
  vpc_id = data.aws_vpc.platform_prod.id

  filter {
    name   = "group-name"
    values = ["prod-warehouse-clients"]
  }
}
```

The full data source addresses are:

```hcl
data.aws_vpc.platform_prod
data.aws_subnets.pipeline_private
data.aws_security_group.warehouse_clients
```

The VPC data source returns attributes such as `id`, `cidr_block`, and `tags`. The subnets data source returns `ids`. The security group data source returns `id`. Provider documentation defines the exact arguments and attributes for each data source.

## Resources Consuming Data Source Values
<!-- section-summary: Data source values help when resources and locals consume returned attributes. -->

In `locals.tf`, the pipeline stack shapes the subnet IDs:

```hcl
locals {
  private_subnet_ids = sort(data.aws_subnets.pipeline_private.ids)
}
```

In `main.tf`, resources consume the VPC, subnet, and security group values:

```hcl
resource "aws_security_group" "pipeline_workers" {
  name        = "prod-pipeline-workers"
  description = "Security group for data pipeline workers"
  vpc_id      = data.aws_vpc.platform_prod.id

  tags = {
    service     = "pipeline"
    environment = "prod"
    managed_by  = "terraform"
  }
}

resource "aws_vpc_security_group_egress_rule" "workers_to_warehouse" {
  security_group_id            = aws_security_group.pipeline_workers.id
  referenced_security_group_id = data.aws_security_group.warehouse_clients.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_autoscaling_group" "workers" {
  name                = "prod-pipeline-workers"
  max_size            = 6
  min_size            = 2
  desired_capacity    = 2
  vpc_zone_identifier = local.private_subnet_ids
}
```

The value path is visible. The VPC lookup feeds the new security group. The warehouse security group lookup feeds the egress rule. The subnet lookup feeds a local sorted list, and the autoscaling group consumes that list.

## Plan Output and Lookup Failures
<!-- section-summary: Data source reads appear before dependent resources, and narrow filters should fail loudly when the lookup contract breaks. -->

During plan, Terraform reads the data sources:

```hcl
data.aws_vpc.platform_prod: Reading...
data.aws_vpc.platform_prod: Read complete after 0s [id=vpc-0abcd1234efgh5678]
data.aws_subnets.pipeline_private: Reading...
data.aws_subnets.pipeline_private: Read complete after 0s [id=us-east-1]
data.aws_security_group.warehouse_clients: Reading...
data.aws_security_group.warehouse_clients: Read complete after 0s [id=sg-0123456789abcdef0]
```

Then the plan shows the returned values consumed by resources:

```hcl
  # aws_security_group.pipeline_workers will be created
  + resource "aws_security_group" "pipeline_workers" {
      + name   = "prod-pipeline-workers"
      + vpc_id = "vpc-0abcd1234efgh5678"
    }

  # aws_vpc_security_group_egress_rule.workers_to_warehouse will be created
  + resource "aws_vpc_security_group_egress_rule" "workers_to_warehouse" {
      + from_port                    = 5432
      + referenced_security_group_id = "sg-0123456789abcdef0"
      + to_port                      = 5432
    }

  # aws_autoscaling_group.workers will be created
  + resource "aws_autoscaling_group" "workers" {
      + vpc_zone_identifier = [
          + "subnet-aaa111",
          + "subnet-bbb222",
        ]
    }
```

A singular data source should find exactly one match. Zero matches means the contract is missing or the provider identity cannot see the object. Multiple matches means the filter is too broad. Both failures are useful because they stop the plan before Terraform deploys into the wrong network.

:::expand[Why stable tags make better lookup contracts]{kind="pattern"}
Generated IDs can change when a platform team rebuilds infrastructure. A VPC ID, subnet ID, or AMI ID may be different after a migration. Stable tags and names are the contract that survives the rebuild.

This only works when the owning team treats those tags as an API. If the platform team documents `Environment`, `Owner`, and `Purpose` as supported lookup tags, consuming teams can write narrow filters. If tags are inconsistent, data sources either fail or return the wrong object.

Good lookup contracts include the tag names, allowed values, owning team, and expected cardinality. A singular data source should have one clear answer. A plural data source should return the intended collection.
:::

## Data Sources, State, and Secrets
<!-- section-summary: Data source results can be recorded in state, so secret-reading data sources require the same care as secret resources. -->

Terraform stores data source results in state for the run. For network IDs and AMI IDs, that is usually fine. For raw secrets, it can be risky.

A data source that reads a secret value can place that returned value in state if the provider exposes it and resources consume it. Prefer passing secret references, such as ARNs or paths, and let applications read secrets at runtime through identity. If Terraform only needs to grant access, it usually needs the secret ARN, not the secret value.

This is the safe split: data sources are great for shared infrastructure IDs and metadata. Raw secret values need a stronger reason and a protected state backend.

## Putting It All Together
<!-- section-summary: Data sources safely connect stacks when they read stable lookup contracts and resources consume only the returned values they need. -->

Data sources let Terraform use existing infrastructure without taking ownership. They are the right tool when one stack creates the network and another stack deploys into it. Keep filters narrow, use stable tags, read plan output, and protect state when returned values are sensitive.

For official reference, use Terraform's docs for [data sources](https://developer.hashicorp.com/terraform/language/data-sources), [data block syntax](https://developer.hashicorp.com/terraform/language/data-sources/syntax), [references to values](https://developer.hashicorp.com/terraform/language/expressions/references), and [sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data).

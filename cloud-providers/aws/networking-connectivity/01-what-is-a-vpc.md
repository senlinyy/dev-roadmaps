---
title: "What Is a VPC?"
description: "Understand Amazon VPC boundaries, regional scope, CIDR planning, subnets, route tables, ENIs, gateways, endpoints, and how a beginner AWS app fits inside."
overview: "A VPC is the private regional network where AWS resources receive addresses, attach network interfaces, and follow route tables. This article uses a receipts app to connect the VPC boundary, CIDR planning, subnet tiers, route tables, network interfaces, gateways, and endpoints."
tags: ["aws", "vpc", "networking", "cidr", "subnets", "route-tables", "eni"]
order: 1
id: article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology
aliases:
  - logical-isolation-and-network-topology
  - networking-mental-model
  - trace-one-request-through-aws-networking
  - vpcs-subnets-and-route-tables
  - place-workloads-in-a-vpc-without-publishing-everything
  - public-and-private-access
  - article-cloud-providers-aws-networking-connectivity-networking-mental-model
  - article-cloud-providers-aws-networking-connectivity-vpcs-subnets-route-tables
  - article-cloud-providers-aws-networking-connectivity-public-private-access
  - cloud-providers/aws/networking-connectivity/networking-mental-model.md
  - cloud-providers/aws/networking-connectivity/vpcs-subnets-and-route-tables.md
  - cloud-providers/aws/networking-connectivity/public-private-access.md
  - logical-isolation-network-topology
  - cloud-providers/aws/networking-connectivity/logical-isolation-network-topology.md
  - cloud-providers/aws/networking-connectivity/01-logical-isolation-network-topology.md
---
## Table of Contents

1. [The App Needs a Private Place](#the-app-needs-a-private-place)
2. [The VPC Boundary](#the-vpc-boundary)
3. [The Address Range](#the-address-range)
4. [The First Subnet Shape](#the-first-subnet-shape)
5. [Routes, Interfaces, and Outside Paths](#routes-interfaces-and-outside-paths)
6. [A Small VPC Sketch](#a-small-vpc-sketch)
7. [First Review Questions](#first-review-questions)
8. [References](#references)

## The App Needs a Private Place
<!-- section-summary: A VPC gives a beginner AWS app one private regional network where its public entry, private code, and data tier can be placed deliberately. -->

Imagine a small receipts app. Customers open a website, the website calls an API, and the API saves receipt data in a database. At the beginning, the app only needs a few resources, but those resources already need different network treatment. Customers need a public entry point, application code needs a private place to run, and the database needs a private address that only the app can use.

A **VPC**, or Virtual Private Cloud, is the private network you create inside one AWS Region. It gives your AWS resources a shared address range, smaller subnet ranges, route tables, network interfaces, and optional paths to the internet, AWS services, or other networks. For the receipts app, the VPC is the place where the team decides which parts can face customers and which parts stay private.

The first version can stay simple. A public load balancer receives HTTPS from customers. API tasks run in private subnets. A database runs in data subnets. The VPC does the network organizing work so those pieces can share private addresses while the public surface stays small.

That is the useful beginner idea: a VPC is the network plan for the app. The plan says which private IP range belongs to the app, which subnets exist in each Availability Zone, which routes each subnet follows, and which outside paths are allowed.

## The VPC Boundary
<!-- section-summary: A VPC belongs to one AWS Region, spans Availability Zones in that Region, and stays separate from other VPCs until the team adds a connection. -->

A VPC lives in one AWS Region, such as `us-east-1` or `eu-west-2`. Inside that Region, AWS offers multiple **Availability Zones**, which are separate datacenter locations. You create the VPC once for the Region, then create subnets inside specific Availability Zones so the app can run across more than one location.

The VPC boundary gives private networks a clear separation. If the receipts app runs in one VPC and a reporting platform runs in another VPC, private traffic needs an explicit connection such as VPC peering, Transit Gateway, PrivateLink, VPN, Direct Connect, or a public API path. AWS keeps those private address spaces separate until the team adds a connection.

That separation helps teams keep environments understandable. A production account may have a production VPC, while development and staging use their own VPCs in separate accounts. During a review, the VPC name helps humans, but the actual boundary comes from the CIDR range, subnets, route tables, security groups, network ACLs, and explicit network connections.

For the receipts app, the VPC boundary answers the first design question. The public load balancer, private API tasks, and database belong to the same app network. A future analytics system or corporate network can connect later, but that connection should have its own review rather than appearing by accident.

![The VPC boundary view shows the private address space, subnets, route tables, gateways, endpoints, and external paths around one app](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/vpc-boundary-map.png)

*The VPC boundary view shows the private address space, subnets, route tables, gateways, endpoints, and external paths around one app.*


## The Address Range
<!-- section-summary: A CIDR block is the private IP range for the VPC, and the first choice should leave room for subnets, growth, and future network connections. -->

When you create a VPC, you choose a **CIDR block**, such as `10.40.0.0/16`. A CIDR block is the IP address range the VPC owns. Every subnet takes a smaller slice from that range, and every private resource receives an address from one of those slices.

For the receipts app, `10.40.0.0/16` gives a beginner-friendly amount of space. The team can reserve `10.40.0.0/24` and `10.40.1.0/24` for public subnets, `10.40.10.0/24` and `10.40.11.0/24` for private app subnets, and `10.40.20.0/24` and `10.40.21.0/24` for data subnets. The exact numbers can change, but the pattern matters: each tier gets room in more than one Availability Zone.

AWS reserves five IPv4 addresses in every subnet. A `/28` subnet has 16 total addresses, and only 11 are available after those reservations. That can disappear quickly once load balancer nodes, endpoint network interfaces, container tasks, and managed service interfaces arrive. A `/24` per tier per Availability Zone is generous for a beginner app and leaves room for scale events.

Address planning also matters when networks connect later. If the office network already uses `10.40.0.0/16`, the VPC should use a different range. Overlapping private ranges create routing confusion because the same destination address could refer to two different places. Larger organizations often track this with an address plan or AWS VPC IP Address Manager.

## The First Subnet Shape
<!-- section-summary: Subnets place resources into Availability Zones and tiers, so the app can separate public entry, private work, and data services. -->

A **subnet** is a smaller CIDR block inside one Availability Zone. This is the placement unit for many AWS resources. EC2 instances, ECS tasks, load balancer nodes, RDS database interfaces, NAT gateways, and many VPC endpoints all land in subnets.

The receipts app can use three simple tiers. Public subnets hold the internet-facing load balancer and NAT gateways. Private app subnets hold API tasks and workers. Data subnets hold the database and other stateful services that should receive narrow internal traffic.

| Tier | Example subnets | What goes there |
| --- | --- | --- |
| Public | `10.40.0.0/24`, `10.40.1.0/24` | Internet-facing load balancer, public NAT gateways |
| Private app | `10.40.10.0/24`, `10.40.11.0/24` | API tasks, worker tasks, internal services |
| Data | `10.40.20.0/24`, `10.40.21.0/24` | RDS, cache, data-only service endpoints |

The words **public**, **private**, and **data** are labels for a design. The route table attached to the subnet decides the actual path. A public subnet has a route to an internet gateway. A private app subnet usually uses NAT or VPC endpoints for outbound dependencies. A data subnet usually keeps broad internet egress away from the database tier.

This shape also gives the app a natural request path. A customer reaches the load balancer in a public subnet. The load balancer forwards to an API task in a private app subnet. The API task connects to the database in a data subnet. Each hop has a source, destination, route, and traffic rule that can be inspected.

![The two-AZ layout makes public, private app, and database subnet placement visible without jumping straight into every routing detail](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/two-az-subnet-layout.png)

*The two-AZ layout makes public, private app, and database subnet placement visible without jumping straight into every routing detail.*


## Routes, Interfaces, and Outside Paths
<!-- section-summary: Route tables choose packet targets, network interfaces give resources private addresses, and gateways or endpoints add deliberate paths outside the VPC. -->

A **route table** tells packets where to go next. Every VPC route table includes a local route for the VPC CIDR, such as `10.40.0.0/16 -> local`. That local route lets the API subnet reach the database subnet inside the same VPC, as long as security rules allow the traffic.

An **elastic network interface**, often called an ENI, is the virtual network card that gives a resource its private IP address and security groups. EC2 instances have ENIs, and many managed services create ENIs for you. When a database endpoint or VPC endpoint appears in a subnet, an ENI is often the concrete network object behind it.

Outside paths are added deliberately. An **internet gateway** gives public subnets a route for direct internet traffic. A **NAT gateway** lets private IPv4 resources start outbound connections to public IPv4 destinations, such as a payment provider or package repository. A **VPC endpoint** gives private access to supported AWS services such as S3, ECR, CloudWatch Logs, Secrets Manager, and STS.

The app can add outside paths as requirements appear. The public load balancer needs internet entry. The private API may need NAT for a public payment provider and endpoints for AWS services. The database usually stays on private addresses with no broad outbound route. The next articles build each of those choices slowly.

## A Small VPC Sketch
<!-- section-summary: A small Terraform sketch shows the important VPC fields at beginner scope. -->

A first VPC can start with only the regional network and one subnet from each tier. This sketch is intentionally small so the important fields are visible:

```hcl
resource "aws_vpc" "receipts" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "receipts-prod"
  }
}

resource "aws_subnet" "public_a" {
  vpc_id            = aws_vpc.receipts.id
  cidr_block        = "10.40.0.0/24"
  availability_zone = "us-east-1a"

  tags = {
    Name = "receipts-public-a"
    Tier = "public"
  }
}

resource "aws_subnet" "private_app_a" {
  vpc_id            = aws_vpc.receipts.id
  cidr_block        = "10.40.10.0/24"
  availability_zone = "us-east-1a"

  tags = {
    Name = "receipts-private-app-a"
    Tier = "private-app"
  }
}
```

The `cidr_block` on the VPC defines the whole private range for the app. The subnet `cidr_block` values take smaller slices from that range. The `availability_zone` field places each subnet in a specific zone, and the tags make later reviews easier because humans can see the intended tier.

The DNS attributes are useful defaults for modern VPCs. `enable_dns_support` lets resources use the Amazon-provided DNS resolver for the VPC. `enable_dns_hostnames` allows public DNS hostnames for resources that receive public IPv4 addresses, and it also helps several private DNS patterns work cleanly with VPC endpoints and managed services.

## First Review Questions
<!-- section-summary: A beginner VPC review checks the private range, tier layout, route intent, available addresses, and every planned outside path. -->

A first VPC design is ready for review when the team can answer concrete questions. Which CIDR range does the VPC own? Which public, private app, and data subnets exist in each Availability Zone? Which route table should each tier use? Which resources need public entry, and which resources should use private addresses?

The review should also name the dependencies. The API may need to reach S3 for receipt files, CloudWatch Logs for application logs, ECR for container images, Secrets Manager for database credentials, and a payment provider over the public internet. AWS service dependencies often fit VPC endpoints. Public third-party dependencies usually need NAT or a private provider connection.

Default VPCs deserve a quick check during early learning. Many AWS accounts include a default VPC in each Region with defaults that help people launch resources quickly. That is useful for experiments, but production resources should land in the planned VPC and subnet tier. If a database or app server appears in the default VPC by accident, moving it early prevents a small mistake from growing into a network migration.

At this point, the receipts app has a private regional home. The next step is subnet behavior: which subnets can receive internet traffic, which subnets can start outbound calls, and which subnets should stay quiet around the database tier.

![The build checks summarize the first VPC review questions for CIDR, subnets, routes, endpoints, security groups, and logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/vpc-build-checks.png)

*The build checks summarize the first VPC review questions for CIDR, subnets, routes, endpoints, security groups, and logs.*


## References

- [Amazon VPC documentation: What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [Amazon VPC documentation: How Amazon VPC works](https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html)
- [Amazon VPC documentation: VPC and subnet sizing for IPv4](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)
- [Amazon VPC documentation: DNS attributes for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-dns.html)

---
title: "Route Tables, IGW, and NAT"
description: "Understand how AWS VPC route tables send traffic through local routes, internet gateways, NAT gateways, and IPv6 egress-only internet gateways."
overview: "Route tables decide the next hop for packets leaving each subnet. This article follows a payments application through public load balancer routes, private API egress through NAT gateways, longest-prefix routing, and practical route debugging."
tags: ["aws", "vpc", "route-tables", "internet-gateway", "nat-gateway", "networking"]
order: 3
id: article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat
aliases:
  - route-tables-igw-and-nat
  - route-tables-internet-gateway-nat
  - route-tables-internet-gateways-and-nat
---

## Table of Contents

1. [The Payments VPC Path](#the-payments-vpc-path)
2. [What a Route Table Decides](#what-a-route-table-decides)
3. [The Local Route Inside the VPC](#the-local-route-inside-the-vpc)
4. [Public Subnets and the Internet Gateway](#public-subnets-and-the-internet-gateway)
5. [Private Egress Through NAT Gateway](#private-egress-through-nat-gateway)
6. [Longest Prefix Match in Real Routes](#longest-prefix-match-in-real-routes)
7. [IPv6 Egress-Only Internet Gateway](#ipv6-egress-only-internet-gateway)
8. [How to Inspect Effective Paths](#how-to-inspect-effective-paths)
9. [Common Production Mistakes](#common-production-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [References](#references)

## The Payments VPC Path
<!-- section-summary: The article follows one production payments app so every route has a clear reason to exist. -->

Imagine a small payments platform called **Northstar Payments**. Customers open the checkout page from the internet. Their browsers connect to a public **Application Load Balancer**, usually called an ALB. The ALB sends requests to private API tasks running on ECS. Those API tasks write payment records to a private RDS for PostgreSQL database, send settlement exports to Amazon S3, and sometimes call a payment processor API over HTTPS. Operations engineers connect through managed access tooling, such as AWS Systems Manager Session Manager, rather than opening SSH from the internet.

That application has several network conversations, and each one needs a path. A customer browser needs a path to the ALB. The ALB needs a path to the private API tasks. The API tasks need a path to PostgreSQL. The API tasks also need outbound HTTPS access for software updates, payment provider calls, and third-party fraud checks. The database needs no public internet path for the application to work.

The first VPC article talked about **subnets** as slices of a VPC address range. A subnet is tied to one Availability Zone, which is a separate datacenter area inside an AWS Region. This article looks at the thing attached to those subnets that answers the routing question: when a packet leaves this subnet, where should AWS send it next?

That thing is a **route table**. A route table is a list of destination ranges and targets. The destination is the IP range the packet wants to reach. The target is the next AWS networking component that should receive the packet, such as the local VPC router, an internet gateway, a NAT gateway, a VPC endpoint, a peering connection, or a transit gateway.

For Northstar Payments, the public ALB subnet and the private API subnet should have different route tables. The public ALB subnet needs a route to the internet gateway so internet clients can reach the load balancer. The private API subnet needs outbound internet access through a NAT gateway so the tasks can call external services without accepting new inbound internet connections. The database subnet usually keeps only private routes.

## What a Route Table Decides
<!-- section-summary: A route table maps destination IP ranges to next-hop targets for one or more subnets. -->

A **route** has two important parts: a **destination** and a **target**. The destination is written as a CIDR block, such as `10.40.0.0/16` or `0.0.0.0/0`. A CIDR block is a compact way to describe a range of IP addresses. The target is where AWS should send matching traffic next. In a VPC route table, common targets include `local`, an internet gateway ID such as `igw-0123`, a NAT gateway ID such as `nat-0123`, or a VPC endpoint ID such as `vpce-0123`.

Every subnet has exactly one route table association at a time. The association can be explicit, where the subnet names a custom route table, or implicit, where the subnet uses the VPC's **main route table**. The main route table is created with the VPC. In a custom production VPC, a careful team usually leaves the main route table conservative and explicitly associates every subnet with the table meant for that subnet type.

Here is the rough shape of the payments VPC:

| Subnet purpose | Example CIDR | Route table purpose |
|---|---:|---|
| Public ALB subnet in AZ A | `10.40.0.0/24` | Local VPC traffic plus internet gateway route |
| Private API subnet in AZ A | `10.40.10.0/24` | Local VPC traffic plus NAT gateway route |
| Private DB subnet in AZ A | `10.40.20.0/24` | Local VPC traffic and private service routes only |
| Public ALB subnet in AZ B | `10.40.1.0/24` | Local VPC traffic plus internet gateway route |
| Private API subnet in AZ B | `10.40.11.0/24` | Local VPC traffic plus NAT gateway route |
| Private DB subnet in AZ B | `10.40.21.0/24` | Local VPC traffic and private service routes only |

The route table is chosen from the source subnet. When an API task in `10.40.10.0/24` sends a packet to the public IP address of a payment processor, AWS checks the route table associated with the API task's subnet. When PostgreSQL sends a response packet back to the API task, AWS checks the route table associated with the database subnet for that response path. Routing is evaluated from the subnet where the packet leaves.

The route table's job is the next hop. **Security groups** and **network ACLs** decide packet permissions, and the next article covers them. For now, think about route tables as the map that gives traffic a possible path.

![Route table decision infographic showing a source subnet, local VPC route, S3 endpoint route, default NAT or IGW route, and the most specific match rule](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/route-table-decision.png)

*A route table is a next-hop decision board. The source subnet chooses the route table, the destination IP chooses the matching route, and the most specific match wins before the packet reaches a target.*

## The Local Route Inside the VPC
<!-- section-summary: Every VPC route table starts with a local route that lets subnets talk across the VPC CIDR. -->

Every VPC route table includes a **local route**. The local route covers the VPC CIDR block, such as `10.40.0.0/16`, and points to the target `local`. This route lets resources inside the VPC communicate with other private addresses in the same VPC. If the VPC has additional IPv4 CIDR blocks or an IPv6 CIDR block, route tables contain local routes for those ranges as well.

For Northstar Payments, the local route is why the public ALB subnet can reach the private API subnet and why the API subnet can reach the database subnet. The ALB node might have a private address like `10.40.0.25`. The API task might have a private address like `10.40.10.88`. PostgreSQL might have a private address like `10.40.20.30`. All three addresses are inside `10.40.0.0/16`, so the local route covers the VPC-internal path.

The route table for a private API subnet may look like this:

| Destination | Target | Meaning |
|---|---|---|
| `10.40.0.0/16` | `local` | Send VPC-internal traffic through the VPC router |
| `0.0.0.0/0` | `nat-0aaa1111` | Send all other IPv4 traffic through the NAT gateway |

The `0.0.0.0/0` route is the broadest IPv4 route. It matches every IPv4 destination, but AWS still chooses the most specific matching route. A packet from the API task to PostgreSQL at `10.40.20.30` matches both `10.40.0.0/16` and `0.0.0.0/0`. AWS chooses `10.40.0.0/16` because `/16` is more specific than `/0`. The database traffic stays inside the VPC and bypasses the NAT gateway.

That local route is the reason private subnets can still talk to each other without internet access. A subnet can have no internet route at all and still communicate with the rest of the VPC through private addresses, assuming the security groups and NACLs allow the packets.

## Public Subnets and the Internet Gateway
<!-- section-summary: A public subnet has a route to an internet gateway, and internet-facing resources still need public addresses. -->

An **internet gateway**, often shortened to **IGW**, is an AWS VPC component that lets resources in the VPC communicate with the internet. It is horizontally scaled and highly available by design, and it is attached to a VPC. For IPv4 traffic, the internet gateway also performs the public-to-private address translation needed when an instance or load balancer uses a public IPv4 address.

A subnet is commonly called **public** when its route table has a route that sends internet-bound traffic to an internet gateway. For IPv4, that route usually has destination `0.0.0.0/0` and target `igw-...`. For IPv6, the public internet route uses destination `::/0` and the same internet gateway target.

For Northstar Payments, the ALB lives in public subnets across at least two Availability Zones. Customers reach the ALB over HTTPS on port 443. The public subnet route table gives the ALB nodes a path back to internet clients.

| Destination | Target | Meaning |
|---|---|---|
| `10.40.0.0/16` | `local` | Private traffic inside the VPC |
| `0.0.0.0/0` | `igw-0abc1234` | Public IPv4 traffic to and from the internet |
| `::/0` | `igw-0abc1234` | Public IPv6 traffic to and from the internet, when IPv6 is used |

The route is one part of internet reachability. For IPv4, a resource also needs a public IPv4 address or an Elastic IP address on the internet-facing network interface. Security groups and NACLs must allow the traffic too. For an ALB, AWS manages the load balancer nodes and exposes public DNS names while the subnet route table provides the required internet path.

A small Terraform sketch for the public path looks like this:

```hcl
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.payments.id
}

resource "aws_route_table" "public_a" {
  vpc_id = aws_vpc.payments.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public_a.id
}
```

That code connects three ideas. The internet gateway attaches to the VPC. The route table sends default IPv4 traffic to the internet gateway. The route table association makes that table control the public subnet. A missing association is a common source of confusion, because the route can exist in one table while the subnet still uses a different table.

## Private Egress Through NAT Gateway
<!-- section-summary: NAT gateways let private IPv4 workloads start outbound connections while blocking unsolicited inbound internet connections. -->

A **NAT gateway** is a managed Network Address Translation service. It lets resources in private subnets initiate connections to destinations outside the VPC while external systems have no fresh inbound path back to those private resources through the NAT gateway. The word "NAT" means the source address is translated as traffic leaves, then translated back when response traffic returns.

For Northstar Payments, the API tasks need outbound HTTPS access. They call a payment processor, fetch container updates, send telemetry, and maybe download a public certificate chain during startup. Those tasks stay in private subnets even though they need outbound access. A public NAT gateway gives them that outbound path.

A public NAT gateway is created in a public subnet and receives an Elastic IP address. The public subnet's route table sends the NAT gateway's own internet-bound traffic to the internet gateway. The private subnet's route table sends its default IPv4 traffic to the NAT gateway. The NAT gateway then uses its address translation behavior so the external service sees the NAT gateway's public address rather than the private address of the API task.

The private API route table in AZ A can look like this:

| Destination | Target | Meaning |
|---|---|---|
| `10.40.0.0/16` | `local` | ALB, API, and database private traffic inside the VPC |
| `0.0.0.0/0` | `nat-0aaa1111` | Outbound IPv4 traffic through the AZ A NAT gateway |

The public subnet that hosts the AZ A NAT gateway still needs its internet route:

| Destination | Target | Meaning |
|---|---|---|
| `10.40.0.0/16` | `local` | Private VPC traffic |
| `0.0.0.0/0` | `igw-0abc1234` | NAT gateway egress to the internet |

The usual production pattern is one NAT gateway per Availability Zone, with each private subnet routing to the NAT gateway in the same Availability Zone. AWS documents that a standard NAT gateway is created in a specific Availability Zone. If private subnets in multiple zones share one NAT gateway and that NAT gateway's zone has an outage, the other zones lose that outbound internet path. Same-zone routing also avoids unnecessary cross-zone traffic charges and avoids a hidden dependency on another zone.

Here is the same pattern in Terraform:

```hcl
resource "aws_eip" "nat_a" {
  domain = "vpc"
}

resource "aws_nat_gateway" "a" {
  allocation_id = aws_eip.nat_a.id
  subnet_id     = aws_subnet.public_a.id
}

resource "aws_route_table" "private_api_a" {
  vpc_id = aws_vpc.payments.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.a.id
  }
}

resource "aws_route_table_association" "private_api_a" {
  subnet_id      = aws_subnet.private_api_a.id
  route_table_id = aws_route_table.private_api_a.id
}
```

The route in `private_api_a` points to the NAT gateway. That detail matters because a private API task using IPv4 needs a public IPv4 address plus an internet gateway route for direct internet gateway access. The NAT gateway gives a private subnet an outbound path while keeping the private task from receiving unsolicited inbound internet connections through that gateway.

## Longest Prefix Match in Real Routes
<!-- section-summary: AWS chooses the most specific matching destination route, which lets teams mix broad defaults with narrow private paths. -->

Route tables often contain broad routes and narrow routes at the same time. AWS uses **longest prefix match** to choose among matching routes. In plain language, the route with the most specific destination range wins.

The prefix length is the number after the slash in a CIDR block. A `/16` covers a large range. A `/24` covers a smaller range. A `/32` covers one IPv4 address. Larger prefix numbers are more specific. The default IPv4 route `0.0.0.0/0` is the broadest route, so it acts as a fallback for destinations outside narrower routes.

Northstar Payments adds an S3 gateway endpoint so API tasks can write settlement exports to S3 privately and reduce NAT gateway data processing. A **VPC endpoint** is a private entry point from a VPC to an AWS service. A gateway endpoint for S3 adds a route table entry that uses an AWS-managed prefix list for S3 addresses in the Region. A **prefix list** is a named set of CIDR blocks that AWS or your team manages as one route destination.

The API route table may then look like this:

| Destination | Target | Why it exists |
|---|---|---|
| `10.40.0.0/16` | `local` | Private VPC traffic |
| `pl-63a5400a` | `vpce-0s3endpoint` | S3 traffic through the gateway endpoint |
| `10.80.0.0/16` | `pcx-0peerapp` | Private traffic to a peered analytics VPC |
| `0.0.0.0/0` | `nat-0aaa1111` | Remaining IPv4 egress through NAT |

When an API task sends a settlement file to S3, the destination IP matches the S3 prefix list route, so AWS sends that traffic to the gateway endpoint. When the same task calls the public API of the payment processor, the destination matches the broad default route, so AWS sends it to the NAT gateway. When the task connects to a service in the analytics VPC at `10.80.5.10`, the `10.80.0.0/16` route wins over the NAT default.

![Private egress paths infographic comparing private API subnet traffic through a NAT gateway for public API calls and an S3 gateway endpoint for receipt bucket uploads](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/private-egress-paths.png)

*The private subnet can have more than one outbound shape. General HTTPS calls can use NAT, while S3 traffic follows the narrower gateway endpoint route and avoids the generic egress path.*

This is why route table design can stay simple even when the app has several outbound paths. The default route handles the general case. Narrow routes handle private networks, service endpoints, inspection appliances, or partner networks. The route table selects the most specific matching route for each packet.

Longest-prefix behavior is also a debugging clue. A route to `0.0.0.0/0` still leaves room for narrower destination routes to win. If S3 calls travel through an endpoint while other HTTPS calls travel through NAT, that is normal when the S3 prefix list route is present.

## IPv6 Egress-Only Internet Gateway
<!-- section-summary: IPv6 outbound-only internet access uses an egress-only internet gateway rather than an IPv4 NAT gateway pattern. -->

IPv6 changes part of the conversation because IPv6 addresses are globally unique. A private IPv4 address like `10.40.10.88` has no public internet route. An IPv6 address assigned from the VPC IPv6 range can be globally reachable unless routing and packet filters prevent that path.

For outbound-only IPv6 access, AWS provides an **egress-only internet gateway**. It allows instances in a VPC to start outbound IPv6 communication to the internet and prevents the internet from initiating IPv6 connections back to those instances through that gateway. It is stateful for the IPv6 egress path, so response traffic for an allowed outbound connection can return.

The route table entry looks like this:

| Destination | Target | Meaning |
|---|---|---|
| `2001:db8:1234:1a00::/56` | `local` | Private IPv6 traffic inside the VPC range |
| `::/0` | `eigw-0abc1234` | Outbound-only IPv6 internet traffic |

For Northstar Payments, this matters if the private API tasks receive IPv6 addresses and the team wants outbound IPv6 access. The IPv4 NAT gateway route and the IPv6 egress-only internet gateway route can live in the same subnet route table because IPv4 and IPv6 routes are separate. `0.0.0.0/0` covers all IPv4 destinations. `::/0` covers all IPv6 destinations.

The key operational point is choosing the right target for the address family. NAT gateway is the normal managed outbound path for private IPv4 workloads. Egress-only internet gateway is the AWS VPC component for outbound-only IPv6 internet access. Security groups and NACLs still matter for packet permission in both cases.

## How to Inspect Effective Paths
<!-- section-summary: Route debugging starts with the source subnet, its route table association, the matching destination route, and the target state. -->

Route debugging gets much more practical when the team follows the packet from the source subnet. The source subnet decides which route table AWS checks. In the payments app, an API task that fails to reach the payment processor starts in a private API subnet, so the private API subnet route table is the first place to inspect.

The operations engineer usually gathers four facts:

| Question | Why it matters | Useful AWS CLI shape |
|---|---|---|
| Which subnet owns the source ENI? | The subnet chooses the route table | `aws ec2 describe-network-interfaces --network-interface-ids eni-0123` |
| Which route table is associated with that subnet? | Explicit association wins over the main table | `aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-0123` |
| Which route matches the destination IP? | Longest prefix match chooses the target | `aws ec2 describe-route-tables --route-table-ids rtb-0123` |
| Is the target healthy and wired correctly? | A route to a failed or misplaced target still breaks traffic | `aws ec2 describe-nat-gateways --nat-gateway-ids nat-0123` |

If the subnet has no explicit route table association, it uses the VPC's main route table. The CLI can show that table with a main association filter:

```bash
aws ec2 describe-route-tables \
  --filters Name=vpc-id,Values=vpc-0123456789abcdef0 Name=association.main,Values=true
```

For a missing public path to an ALB, the team checks that the ALB subnets are associated with route tables containing `0.0.0.0/0 -> igw-...`, that the internet gateway is attached to the VPC, and that the ALB scheme is internet-facing. For a missing private API egress path, the team checks that the private API subnet has `0.0.0.0/0 -> nat-...`, that the NAT gateway is in `available` state, that the NAT gateway sits in a public subnet, and that the NAT public subnet has `0.0.0.0/0 -> igw-...`.

AWS Reachability Analyzer can also model reachability between two resources. It is useful when many layers interact, such as route tables, security groups, NACLs, transit gateways, and peering. The CLI and console route table checks are still the fastest first pass because they show the actual associations and targets.

Flow Logs help later in the investigation, especially when a packet reaches an interface and then gets accepted or rejected by packet filters. The next article covers Flow Logs with security groups and NACLs because those logs are most useful when route paths and firewall decisions need to be compared.

## Common Production Mistakes
<!-- section-summary: Most route table outages come from mismatched associations, misplaced NAT gateways, and routes that point to the wrong target. -->

The first common mistake is creating the right route in the wrong table. A team may add `0.0.0.0/0 -> nat-...` to a private route table, while the private API subnet still has an implicit association with the main route table. The route exists, but the subnet never uses it. Explicit route table associations reduce this class of mistake because every subnet declares its intended table.

The second mistake is routing a private subnet directly to an internet gateway for IPv4 and expecting private resources to get outbound internet access. For IPv4 internet gateway access, the resource needs a public IPv4 address or Elastic IP address, plus the route and packet permissions. Private API tasks normally use a NAT gateway route for outbound IPv4 access.

The third mistake is placing one NAT gateway in one Availability Zone and using it from private subnets in every zone. This can work during normal days, but it adds cross-zone dependency and cost. The stronger standard pattern is one NAT gateway per Availability Zone and private subnet route tables that point to the same-zone NAT gateway.

The fourth mistake is forgetting the public side of the NAT path. A private subnet route to `nat-...` is only half of the IPv4 egress path. The NAT gateway lives in a public subnet, uses an Elastic IP address, and needs that public subnet route table to send internet-bound traffic to the internet gateway.

The fifth mistake is sending high-volume S3 traffic through NAT gateway by default. If private workloads write frequent exports to S3, a gateway VPC endpoint for S3 can keep that traffic on the AWS private path and reduce NAT processing. The route table then contains a more specific S3 prefix list route, and longest-prefix routing sends S3 traffic to the endpoint while other public IPv4 traffic still uses NAT.

The sixth mistake is treating route tables as firewall policy. A missing route prevents traffic from finding a path. An allowed route only proves the packet has a next hop. The next layer is packet permission, which means security groups and NACLs.

## Putting It All Together
<!-- section-summary: The payments VPC uses public routes for the ALB, NAT routes for private API egress, local routes for internal traffic, and narrow routes for private services. -->

Northstar Payments now has a clean route story. Public ALB subnets have a local route for VPC traffic and a default route to the internet gateway for customer HTTPS traffic. Private API subnets have a local route for ALB and database traffic, a default IPv4 route to a same-zone NAT gateway for outbound internet calls, and optional narrower routes to private AWS service endpoints or peer networks. Database subnets keep the smallest useful set of routes, usually local VPC routes and any private administrative or service paths the database genuinely needs.

The route table describes packet direction. The public route lets an internet-facing ALB live in public subnets. The private NAT route lets API tasks start outbound connections without opening inbound internet access. The local route lets VPC resources talk by private address. Longest-prefix matching lets specific private paths override the broad default route.

![Route debug checklist summary board covering source subnet, route association, best match, target state, return route, and packet filter](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/route-debug-checklist.png)

*Route debugging starts from the caller's subnet, then follows the route table association, matching route, target state, return path, and packet controls in that order.*

The next article keeps the same payments app and adds the packet permission layer. The route tables give the packet a path; security groups and NACLs decide which packets may use that path.

**References**

- [Configure route tables - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html)
- [Subnet route tables - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html)
- [Example routing options - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html)
- [Enable internet access for a VPC using an internet gateway - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)
- [NAT gateways - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)
- [NAT gateway basics - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)
- [Enable outbound IPv6 traffic using an egress-only internet gateway - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html)

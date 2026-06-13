---
title: "Public vs Private Subnets"
description: "Understand how AWS classifies public, private, and isolated subnets through route tables, public addresses, NAT, ALBs, IPv6, and placement checks."
overview: "Public and private subnet labels come from routing behavior rather than names. This article follows the payments app as the ALB, API tasks, RDS PostgreSQL, NAT gateways, S3 exports, and operations access land in the right subnet tiers."
tags: ["aws", "vpc", "subnets", "route-tables", "internet-gateway", "nat-gateway", "alb"]
order: 2
id: article-cloud-providers-aws-networking-connectivity-public-private-subnets
aliases:
  - public-vs-private-subnets
  - public-private-subnets
---

## Table of Contents

1. [Why Subnet Type Matters](#why-subnet-type-matters)
2. [Route Tables Decide the Subnet Type](#route-tables-decide-the-subnet-type)
3. [Public IPs Are a Separate Setting](#public-ips-are-a-separate-setting)
4. [Where the Internet-Facing ALB Lives](#where-the-internet-facing-alb-lives)
5. [Private Application Subnets](#private-application-subnets)
6. [Data and Isolated Subnets](#data-and-isolated-subnets)
7. [NAT Placement for Outbound Access](#nat-placement-for-outbound-access)
8. [Multi-AZ Duplication](#multi-az-duplication)
9. [IPv6 Nuance](#ipv6-nuance)
10. [How to Verify Placement](#how-to-verify-placement)
11. [Common Production Mistakes](#common-production-mistakes)
12. [What's Next](#whats-next)

## Why Subnet Type Matters
<!-- section-summary: Public, private, and isolated subnet choices decide which parts of an application can receive internet traffic, initiate outbound traffic, or stay inside the VPC. -->

In the VPC article, we placed the payments app inside one planned network. Customers reach an Application Load Balancer. Private API tasks process requests. RDS PostgreSQL stores payment state. S3 receives exports. Operations engineers need controlled access during incidents.

The next question is placement. Which subnets should those resources use?

A **subnet** is a range of IP addresses inside a VPC, and each subnet lives in one Availability Zone. AWS resources such as load balancers, EC2 instances, container tasks, databases, NAT gateways, and endpoints use subnets as their network placement areas. Subnets also inherit a route table association, and that route table is what gives the subnet its network paths.

The common labels are **public subnet**, **private subnet**, and **isolated subnet**. These labels sound like names, but they describe routing behavior.

For the payments app, the labels lead to practical choices:

| Resource | Typical subnet tier | Reason |
|---|---|---|
| Internet-facing ALB | Public subnets | Customers on the internet need a path to the load balancer |
| API tasks | Private app subnets | The app receives traffic from the ALB and starts outbound calls when needed |
| RDS PostgreSQL | Isolated or tightly private data subnets | The database should receive private app traffic without a general internet path |
| Public NAT gateway | Public subnets | Private workloads use it for outbound IPv4 internet access |
| S3 gateway endpoint | Associated with private route tables | Private workloads can reach S3 through an endpoint route |
| Operations access | Private or dedicated operations subnets | Engineers use a controlled access path rather than direct public exposure |

The rest of the article keeps returning to one rule: a subnet's type comes from its route table first, and public IP addresses are an extra condition for direct internet reachability.

## Route Tables Decide the Subnet Type
<!-- section-summary: A subnet is public when its associated route table has a direct route to an internet gateway, while private and isolated subnets use different route targets or only local routes. -->

A **route table** is a set of routes that maps destination IP ranges to targets. Each subnet has one route table association at a time. If no explicit association exists, the subnet uses the VPC's main route table. A route table can serve multiple subnets, which is why many teams create one route table per tier and associate the intended subnets explicitly.

The target that matters most for public subnet classification is the **internet gateway**. An internet gateway is the VPC component that lets resources communicate with the internet when routing, addressing, and security rules allow it. If a subnet's route table sends internet-bound traffic directly to an internet gateway, AWS documentation describes that subnet as public.

For IPv4, internet-bound traffic is usually represented as `0.0.0.0/0`. For IPv6, it is `::/0`. A public subnet route table commonly looks like this:

| Destination | Target |
|---|---|
| `10.40.0.0/16` | `local` |
| `0.0.0.0/0` | `igw-0123456789abcdef0` |

The `local` route exists in every VPC route table. It allows traffic for the VPC CIDR to use the VPC's internal routing. The internet gateway route gives the subnet a direct path for destinations outside the VPC.

A **private subnet** has no direct route to an internet gateway. It can still have outbound internet access through a **NAT gateway**. A NAT gateway is a managed Network Address Translation service that lets private resources initiate outbound connections while external hosts cannot initiate new inbound connections to those private resources through that NAT path.

An app subnet route table might look like this:

| Destination | Target |
|---|---|
| `10.40.0.0/16` | `local` |
| S3 prefix list | `vpce-0123456789abcdef0` |
| `0.0.0.0/0` | `nat-0123456789abcdef0` |

That subnet is private because its default IPv4 route points to NAT instead of directly to the internet gateway. The S3 prefix list route sends S3 traffic to a gateway endpoint. A **prefix list** is a managed list of IP ranges that AWS can use as a route destination for a service such as S3.

An **isolated subnet** has no route to destinations outside the VPC. A data subnet route table can look like this:

| Destination | Target |
|---|---|
| `10.40.0.0/16` | `local` |

This is a strong starting point for RDS PostgreSQL. The database can receive private traffic from the application subnets through the local VPC route when security groups allow it. The database subnet has no general route to the public internet.

Subnet names and tags should match this routing, while route table associations create the behavior. A subnet named `private-a` with `0.0.0.0/0 -> igw-...` is a public subnet by routing. A subnet named `public-a` with only a local route has isolated routing behavior.

![Subnet type route comparison showing public subnet routes to IGW, private subnet routes to NAT and S3 endpoint, and isolated subnet local-only routing](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/subnet-type-routes.png)

*The label on the subnet is only a hint. The route table decides whether the subnet is public, private, or isolated, and public IP settings decide whether a specific resource can use a public path directly.*

## Public IPs Are a Separate Setting
<!-- section-summary: A public route gives a subnet an internet path, while public IPv4 or IPv6 addressing determines whether a specific resource can use that path directly. -->

Routing is the first half of direct internet reachability. Public addressing is the second half.

A **private IPv4 address** is an address from the VPC or subnet CIDR, such as `10.40.10.25`. Resources in the VPC use private addresses to communicate with each other. A **public IPv4 address** is routable from the internet. AWS can assign a public IPv4 address automatically at launch when the subnet setting allows it, or you can associate an **Elastic IP address**, which is a static public IPv4 address.

For an EC2 instance to communicate directly with the internet over IPv4 through an internet gateway, it needs the subnet route to the internet gateway and a public IPv4 address or Elastic IP address. The security group and network ACL must allow the traffic too. A public route alone gives the subnet a path. The public address gives the resource a return address that works on the public internet.

This distinction explains a lot of confusing beginner cases:

| Case | Result |
|---|---|
| Public subnet route table plus EC2 public IPv4 | Direct internet path can work when security rules allow it |
| Public subnet route table plus EC2 private IPv4 only | The instance has a route path, but no public IPv4 identity for direct IPv4 internet communication |
| Private subnet route table plus EC2 public IPv4 | The public IPv4 address has no direct internet gateway route from that subnet |
| Private subnet route table plus NAT route | The instance can initiate outbound IPv4 through NAT without receiving unsolicited inbound internet connections through NAT |

Default subnets are special because AWS configures them as public subnets and instances launched there receive public IPv4 addresses by default. Custom and nondefault production subnets should set public IP auto-assignment intentionally.

The payments app can use this policy:

| Tier | Public IPv4 auto-assign |
|---|---|
| Public ALB subnets | Usually disabled for ordinary instances; the ALB receives service-managed addresses as needed |
| Private app subnets | Disabled |
| Data subnets | Disabled |
| Endpoint or operations subnets | Disabled unless a reviewed public access pattern requires it |

This keeps accidental public addresses away from application and data resources. The ALB can be internet-facing because the ALB resource is configured that way and placed into public subnets.

## Where the Internet-Facing ALB Lives
<!-- section-summary: An internet-facing Application Load Balancer belongs in public subnets across multiple Availability Zones and forwards requests to private targets. -->

An **Application Load Balancer** is the public front door for many HTTP and HTTPS applications on AWS. It receives client requests, applies listener rules, performs health checks, and sends traffic to registered targets such as EC2 instances, IP addresses, Lambda functions, or container tasks.

For the payments app, the ALB accepts customer HTTPS traffic for `checkout.example.com`. The customer-facing endpoint is the ALB, and the API tasks stay behind it. The ALB therefore lives in public subnets. The API tasks live in private app subnets and register as targets behind the ALB.

AWS requires an Application Load Balancer using Availability Zone subnets to use at least two subnets in different Availability Zones. That matters for both availability and scaling. The ALB creates load balancer nodes in the selected subnets. Each enabled zone should also have healthy targets, so the load balancer has somewhere to send traffic in that zone.

The placement looks like this:

![Public ALB and private API placement showing customer browser traffic reaching an internet-facing ALB in public subnets, then API tasks and RDS staying in private and data subnets across two Availability Zones](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/public-alb-private-api.png)

*The ALB is the public entry point. The API tasks and database stay on private addresses, and the route plus security group design makes the ALB the intentional bridge into the application.*

The ALB subnets need route tables with an internet gateway route. The ALB security group should allow inbound HTTPS from customer source ranges, commonly `0.0.0.0/0` and `::/0` for a public internet service. The API task security group should allow inbound application traffic with the ALB security group as the source.

This is the first real production pattern in the article: public subnet for the public load balancer, private subnet for the application code. The ALB is the public resource. The API tasks are private resources with a controlled inbound path from the ALB.

An **internal ALB** uses private addresses and serves clients inside the VPC or connected networks. Internal ALBs belong in private subnets because their clients are internal systems. The payments app might use an internal ALB later for admin APIs or service-to-service traffic, but the customer checkout entry point uses an internet-facing ALB.

## Private Application Subnets
<!-- section-summary: Private app subnets run workload code that receives traffic from trusted internal paths and starts outbound calls through NAT or endpoints. -->

A **private application subnet** is a subnet for workload code that should receive traffic through controlled private paths. In the payments app, the API tasks receive requests from the ALB. They connect to RDS PostgreSQL. They write exports to S3. They may call external fraud scoring, tax, or payment partner APIs.

The API tasks need inbound traffic from the ALB, private traffic to the database, S3 access, and sometimes outbound internet access. Direct inbound internet reachability would add risk without supporting the request path. That is why the route table points broad outbound IPv4 traffic to NAT rather than to the internet gateway.

A private app route table can include:

| Destination | Target | Purpose |
|---|---|---|
| `10.40.0.0/16` | `local` | Reach RDS, caches, and other private VPC resources |
| S3 prefix list | S3 gateway endpoint | Write exports to S3 through the endpoint route |
| `0.0.0.0/0` | NAT gateway in the same AZ | Reach approved external IPv4 APIs and package repositories |

The security group on the API tasks carries the more specific permission story. It can allow inbound app traffic from the ALB security group on port `8080`, allow outbound PostgreSQL traffic to the database security group on port `5432`, and allow outbound HTTPS where the application needs it. Security groups come in the next networking article, but it helps to keep the layers separate now: route tables create possible paths, and security groups allow or deny workload conversations.

Terraform for route table associations can make the intent visible:

```hcl
resource "aws_route_table" "app_a" {
  vpc_id = aws_vpc.payments.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.a.id
  }

  tags = {
    Name = "payments-app-a"
    Tier = "private-app"
  }
}

resource "aws_route_table_association" "app_a" {
  subnet_id      = aws_subnet.app_a.id
  route_table_id = aws_route_table.app_a.id
}
```

The route table name, subnet tag, and association all say the same thing. That consistency makes code review easier. A reviewer can see that `payments-app-a` has NAT egress and no direct internet gateway route.

## Data and Isolated Subnets
<!-- section-summary: Data subnets keep databases on private addresses and usually avoid broad outbound routes unless the database service has a clear operational need. -->

A **data subnet** is a subnet tier for databases, caches, and other stateful services. The payments app uses RDS PostgreSQL, so the database needs subnets where RDS can place its database network interfaces. Those subnets should be separate from the application subnets so database placement, routes, network ACLs, and tags can be reviewed independently.

An **isolated subnet** has only routes for destinations inside the VPC. In our payments VPC, that can be just the local route:

| Destination | Target |
|---|---|
| `10.40.0.0/16` | `local` |

This route table allows the database to receive private VPC traffic from the API tasks when security groups allow it. It has no default path to the internet, NAT, VPN, or another VPC. That is a strong default for a database tier because PostgreSQL usually needs inbound database connections from the application, backups and maintenance managed by RDS, and monitoring through AWS-managed service integrations. It rarely needs arbitrary outbound internet access from the database subnet.

Some teams use the phrase **private data subnet** for data subnets that have tightly controlled outbound routes. Others reserve **isolated subnet** for data subnets with only local routes. The label matters less than the actual route table. The route table is the source of truth.

The RDS placement checklist can look like this:

| Question | Good answer |
|---|---|
| Which subnets are in the DB subnet group? | Data subnets in at least two AZs |
| Do those subnets auto-assign public IPv4? | No |
| Do those route tables point to an internet gateway? | No |
| Does the database allow public accessibility? | No for the payments database |
| Which security group can reach PostgreSQL? | The API task security group only |

That last setting, public accessibility, is an RDS service setting. It works alongside subnet routing and security groups. The clean production placement is data subnets, private addresses, no direct internet route, and a narrow security group relationship from the application tier.

## NAT Placement for Outbound Access
<!-- section-summary: A public NAT gateway usually sits in a public subnet, while private application subnets route outbound IPv4 traffic to a same-AZ NAT gateway. -->

A **NAT gateway** lets private resources initiate outbound connections while keeping those resources unavailable for unsolicited inbound connections through the NAT path. The most common beginner design uses a **public NAT gateway**. It lives in a public subnet, has an Elastic IP address, and routes to the internet through the VPC's internet gateway.

The private app subnet sends `0.0.0.0/0` to the NAT gateway. The NAT gateway then uses the public subnet's internet gateway route for the outside leg of the connection.

For the payments app, this helps API tasks reach external payment partner APIs, package registries, or certificate endpoints. The API tasks keep private addresses. External services see the NAT gateway's public egress address, which can be useful when partners require allow-listed source IPs.

The high-level NAT layout is:

| Component | Subnet | Route need |
|---|---|---|
| Public NAT gateway A | Public subnet A | Public subnet route table has `0.0.0.0/0 -> internet gateway` |
| Private app subnet A | App subnet A | App route table has `0.0.0.0/0 -> NAT gateway A` |
| Public NAT gateway B | Public subnet B | Public subnet route table has `0.0.0.0/0 -> internet gateway` |
| Private app subnet B | App subnet B | App route table has `0.0.0.0/0 -> NAT gateway B` |

Same-AZ routing is a common resilience habit. AWS NAT gateways are zonal in the traditional public NAT design. If private subnets in multiple AZs all depend on one NAT gateway, an outage in the NAT gateway's AZ can remove outbound access for workloads in other AZs too. Creating one NAT gateway per AZ and routing each private subnet to its local NAT gateway keeps the dependency aligned with the workload's zone.

Cost also matters. NAT gateways have hourly and data processing charges. S3 exports, backups, and large internal transfers can drive a large bill if they all pass through NAT. Gateway endpoints for S3 and DynamoDB can move supported AWS service traffic away from the NAT path. Interface endpoints can help with many other AWS services, though they have their own hourly and data processing costs.

The payments app can use NAT for external APIs and use an S3 gateway endpoint for settlement exports. That keeps the outbound internet path available without making every AWS service call look like generic internet egress.

## Multi-AZ Duplication
<!-- section-summary: Production subnet tiers should be repeated across Availability Zones so public entry, private app capacity, and data placement survive a zone problem. -->

An **Availability Zone** is a separate failure boundary inside a Region. A subnet belongs to exactly one AZ, so a production design repeats each subnet tier across zones.

The payments app can use two AZs at first:

| Tier | AZ A | AZ B |
|---|---|---|
| Public | `payments-public-a` | `payments-public-b` |
| Private app | `payments-app-a` | `payments-app-b` |
| Data | `payments-data-a` | `payments-data-b` |
| Endpoint or operations | `payments-endpoints-a` | `payments-endpoints-b` |

This duplication supports the full request path. The ALB has public subnets in both AZs. API tasks run in private app subnets in both AZs. RDS has a DB subnet group spanning data subnets in both AZs. NAT gateways exist per AZ for private app egress. Interface endpoints, when used, can have endpoint network interfaces in multiple AZs too.

A multi-AZ design also affects reviews. When someone adds a new feature, the review should cover both the subnet tier and the AZ copies of that tier. A single private subnet in one AZ creates an availability dependency that may surprise the team during a zone event or maintenance window.

The same pattern extends to three AZs when the app needs it. Three public subnets, three app subnets, three data subnets, and three endpoint or operations subnets create a wider placement grid. The route table pattern stays the same, just repeated carefully.

## IPv6 Nuance
<!-- section-summary: IPv6 uses separate route table entries, and outbound-only IPv6 usually uses an egress-only internet gateway instead of IPv4 NAT. -->

IPv6 adds one important twist: IPv4 and IPv6 routes are separate. A route for `0.0.0.0/0` covers IPv4 destinations. IPv6 destinations need a separate route such as `::/0`.

An **IPv6 address** is globally unique. In AWS, a resource with an IPv6 address can have public internet reachability when the subnet route table sends `::/0` to an internet gateway and security rules allow the traffic. IPv6 uses a different public addressing model than IPv4 Elastic IPs because IPv6 addresses are already public in nature.

For an internet-facing dual-stack ALB, the public subnets need IPv6 CIDR blocks and route tables that route IPv6 traffic appropriately. The ALB security group and network ACLs also need IPv6 rules. **Dual-stack** means a resource supports both IPv4 and IPv6.

For private workloads that need outbound-only IPv6 internet access, AWS provides an **egress-only internet gateway**. It allows IPv6 outbound communication from resources in the VPC and prevents the internet from initiating IPv6 connections to those resources. The route table entry looks like `::/0 -> eigw-...`.

NAT gateways are mainly discussed in IPv4 designs, and AWS also supports NAT64/DNS64 patterns for IPv6 workloads that need to reach IPv4 destinations. For a beginner production design, the clean review question is simple: IPv4 and IPv6 need separate route entries, and a subnet can be private for IPv4 while accidentally public for IPv6 if the IPv6 route table entries are reviewed separately.

The payments app can start IPv4-only, or it can use dual-stack public ALB subnets when customers need IPv6. If private API tasks receive IPv6 addresses later, the route tables and security groups need the same level of review as the IPv4 side.

## How to Verify Placement
<!-- section-summary: Verification checks route table associations, public IP assignment, ALB subnet mapping, NAT targets, and the ENIs created by managed services. -->

Good subnet placement can be verified with AWS APIs. The console is useful, but repeatable CLI checks make reviews easier and help during incidents.

A first check maps subnets to AZs, CIDRs, public IP auto-assignment, and available IP capacity:

```bash
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" \
  --query "Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch,AvailableIpAddressCount,Tags[?Key=='Name'].Value|[0]]" \
  --output table
```

The next check shows which route table each subnet uses and which targets appear in those route tables:

```bash
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" \
  --query "RouteTables[*].{RouteTable:RouteTableId,Associations:Associations[*].SubnetId,Routes:Routes[*].[DestinationCidrBlock,DestinationIpv6CidrBlock,GatewayId,NatGatewayId,VpcEndpointId]}" \
  --output json
```

For each subnet, the reviewer can classify it from the routes:

| Route table evidence | Classification |
|---|---|
| `0.0.0.0/0 -> igw-...` or `::/0 -> igw-...` | Public for that protocol |
| `0.0.0.0/0 -> nat-...` | Private IPv4 with outbound NAT |
| `::/0 -> eigw-...` | Private IPv6 outbound-only |
| Only VPC local routes | Isolated |

The ALB placement can be checked from Elastic Load Balancing:

```bash
aws elbv2 describe-load-balancers \
  --names payments-public \
  --query "LoadBalancers[*].[LoadBalancerName,Scheme,VpcId,AvailabilityZones[*].SubnetId]" \
  --output table
```

The NAT gateway placement can be checked from EC2:

```bash
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=vpc-0123456789abcdef0" \
  --query "NatGateways[*].[NatGatewayId,SubnetId,ConnectivityType,State,NatGatewayAddresses[*].PublicIp]" \
  --output table
```

Managed-service ENIs show where services actually touch the VPC:

```bash
aws ec2 describe-network-interfaces \
  --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" "Name=requester-managed,Values=true" \
  --query "NetworkInterfaces[*].[NetworkInterfaceId,Description,SubnetId,PrivateIpAddress,InterfaceType]" \
  --output table
```

These checks work best when naming and tagging are consistent. A route table named `payments-app-a` should be associated with `payments-app-a`, point broad IPv4 outbound traffic to the AZ A NAT gateway, and include endpoint routes where expected. A route table named `payments-data-a` should have the data subnet association and no broad internet route.

## Common Production Mistakes
<!-- section-summary: Most subnet mistakes come from trusting names, mixing public IPs with private routes, centralizing NAT poorly, or forgetting IPv6 and endpoint routes. -->

The first mistake is trusting a subnet name. A subnet named `private` can still be public by routing. A subnet named `public` can still have only local routes. Route table associations are the evidence.

The second mistake is placing application tasks in public subnets because the ALB is public. The public resource should be the ALB. The application tasks can stay in private app subnets and accept traffic from the ALB security group. That keeps direct internet reachability away from the application code.

The third mistake is giving private workloads public IPv4 addresses and assuming that makes them reachable or useful. Direct IPv4 internet access needs both a public address and a route table path to the internet gateway. A public IPv4 address in a subnet whose route table points default traffic to NAT or has only local routes still lacks the same direct public path.

The fourth mistake is sending high-volume AWS service traffic through NAT. Payments exports to S3 can use a gateway endpoint route. That path avoids making S3 traffic compete with external API traffic through NAT and can reduce NAT processing charges.

The fifth mistake is using one zonal NAT gateway for every private subnet in every AZ. It may work during normal days, but it creates a zone dependency for outbound access. A same-AZ NAT pattern gives each app subnet an egress path aligned with its own zone.

The sixth mistake is forgetting IPv6. A subnet can have careful IPv4 routes and permissive IPv6 routes. IPv6 needs its own route entries, security group rules, network ACL review, and ALB configuration choices.

The final mistake is allowing the main route table to control production subnets by accident. Explicit route table associations make the design reviewable. The main route table can stay conservative, and every subnet tier can carry its intended routes.

![Subnet placement checks summary board covering route table, public IP, ALB zones, NAT per AZ, endpoint routes, and IPv6 path](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/subnet-placement-checks.png)

*A subnet review should prove behavior from evidence: route table association, public addressing, load balancer zone mapping, same-zone NAT, endpoint routes, and IPv6 routes all need to match the placement story.*

## What's Next

Public and private subnet placement gives the payments app a clean network shape. The ALB has a public path. API tasks run privately. RDS sits in data subnets. NAT and endpoints provide outbound and AWS service paths where needed.

The next layer is routing detail. A public subnet needs an internet gateway route. A private app subnet often needs a NAT gateway or endpoint route. A data subnet usually keeps a much smaller route set. The next article follows those route tables, internet gateway paths, NAT paths, and IPv6 egress choices closely.

---

**References**

- [Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html) - Defines subnet basics, subnet types, Availability Zone scope, IPv4-only, dual-stack, and IPv6-only subnet options.
- [Subnet route tables](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html) - Documents subnet route table associations, local routes, internet gateway routes, IPv6 routes, and route specificity.
- [Configure route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html) - Explains route tables, route targets, and how route tables support public, private, VPN-only, and isolated subnets.
- [Enable internet access for a VPC using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html) - Explains public subnet routing, internet gateway behavior, public addresses, and IPv4 NAT performed by the internet gateway.
- [Default subnets](https://docs.aws.amazon.com/vpc/latest/userguide/default-subnet.html) - Documents default public subnet behavior and public IPv4 assignment defaults.
- [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html) - Defines public and private NAT gateways and outbound-initiated access behavior.
- [NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html) - Documents NAT gateway zonal behavior, same-AZ resilience guidance, and operational characteristics.
- [Example routing options](https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html) - Shows route examples for internet gateways, NAT gateways, gateway endpoints, and egress-only internet gateways.
- [Enable outbound IPv6 traffic using an egress-only internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html) - Explains outbound-only IPv6 routing through an egress-only internet gateway.
- [Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html) - Documents ALB subnet requirements, Availability Zone mapping, and load balancer node behavior.
- [Create an Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-application-load-balancer.html) - Documents internet-facing and internal ALB schemes, network mapping, dual-stack options, and subnet selection.

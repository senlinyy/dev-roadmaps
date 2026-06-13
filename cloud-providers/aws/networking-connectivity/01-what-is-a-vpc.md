---
title: "What Is a VPC?"
description: "Understand Amazon VPC boundaries, regional scope, CIDR planning, subnets, route tables, ENIs, gateways, endpoints, and how a real AWS app fits inside."
overview: "A VPC is the private regional network where AWS resources receive addresses, attach network interfaces, and follow route tables. This article uses a payments app to connect the VPC boundary, CIDR planning, default VPCs, subnets, ENIs, gateways, and endpoints."
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
  - cloud-providers/aws/networking-connectivity/public-and-private-access.md
  - logical-isolation-network-topology
  - cloud-providers/aws/networking-connectivity/logical-isolation-network-topology.md
  - cloud-providers/aws/networking-connectivity/01-logical-isolation-network-topology.md
---

## Table of Contents

1. [What a VPC Gives Your Application](#what-a-vpc-gives-your-application)
2. [The Regional VPC Boundary](#the-regional-vpc-boundary)
3. [CIDR Blocks and Address Planning](#cidr-blocks-and-address-planning)
4. [Default VPCs](#default-vpcs)
5. [Subnets Divide the VPC Into Zonal Areas](#subnets-divide-the-vpc-into-zonal-areas)
6. [Route Tables and the Local Route](#route-tables-and-the-local-route)
7. [ENIs Are Where Resources Touch the VPC](#enis-are-where-resources-touch-the-vpc)
8. [Gateways and Endpoints Create Network Paths](#gateways-and-endpoints-create-network-paths)
9. [A Payments App Inside One VPC](#a-payments-app-inside-one-vpc)
10. [Build Checks Before You Move On](#build-checks-before-you-move-on)
11. [What's Next](#whats-next)

## What a VPC Gives Your Application
<!-- section-summary: A VPC gives AWS resources a private network boundary, a shared address plan, and route tables that describe where traffic can go. -->

When a small application runs on a laptop, the network can stay almost invisible. The web server listens on `localhost`, the database listens on another local port, and every request moves inside one machine. The moment the same application moves into AWS, the pieces spread out. The public entry point may run through a load balancer, the application code may run in containers, the database may run as a managed service, and exports may land in object storage.

For this article, picture a payments application. Customers reach `checkout.example.com`. An **Application Load Balancer**, often shortened to **ALB**, accepts HTTPS requests and spreads them across healthy application workers. An ALB is an AWS-managed load balancer for HTTP and HTTPS traffic. Behind it, private API tasks process payments, talk to **Amazon RDS for PostgreSQL**, and write settlement exports to **Amazon S3**. RDS is AWS's managed relational database service. S3 is AWS object storage for files, reports, backups, images, and exports. Operations engineers also need a controlled way to inspect the system during incidents.

All of those resources need a place to live. In AWS networking, that place is usually an **Amazon Virtual Private Cloud**, or **VPC**. A VPC is a virtual network that you define inside AWS. It gives your resources private IP addresses, divides the network into smaller subnets, and uses route tables to decide which network paths exist.

The word **private** matters here. The VPC gives your AWS resources a private address space that belongs to your account inside one AWS Region. Resources in that address space can talk through private IP addresses when routing and security rules allow it. Other AWS customers have their own separate virtual networks. Other VPCs in your own account stay separate too until you connect them on purpose.

![VPC boundary map showing a production payments VPC inside us-east-1 with public entry, private app, and data lanes plus callouts for private address space, subnets by AZ, and route choices](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/vpc-boundary-map.png)

*A VPC gives the payments app one private regional boundary. Public entry, private application code, and data services sit inside that boundary, while subnets and route tables turn the boundary into usable network paths.*

The first useful way to think about a VPC is as the application's network container. The payments app has one container for the production network. Inside it, the public ALB, private API tasks, database, endpoints, and operational access paths all fit into one planned shape instead of landing wherever defaults happen to place them.

## The Regional VPC Boundary
<!-- section-summary: A VPC belongs to one AWS Region, spans the Availability Zones in that Region, and stays separate from other VPCs until you connect it. -->

An **AWS Region** is a geographic area such as `us-east-1`, `eu-west-2`, or `ap-southeast-2`. Each Region contains multiple **Availability Zones**, usually shortened to **AZs**. An Availability Zone is a separate datacenter area inside a Region with its own power, networking, and failure boundary. AWS designs AZs so applications can run across more than one of them for resilience.

A VPC lives in one Region. The VPC boundary covers the Region, and then you create subnets inside individual Availability Zones. That split is important. The payments VPC might live in `us-east-1`, and inside that VPC you can create subnets in `us-east-1a` and `us-east-1b`. The VPC gives the whole application one regional private network. The subnets give the application specific zonal placement areas.

This regional boundary also sets the first design question. A production payments system usually gets its own VPC in its production AWS account. Development and staging can have their own VPCs, often in separate accounts. That separation keeps route tables, security groups, database subnets, and operational access paths easier to review. It also reduces the chance that a development experiment changes a production network path.

A VPC has no automatic private connection to another VPC, another Region, a corporate office, or a developer laptop. Those paths require explicit networking features such as VPC peering, Transit Gateway, Site-to-Site VPN, Direct Connect, or Client VPN. Those features come later in the networking roadmap. At this point, the main idea is simpler: the VPC is the first boundary for the application's private AWS network.

The payments app will use one production VPC:

| Layer | Example resource | Placement idea |
|---|---|---|
| Public entry | Internet-facing ALB | Public subnets in at least two AZs |
| Private application | API containers or EC2 workers | Private application subnets in the same AZs |
| Data | RDS PostgreSQL | Data subnets with no direct internet route |
| AWS service access | S3 exports | VPC endpoint path where useful |
| Operations | Admin access through managed tooling or VPN | Controlled private access path |

Before any of those placements can exist, the VPC needs an address range.

## CIDR Blocks and Address Planning
<!-- section-summary: A CIDR block is the private IP range for the VPC, and good planning leaves room for subnets, growth, and future network connections. -->

A **CIDR block** is a compact way to write a range of IP addresses. CIDR stands for Classless Inter-Domain Routing. In a VPC, a CIDR such as `10.40.0.0/16` means AWS can allocate private IP addresses from `10.40.0.0` through `10.40.255.255` inside that VPC. The number after the slash describes the size of the range. A smaller slash number gives a larger range. A larger slash number gives a smaller range.

AWS allows IPv4 VPC CIDR blocks from `/16` through `/28`. A `/16` contains 65,536 total IPv4 addresses. A `/28` contains only 16 total IPv4 addresses. For a production application, a `/16` or a well-planned larger private range gives you room to divide the network into many subnets without repainting the network later.

The payments VPC can use `10.40.0.0/16`. That range sits inside the private `10.0.0.0/8` space and leaves room for public, application, data, endpoint, and future subnets. Another environment can use a different range such as `10.41.0.0/16` for staging and `10.42.0.0/16` for development.

Non-overlap is the quiet part that saves a lot of future pain. If the production VPC uses `10.40.0.0/16`, a corporate office, a developer VPN, and a future analytics VPC should avoid using the same range. Overlapping private IP ranges make direct routing hard because the same address could point at two different networks.

A simple starting layout for the payments VPC could look like this:

| Purpose | AZ A CIDR | AZ B CIDR | Notes |
|---|---:|---:|---|
| Public entry | `10.40.0.0/24` | `10.40.1.0/24` | ALB nodes and public NAT gateways can live here |
| Private app | `10.40.10.0/24` | `10.40.11.0/24` | API tasks, workers, and private service targets live here |
| Data | `10.40.20.0/24` | `10.40.21.0/24` | RDS subnet group and data services live here |
| Endpoints and operations | `10.40.30.0/24` | `10.40.31.0/24` | Interface endpoints, admin tooling, or future shared services can live here |

Each `/24` has 256 total IPv4 addresses, and AWS reserves five addresses in every subnet CIDR. That leaves 251 usable private IPv4 addresses per subnet. That is usually comfortable for a beginner production design, but managed services can consume addresses faster than expected. Load balancer nodes, NAT gateways, RDS interfaces, interface endpoints, EC2 instances, and container tasks all need IP addresses. Tiny subnets often fail during scaling or maintenance because the subnet runs out of free addresses.

Here is a minimal Terraform sketch for the VPC and two subnets. Terraform is an infrastructure-as-code tool that creates cloud resources from configuration files. The important part is the shape more than the exact names:

```hcl
resource "aws_vpc" "payments" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "payments-prod"
  }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.payments.id
  availability_zone       = "us-east-1a"
  cidr_block              = "10.40.0.0/24"
  map_public_ip_on_launch = false

  tags = {
    Name = "payments-public-a"
    Tier = "public"
  }
}

resource "aws_subnet" "app_a" {
  vpc_id            = aws_vpc.payments.id
  availability_zone = "us-east-1a"
  cidr_block        = "10.40.10.0/24"

  tags = {
    Name = "payments-app-a"
    Tier = "private-app"
  }
}
```

The `map_public_ip_on_launch` setting deserves attention later. It controls whether new network interfaces launched into the subnet automatically receive public IPv4 addresses. The subnet name and tag help humans, but routing and address settings decide behavior.

Now that the custom VPC has an address plan, it helps to compare it with the VPC AWS gives many accounts automatically.

## Default VPCs
<!-- section-summary: A default VPC helps people launch resources quickly, while a production app usually needs a deliberately designed VPC and explicit subnet tiers. -->

A **default VPC** is the VPC AWS creates in many accounts for each Region. It comes with a default subnet in each Availability Zone, an internet gateway, DNS settings, and a main route table that sends internet-bound traffic to that internet gateway. In practical terms, it lets someone launch an EC2 instance quickly and reach it from the internet when the instance has a public address and the security rules allow access.

That convenience is useful while learning. A default VPC reduces the number of decisions on day one. A beginner can launch a simple instance, connect over SSH, and see something work. AWS services such as Elastic Load Balancing and RDS can also use the default VPC if you choose it.

Production networking needs more deliberate choices. The payments app needs public entry points, private application workers, data subnets, and private paths to AWS services. A default VPC starts with public subnets, so the tier design is still your job. Teams can modify it, though many prefer creating a nondefault production VPC so the route tables, subnet names, CIDR ranges, and tags tell one clear story from the beginning.

This is where many early AWS mistakes happen. Someone launches a database, accepts the first available VPC and subnet, and later discovers that the subnet is part of the default public shape. The database may still have other protections, such as security groups and service-level public access settings, but the network placement already started in the wrong place. A production payments database should land in data subnets chosen for that job.

The default VPC is a learning and quick-start tool. The custom payments VPC is the intentional production network.

## Subnets Divide the VPC Into Zonal Areas
<!-- section-summary: A subnet is a CIDR slice inside one Availability Zone, and it is the placement unit for resources such as load balancers, tasks, databases, and endpoints. -->

A **subnet** is a smaller IP range inside a VPC. Each subnet lives entirely in one Availability Zone. When you place an AWS resource into a subnet, you choose both an address pool and a zonal location.

That one-AZ rule matters for resilience. If the payments app needs to keep accepting traffic during an AZ problem, it needs duplicate subnet tiers in at least two AZs. The ALB should have a public subnet in AZ A and a public subnet in AZ B. The API tasks should have private app subnets in both AZs. RDS should have data subnets in more than one AZ through a DB subnet group, which is the RDS way of knowing which subnets it can use for database network interfaces.

Subnets are often described as public, private, or isolated. Those words come from routing, which the next article covers deeply. At this level, the labels are placement intentions:

| Subnet label | Plain meaning | Payments app example |
|---|---|---|
| Public | Resources here can have a direct route toward the internet when the route table and addresses allow it | Internet-facing ALB nodes and public NAT gateways |
| Private app | Resources here handle internal application work and use controlled outbound paths | Payment API tasks and background workers |
| Data | Resources here hold databases and sensitive state | RDS PostgreSQL and cache nodes |
| Endpoint or operations | Resources here provide private access to AWS services or operational tooling | Interface endpoints, internal tooling, or admin access targets |

The important beginner move is to create one subnet per tier per AZ. Two AZs and three tiers means six subnets. Three AZs and three tiers means nine subnets. The repetition may look boring, but that consistency makes reviews, diagrams, and incident work much easier.

Here is the two-AZ shape for the payments app:

![Two-AZ AWS subnet layout showing public subnets, private app subnets, data subnets, an ALB, API tasks, RDS, and an S3 endpoint](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/two-az-subnet-layout.png)

*The boring repetition is the point. Each Availability Zone gets the same tier shape, so the ALB, API tasks, database interfaces, and service endpoint paths can survive normal zonal maintenance and failure scenarios.*

This diagram shows relationships while the detailed route and firewall rules stay in their own layer. The route table says whether a network path exists. Security groups and network ACLs decide whether packets may use the path. That separation helps when troubleshooting: placement, routing, and packet permission are three different layers.

Subnets give the resources a place to sit. Route tables give those subnets paths.

## Route Tables and the Local Route
<!-- section-summary: Route tables map destination IP ranges to network targets, and every VPC route table starts with a local route for the VPC CIDR. -->

A **route table** is a set of rules that tells subnet traffic where to go based on destination IP address. Each route has a **destination**, such as `10.40.0.0/16` or `0.0.0.0/0`, and a **target**, such as `local`, an internet gateway, a NAT gateway, a VPC endpoint, or another network connector.

Every subnet is associated with one route table at a time. A route table can serve more than one subnet. If you create a subnet and skip an explicit association, AWS uses the VPC's main route table for that subnet. Production designs usually create custom route tables for each tier so the route intent is obvious.

Every VPC route table includes a **local route** for the VPC CIDR. In the payments VPC, that route looks like this:

| Destination | Target | Meaning |
|---|---|---|
| `10.40.0.0/16` | `local` | Traffic to private addresses inside this VPC can stay inside the VPC routing system |

The local route is why an API task in `10.40.10.0/24` has a route path to an RDS interface in `10.40.20.0/24`. The addresses sit inside the same VPC CIDR, so the route table has a local target for that destination. Security groups still matter. A route can provide a path while a firewall rule denies the packet.

Default routes describe where traffic goes when no more-specific route matches. In IPv4, `0.0.0.0/0` means all IPv4 destinations. In IPv6, `::/0` means all IPv6 destinations. Public subnets usually point `0.0.0.0/0` to an internet gateway. Private app subnets often point `0.0.0.0/0` to a NAT gateway for outbound IPv4. Data subnets often omit a default internet route.

For the payments app, the route table summary can start like this:

| Subnet tier | Route table entries |
|---|---|
| Public | `10.40.0.0/16 -> local`, `0.0.0.0/0 -> internet gateway` |
| Private app | `10.40.0.0/16 -> local`, `0.0.0.0/0 -> NAT gateway`, S3 prefix list -> VPC endpoint |
| Data | `10.40.0.0/16 -> local` |

AWS uses the most specific matching route. A route to an S3 prefix list is more specific than `0.0.0.0/0`, so S3 traffic can use the endpoint route while other external IPv4 traffic uses NAT. This is a common way to keep high-volume S3 traffic away from NAT gateway processing.

At this point, the VPC has a boundary, addresses, subnets, and route tables. The next question is how resources actually attach to that network.

## ENIs Are Where Resources Touch the VPC
<!-- section-summary: An elastic network interface is the virtual network card that gives an AWS resource private addresses, security groups, and a place in a subnet. -->

An **elastic network interface**, usually shortened to **ENI**, is a virtual network card in a VPC. It has a subnet, private IP addresses, security groups, and other network attributes. EC2 instances use ENIs. Many AWS managed services also create network interfaces in your VPC so they can communicate through your private network.

This is one of the most helpful details for beginners. A VPC is the network. A subnet is a zonal address slice. An ENI is the point where a resource touches that subnet.

When an API task, EC2 instance, or managed service needs network access, AWS places or uses a network interface. That network interface receives a private IP from the subnet. It can have security groups attached. Depending on the resource and configuration, it may also have a public IPv4 address or an Elastic IP address. An **Elastic IP address** is a static public IPv4 address from AWS that can be associated with certain resources.

The payments app has ENIs all over the place:

| Resource | ENI role |
|---|---|
| API task or EC2 worker | The application receives a private IP in the private app subnet |
| RDS PostgreSQL | The database exposes private addresses through database network interfaces in data subnets |
| ALB | The load balancer creates nodes and network interfaces in the selected public subnets |
| NAT gateway | The NAT gateway creates a managed network interface in its subnet |
| Interface VPC endpoint | The endpoint creates private network interfaces that services can reach inside the VPC |

ENIs also explain why subnet sizing matters. A service can scale by adding more network interfaces or more IPs. An ALB needs room in its selected subnets for load balancer nodes. ECS tasks using the `awsvpc` network mode each receive an ENI or branch network attachment pattern depending on the platform. Interface endpoints create ENIs. RDS creates and manages network interfaces for database access. A subnet that looked large on day one can run out of addresses after load balancers, endpoints, tasks, and database maintenance all need room.

When you debug placement, ENIs provide evidence. A command like this can show which network interfaces exist in a VPC and which subnets they use:

```bash
aws ec2 describe-network-interfaces \
  --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" \
  --query "NetworkInterfaces[*].[NetworkInterfaceId,Description,SubnetId,PrivateIpAddress,RequesterManaged]" \
  --output table
```

The `RequesterManaged` value helps identify interfaces created by AWS services on your behalf. The description often tells you whether the interface belongs to a load balancer, NAT gateway, VPC endpoint, database, or another service.

Once resources can attach to the VPC, the final high-level piece is how traffic leaves the VPC boundary or reaches AWS services privately.

## Gateways and Endpoints Create Network Paths
<!-- section-summary: Gateways connect a VPC to other networks, while VPC endpoints give private paths to supported AWS services. -->

A **gateway** is a managed network target that connects your VPC to another network path. The two beginner gateways in a VPC discussion are the **internet gateway** and the **NAT gateway**.

An **internet gateway** allows communication between a VPC and the internet when routing, public addressing, and security rules allow it. The payments app uses an internet gateway for the public ALB path. The ALB sits in public subnets, those public subnets have a default route to the internet gateway, and customers reach the ALB through DNS.

A **NAT gateway** provides outbound-initiated access for private resources. NAT stands for Network Address Translation. A private API task can call a third-party payment risk API through a NAT gateway, and the response can return to the task. The third-party service lacks a direct inbound path to that private task through the NAT gateway. In the common public NAT gateway pattern, the NAT gateway lives in a public subnet, has an Elastic IP address, and reaches the internet through the internet gateway.

A **VPC endpoint** lets resources in your VPC reach supported AWS services through a private AWS path instead of treating the traffic like general internet traffic. There are two common endpoint shapes. A **gateway endpoint** is a route table target for services such as S3 and DynamoDB. An **interface endpoint** creates private network interfaces in your subnets for services that use AWS PrivateLink.

For the payments app, S3 exports are a great place to use a gateway endpoint. The API tasks write reconciliation files to an S3 bucket. Without an S3 endpoint, that traffic may follow the private subnet's default route through a NAT gateway. With a gateway endpoint route, S3 traffic uses the endpoint path. That often improves the design and avoids NAT gateway processing for S3 traffic.

Here is the route idea:

| Destination | Target | Why it exists |
|---|---|---|
| `10.40.0.0/16` | `local` | Private VPC-to-VPC-address traffic |
| S3 prefix list | S3 gateway endpoint | Private path for S3 exports |
| `0.0.0.0/0` | NAT gateway | Other outbound IPv4 traffic from private app subnets |

Gateways and endpoints are only paths. Identity permissions, bucket policies, database authentication, and security groups still remain in the design. A private route to S3 still needs IAM permissions and an S3 bucket policy that allows the intended access. A route from the ALB to the API task still needs security group rules that allow the load balancer to reach the application port.

Now all the parts can be placed together.

## A Payments App Inside One VPC
<!-- section-summary: A production VPC design places public entry, private application code, data services, endpoints, and operations access into separate subnet tiers. -->

The payments app starts with one production VPC in one Region:

| Decision | Chosen value |
|---|---|
| Region | `us-east-1` |
| VPC CIDR | `10.40.0.0/16` |
| AZs | `us-east-1a`, `us-east-1b` |
| Public subnets | `10.40.0.0/24`, `10.40.1.0/24` |
| Private app subnets | `10.40.10.0/24`, `10.40.11.0/24` |
| Data subnets | `10.40.20.0/24`, `10.40.21.0/24` |
| Endpoint or operations subnets | `10.40.30.0/24`, `10.40.31.0/24` |

The customer request path is straightforward. A browser resolves `checkout.example.com` to the internet-facing ALB. The ALB has nodes in the public subnets. The ALB forwards HTTPS traffic to healthy API tasks in the private app subnets. The API tasks connect to RDS PostgreSQL through private addresses in the data subnets. The API tasks write exports to S3 through a VPC endpoint route.

The operations path needs the same care. Engineers should use controlled access such as AWS Systems Manager Session Manager, a VPN path, a bastion design with tight rules, or another approved private operations pattern. AWS Systems Manager is a service that can manage and connect to instances without directly exposing SSH to the internet when the required agent, permissions, and network paths exist. The exact operations pattern can vary by company, but it should fit into the VPC plan rather than appearing as a random public instance during an incident.

The design now has clear boundaries:

| Boundary | What it protects |
|---|---|
| VPC | The production payments network stays separate from other networks |
| CIDR plan | Every resource receives private addresses from a planned range |
| Subnet tier | Public entry, private app, data, and operations paths are placed separately |
| Route table | Each tier has only the network paths it needs |
| ENI | Every resource's actual VPC attachment can be inspected |
| Gateway or endpoint | Internet and AWS service paths are explicit |

This is the core of VPC work. A VPC gives the application a network boundary and routing structure. The next layers add packet filtering, private connectivity, service policies, logging, and incident visibility.

## Build Checks Before You Move On
<!-- section-summary: Good VPC reviews check address ranges, subnet room, route-table intent, service ENIs, and whether every external path is deliberate. -->

A useful production review asks concrete questions. These questions work well before a first deployment and during later architecture reviews.

**CIDR checks**

- Does the VPC CIDR avoid overlap with staging, development, VPN, office, and planned analytics networks?
- Does the VPC have enough unused address space for future subnet tiers?
- Are subnets large enough for load balancer nodes, container tasks, endpoints, RDS maintenance, and scaling events?

**Subnet checks**

- Does each tier exist in at least two Availability Zones?
- Do names and tags match the actual routing behavior?
- Are data services placed in data subnets rather than whichever subnet appeared first in the console?

**Route checks**

- Does each subnet have an explicit route table association?
- Does every route table contain the expected local route?
- Do public subnet route tables point internet-bound traffic to the internet gateway?
- Do private app subnet route tables use NAT or endpoints only where the app needs those paths?
- Do data subnet route tables avoid broad outbound routes unless the service has a documented reason?

**ENI checks**

- Which service-created network interfaces exist in the VPC?
- Are load balancer, RDS, endpoint, and NAT gateway interfaces in the expected subnets?
- Do subnets still have spare IP capacity after managed services create their interfaces?

The AWS CLI can help with those checks. The following command shows the VPC CIDR and whether DNS settings are enabled:

```bash
aws ec2 describe-vpcs \
  --vpc-ids vpc-0123456789abcdef0 \
  --query "Vpcs[*].[VpcId,CidrBlock,InstanceTenancy,IsDefault]" \
  --output table
```

This command shows subnet CIDRs, AZs, public IP auto-assignment, and available IPv4 address counts:

```bash
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" \
  --query "Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch,AvailableIpAddressCount,Tags[?Key=='Name'].Value|[0]]" \
  --output table
```

This command shows route table associations and routes:

```bash
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" \
  --query "RouteTables[*].{RouteTable:RouteTableId,Associations:Associations[*].SubnetId,Routes:Routes[*].[DestinationCidrBlock,DestinationIpv6CidrBlock,GatewayId,NatGatewayId,VpcEndpointId]}" \
  --output json
```

Common production mistakes usually come from mismatched assumptions. A subnet named `private` may still have a route table pointing to an internet gateway. A database may sit in the right subnet but use a security group that allows too much. A private app may send heavy S3 traffic through NAT because nobody added the S3 gateway endpoint route. A subnet may look roomy until interface endpoints and load balancer nodes consume the remaining IPs.

Write down the caller, destination, route table, gateway or endpoint, and security group for every important path. That record turns the VPC from a set of console objects into a design the team can review.

![VPC build checks summary board covering CIDR room, subnet tiers, route intent, ENI ownership, external paths, and growth plan](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/vpc-build-checks.png)

*Use this as the first VPC review board: leave address room, repeat subnet tiers, make routes explicit, know which services create ENIs, document every external path, and reserve space for growth.*

## What's Next

You now have the big VPC pieces: a regional boundary, a CIDR range, subnets, route tables, ENIs, gateways, and endpoints. The next article zooms into one detail that causes a lot of beginner confusion: public and private subnets.

The route table, public addressing behavior, and selected AWS resource decide whether a subnet is public or private. Those details give the payments app's ALB, private API tasks, RDS database, NAT gateway, and S3 export path a clear placement plan.

---

**References**

- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html) - Defines Amazon VPC, subnets, routing, gateways, endpoints, and the default VPC starting point.
- [How Amazon VPC works](https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html) - Explains VPCs, subnets, default VPCs, route tables, internet access, NAT, and IPv6 routing at a high level.
- [VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html) - Documents IPv4 VPC CIDR sizing, private range guidance, overlap considerations, and secondary CIDR behavior.
- [Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html) - Documents subnet sizing and the AWS-reserved IP addresses in every subnet.
- [Default VPCs](https://docs.aws.amazon.com/vpc/latest/userguide/default-vpc.html) - Describes default VPC components and quick-start behavior.
- [Default subnets](https://docs.aws.amazon.com/vpc/latest/userguide/default-subnet.html) - Explains why default subnets are public and how public IPv4 assignment works for default subnets.
- [Subnet route tables](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html) - Documents subnet route table associations, local routes, default routes, IPv6 routes, and route specificity.
- [Enable internet access for a VPC using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html) - Explains internet gateway behavior and public subnet routing.
- [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html) - Defines NAT gateways and their role in outbound-initiated private subnet access.
- [Elastic network interfaces](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-eni.html) - Defines network interfaces, their attributes, and how they attach resources to VPC subnets.
- [Example routing options](https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html) - Shows route table examples for internet gateways, NAT gateways, and gateway VPC endpoints.

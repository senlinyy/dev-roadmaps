---
title: "Transit Gateway and Multi-VPC Networking"
description: "Connect many AWS VPCs and accounts with VPC peering, AWS Transit Gateway, shared services, segmentation, inspection paths, and operational guardrails."
overview: "Multi-VPC networking is the work of connecting separate application, shared services, analytics, security, and on-premises networks without turning every private network into one flat space. This article explains when VPC peering is enough, why Transit Gateway is used as a regional router, and how attachments, route tables, association, propagation, return routes, inspection VPCs, and cross-account sharing fit together."
tags: ["aws", "vpc", "transit-gateway", "vpc-peering", "multi-vpc-networking"]
order: 7
id: article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking
aliases:
  - connectivity-and-hybrid-networking
  - dns-domains-and-tls-entry-points
  - turn-a-domain-into-a-secure-aws-entry-point
  - load-balancers-and-target-health
  - make-the-front-door-trust-healthy-targets
  - article-cloud-providers-aws-networking-connectivity-dns-domains-tls-entry-points
  - article-cloud-providers-aws-networking-connectivity-load-balancers-target-health
  - cloud-providers/aws/networking-connectivity/dns-domains-and-tls-entry-points.md
  - cloud-providers/aws/networking-connectivity/load-balancers-and-target-health.md
  - vpc-connectivity
  - transit-gateway-and-multi-vpc-networking
  - cloud-providers/aws/networking-connectivity/connectivity-and-hybrid-networking.md
  - cloud-providers/aws/networking-connectivity/03-connectivity-and-hybrid-networking.md
---

## Table of Contents

1. [The Production Network We Are Building](#the-production-network-we-are-building)
2. [When VPC Peering Is Enough](#when-vpc-peering-is-enough)
3. [Why Many VPCs Need a Hub](#why-many-vpcs-need-a-hub)
4. [Transit Gateway as a Regional Router](#transit-gateway-as-a-regional-router)
5. [Attachments and Attachment Subnets](#attachments-and-attachment-subnets)
6. [Transit Gateway Route Tables](#transit-gateway-route-tables)
7. [Association and Propagation](#association-and-propagation)
8. [A Practical Segmentation Design](#a-practical-segmentation-design)
9. [Shared Services and Inspection VPCs](#shared-services-and-inspection-vpcs)
10. [Cross-Account Sharing with AWS RAM](#cross-account-sharing-with-aws-ram)
11. [Small Terraform and CLI Examples](#small-terraform-and-cli-examples)
12. [Operational Guardrails and Common Mistakes](#operational-guardrails-and-common-mistakes)
13. [Putting It All Together](#putting-it-all-together)
14. [References](#references)

## The Production Network We Are Building
<!-- section-summary: Multi-VPC networking starts with separate networks for separate responsibilities, then adds deliberate private paths between the few systems that need to talk. -->

Imagine a company that runs a customer-facing application on AWS. The main application lives in an **app VPC** in a production account. A separate **shared services VPC** holds internal tools such as deployment runners, directory connectors, log forwarders, and package mirrors. An **analytics VPC** receives exported events and batch data. A **security VPC** contains inspection appliances and central monitoring tools. A few support systems still live in an office network and a small datacenter, so AWS also needs a path to **on-premises** networks.

A **VPC**, or Virtual Private Cloud, is a private network boundary inside AWS. It has its own IP address range, subnets, route tables, and packet controls. In small AWS accounts, one VPC can hold most of the application. In a growing production environment, teams usually split networks by responsibility, account ownership, blast radius, compliance boundary, and operational lifecycle.

That split helps the organization. The analytics team can change data pipelines without touching application subnets. The security team can operate inspection tooling in its own account. The platform team can run shared services once instead of copying the same tooling into every application account. The network stays understandable because each VPC has a job.

The split also creates a new problem. A private application in the app VPC may need to call a license server in the shared services VPC. The analytics VPC may need to receive traffic from the app VPC while production database routes stay out of the analytics route table. Security appliances may need to inspect traffic on the way to on-premises systems. The datacenter may need to reach only a narrow set of application endpoints.

**Multi-VPC networking** is the design work for those private paths. It answers a few plain questions before any AWS service is chosen:

| Question | Why it matters |
| --- | --- |
| Which VPC starts the connection? | The source VPC route table and source security group must allow the first packet. |
| Which VPC or network receives it? | The destination CIDR must have one clear owner. |
| Which route carries the packet forward? | The source subnet needs a route to the next hop. |
| Which route carries the reply back? | The destination side needs a return route to the source. |
| Which systems may talk through the path? | Segmentation keeps development, production, analytics, security, and on-premises paths separate. |
| Which logs prove what happened? | Operations teams need route-table evidence and packet evidence during incidents. |

This article uses one steady scenario: separate app, shared services, analytics, and security VPCs across accounts, plus on-premises support systems. We will start with **VPC peering**, because it is the smallest useful private VPC-to-VPC relationship. Then we will move into **AWS Transit Gateway**, because many VPCs need a hub with routing policy rather than a pile of one-off relationships.

## When VPC Peering Is Enough
<!-- section-summary: VPC peering fits one direct private relationship between two non-overlapping VPCs when both teams can own the routes and packet controls clearly. -->

**VPC peering** is a direct private networking relationship between two VPCs. Instances and other resources in either VPC can route traffic to private IPv4 or IPv6 addresses in the other VPC, as long as both VPCs have non-overlapping CIDR ranges and the route tables allow the traffic.

A **CIDR range** is the block of IP addresses assigned to a network, such as `10.20.0.0/16` or `10.40.0.0/16`. When two VPCs use overlapping ranges, a destination IP can point to two possible places. AWS blocks peering between VPCs with matching or overlapping IPv4 or IPv6 CIDR blocks because routing needs one clear answer for each destination.

Peering is a good fit for a narrow relationship. Suppose the app VPC needs to call an inventory API in a shared services VPC. The app VPC uses `10.20.0.0/16`. The shared services VPC uses `10.40.0.0/16`. The teams agree that only the app workers will call `inventory.internal.example.com` on TCP port `443`. In that case, a peering connection can stay small and readable.

![One peering relationship infographic showing an app VPC and shared services VPC connected through VPC peering with forward and return routes and no transitive routing](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/one-peering-relationship.png)

*Peering works well when one VPC needs one direct private relationship with another VPC. Both sides still need non-overlapping CIDRs, forward routes, return routes, packet controls, and DNS agreement.*

The practical work has four parts.

First, the VPC owners create and accept the peering connection. The VPCs can be in the same account, different accounts, the same Region, or different Regions. Inter-Region peering still uses private IP addresses and AWS's network, which helps teams avoid public internet paths for VPC-to-VPC traffic.

Second, both sides update route tables. The app private subnet route table needs a route for `10.40.0.0/16` that targets the peering connection. The shared services subnet route table needs a route for `10.20.0.0/16` that targets the same peering connection. The return route matters as much as the forward route. A missing return route often looks like a timeout because the first packet reaches the destination and the reply has nowhere useful to go.

Third, both sides check packet controls. **Security groups** are stateful firewall rules attached to network interfaces. **Network ACLs**, often shortened to NACLs, are stateless subnet-level packet filters. The source security group needs egress to the destination port. The destination security group needs ingress from the right source CIDR or trusted security group reference where supported. NACLs need both directions because they are stateless.

Fourth, the teams agree on DNS. Peering connects networks, but private hosted zones and custom DNS behavior need their own design. If the app resolves `inventory.internal.example.com` to a private IP in the shared services VPC, the app's DNS path must return that private address consistently.

Peering has a few high-level limits that matter in production.

| Limit | Practical meaning |
| --- | --- |
| **One-to-one relationship** | Each peering connection links two VPCs. More VPC pairs mean more connections to track. |
| **No transitive routing** | If VPC A peers with VPC B, and VPC B peers with VPC C, VPC A still needs its own path to reach VPC C. |
| **No overlapping CIDRs** | AWS blocks peering between matching or overlapping address ranges. Address planning matters before teams create VPCs. |
| **No shared edge shortcut** | A peered VPC needs its own internet, NAT, VPN, Direct Connect, or gateway endpoint path. |
| **Route tables on both sides** | Peering never removes the need for explicit forward and return routes. |

For two VPCs with one clear relationship, peering can be clean. For many VPCs across many accounts, peering starts to create a route-management problem.

## Why Many VPCs Need a Hub
<!-- section-summary: Many VPCs create too many pairwise peering relationships, so teams usually move shared routing policy into a central hub. -->

Now the company adds more teams. Production has app, payments, analytics, shared services, and security VPCs. Development and staging have their own VPCs. A networking account owns hybrid connectivity to the datacenter. A compliance requirement says production workloads can reach shared services and the security inspection path, while development reaches shared services without production database routes.

With peering, every relationship needs its own connection and its own routes on both sides. Four VPCs can have six possible pairs. Ten VPCs can have forty-five possible pairs. The number grows quickly because every new VPC may need relationships with several existing VPCs.

The operational pain shows up in ordinary changes. A shared services VPC gets a new CIDR block. Every peered VPC route table that should reach the new range needs an update. A production VPC should stop reaching analytics directly. The team has to find and remove routes and security rules in several places. A new account launches with the same `10.20.0.0/16` range as an old VPC. The peering request fails and the team has to re-address one side or build a translation design outside the simple peering model.

A hub changes that shape. Instead of drawing every VPC-to-VPC pair, each VPC attaches to a central routing service. The central service holds route tables that decide which attachments may reach which other attachments.

![Transit Gateway hub infographic showing app VPC, shared services, analytics, security, and on-premises networks attached to one Transit Gateway with route tables holding policy](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/transit-gateway-hub.png)

*Transit Gateway changes the shape from many pairwise links to one regional hub. The hub still needs route tables with clear policy, such as production, shared services, and inspection paths.*

The hub still needs careful design, and the design now has one regional place to live. The platform team can name route tables by intent, such as `prod`, `shared`, `analytics-ingress`, and `inspection`. Account teams can attach their VPCs to the hub. Network engineers can review route propagation and static routes in one regional service instead of hunting through a mesh of peering connections.

AWS provides that hub through **AWS Transit Gateway**.

## Transit Gateway as a Regional Router
<!-- section-summary: AWS Transit Gateway is a regional layer-3 router that moves packets between VPC, VPN, Direct Connect, peering, and other attachments by using destination IP routes. -->

**AWS Transit Gateway**, often shortened to **TGW**, is a managed regional network transit hub. A transit gateway acts like a regional layer-3 router for traffic between attached networks. **Layer 3** means IP routing: the transit gateway looks at the destination IP address and sends the packet toward a next-hop attachment.

The word **regional** matters. A transit gateway lives in one AWS Region. It can route between VPCs in that Region, VPN attachments, Direct Connect gateway attachments, and other supported attachment types. Transit gateways can also peer with transit gateways in other Regions, but each regional routing domain still needs deliberate route tables and static routes for peering attachments.

An **attachment** is the connection between a network resource and the transit gateway. Common attachment types include VPC attachments, Site-to-Site VPN attachments, Direct Connect gateway attachments, Transit Gateway Connect attachments for SD-WAN-style appliances, and transit gateway peering attachments. In our production scenario, the first attachments are the app VPC, shared services VPC, analytics VPC, security VPC, and the hybrid connection for on-premises support systems.

The transit gateway owns its own route tables. These are separate from subnet route tables inside each VPC. A VPC subnet route table sends traffic to the transit gateway. Then the transit gateway route table decides which attachment receives that traffic next.

That two-stage routing is worth slowing down for.

| Stage | Route table | Example |
| --- | --- | --- |
| VPC subnet routing | The route table associated with the source subnet | `10.40.0.0/16 -> tgw-0123456789abcdef0` |
| Transit Gateway routing | The TGW route table associated with the source attachment | `10.40.0.0/16 -> shared-services-vpc-attachment` |
| Destination VPC return routing | The route table associated with the destination subnet | `10.20.0.0/16 -> tgw-0123456789abcdef0` |

The packet needs all three pieces for a complete private conversation. The source subnet must send it to TGW. TGW must send it to the right attachment. The destination subnet must send replies back to TGW when the source lives outside the destination VPC.

Transit Gateway needs router-level design. A team can attach a VPC and still have no working traffic if the VPC route table, TGW route table, association, propagation, security groups, NACLs, or return routes are wrong.

## Attachments and Attachment Subnets
<!-- section-summary: A VPC attachment uses selected subnets in selected Availability Zones, and those attachment subnets act as the entry and exit points for TGW traffic in that VPC. -->

A **VPC attachment** connects one VPC to a transit gateway. During attachment creation, the team selects one subnet per Availability Zone that should participate in the attachment. AWS places a transit gateway network interface in each selected subnet. Those selected subnets are often called **attachment subnets** or **TGW subnets**.

An **Availability Zone**, or AZ, is an isolated location inside a Region. Production VPCs usually run workloads across multiple AZs so one AZ issue leaves the other AZs available. Transit Gateway follows that idea. A VPC attachment should usually enable multiple AZs, often the same AZs where the workloads run.

The attachment subnet choice has practical consequences. Resources in an AZ can reach the transit gateway when the VPC attachment has a subnet enabled in that AZ. AWS documentation also points out that traffic is only forwarded to the transit gateway if the transit gateway has an attachment in the subnet of the same AZ. That means the attachment subnets are a data-path choice.

Many teams create small dedicated subnets for TGW attachments, such as:

| Subnet name | CIDR example | Purpose |
| --- | --- | --- |
| `prod-app-tgw-a` | `10.20.250.0/28` | TGW attachment in AZ A |
| `prod-app-tgw-b` | `10.20.250.16/28` | TGW attachment in AZ B |
| `prod-app-tgw-c` | `10.20.250.32/28` | TGW attachment in AZ C |

Dedicated attachment subnets help operations. The route tables for those subnets can focus on paths that TGW needs. Monitoring can identify traffic moving through the attachment ENIs. Security reviews can separate workload subnets from network transit subnets.

There is one beginner-friendly routing detail that saves a lot of debugging time. The workload subnet route table and the attachment subnet route table both matter. If the app worker subnet sends `10.40.0.0/16` to TGW, the packet can leave the app subnet. The attachment subnet route table still needs routes for destinations inside the local VPC that must be reachable from TGW. The destination workload subnet also needs return routes for sources outside its VPC.

For a simple app-to-shared-services flow, the VPC-side routes may look like this:

| VPC | Subnet route table | Destination | Target |
| --- | --- | --- | --- |
| App VPC | App worker private subnets | `10.40.0.0/16` | Transit Gateway |
| App VPC | TGW attachment subnets | `10.20.0.0/16` | `local` |
| Shared services VPC | Inventory API private subnets | `10.20.0.0/16` | Transit Gateway |
| Shared services VPC | TGW attachment subnets | `10.40.0.0/16` | `local` |

The exact route tables vary by VPC layout, but the principle stays steady: the VPC must route traffic to TGW for external CIDRs, and the return side must know how to reach the original source.

Overlapping CIDRs still cause trouble with Transit Gateway. A transit gateway has no clean normal route between VPC attachments that use identical or overlapping CIDRs. AWS documentation notes that if a newly attached VPC has a CIDR that matches or overlaps a VPC already attached to the transit gateway, AWS skips propagation for the newly attached VPC routes. Address planning remains one of the most important network guardrails.

## Transit Gateway Route Tables
<!-- section-summary: Transit Gateway route tables decide which attachment receives traffic after a packet reaches the hub. -->

A **Transit Gateway route table** contains routes inside the transit gateway. Each route has a destination CIDR and a target attachment. When a packet arrives from an attachment, TGW checks the route table associated with that source attachment and chooses the next attachment based on the destination IP address.

This route table is separate from VPC route tables. A VPC route table answers, "How does this subnet send traffic out of the VPC?" A TGW route table answers, "After the traffic reaches the hub, which attachment should receive it?"

A first simple route table might look like this:

| Destination | Target attachment | Route type |
| --- | --- | --- |
| `10.20.0.0/16` | App VPC attachment | Propagated |
| `10.40.0.0/16` | Shared services VPC attachment | Propagated |
| `10.60.0.0/16` | Analytics VPC attachment | Propagated |
| `172.16.0.0/16` | VPN or Direct Connect attachment | Propagated |

**Propagated** means the attachment advertised its CIDR or learned routes into the TGW route table. For a VPC attachment, the VPC CIDR blocks can be propagated. For VPN or Direct Connect gateway attachments, routes learned through BGP can be propagated. **BGP**, or Border Gateway Protocol, is a routing protocol commonly used between networks to exchange reachable prefixes.

**Static routes** are routes that the team adds directly. Static routes are useful for special paths, TGW peering attachments, default routes toward inspection, and blackhole routes. A **blackhole route** intentionally drops traffic for a destination. Teams sometimes use blackhole routes to prevent a broader propagated route from accidentally opening a path.

The most important design choice is usually the number of TGW route tables. A single default route table is easy during a lab. Production networks often need multiple route tables to create segmentation.

| TGW route table | Associated attachments | Propagated or static routes |
| --- | --- | --- |
| `prod-rt` | App VPC, payments VPC | Routes to shared services, inspection, approved on-premises ranges |
| `shared-rt` | Shared services VPC | Routes back to production and development callers that may use shared services |
| `analytics-rt` | Analytics VPC | Narrow routes for approved data ingest paths |
| `security-rt` | Inspection VPC | Routes to inspected networks and return paths |
| `hybrid-rt` | VPN or Direct Connect attachment | Routes back to approved AWS VPC CIDRs |

Each route table defines the destinations that a source attachment can reach. Production may reach shared services and inspection. Development may reach shared services. Analytics may receive data from production but have fewer routes back. Hybrid connectivity may see only the AWS CIDRs approved for support systems.

## Association and Propagation
<!-- section-summary: Association chooses the route table used by incoming traffic from an attachment, while propagation installs that attachment's routes into one or more route tables. -->

Two TGW words show up constantly: **association** and **propagation**. They sound similar at first, but they do different jobs.

**Association** chooses the TGW route table used when traffic arrives from an attachment. Each attachment is associated with exactly one TGW route table. If the app VPC attachment is associated with `prod-rt`, then packets arriving from the app VPC use `prod-rt` to choose their next hop.

**Propagation** installs routes from an attachment into one or more TGW route tables. A VPC attachment can propagate its VPC CIDR into route tables. A VPN or Direct Connect gateway attachment can propagate learned on-premises routes into route tables. One attachment can propagate to multiple route tables.

Here is a concrete example from our scenario:

| Attachment | Associated route table | Propagates into | Meaning |
| --- | --- | --- | --- |
| App VPC attachment | `prod-rt` | `shared-rt`, `security-rt`, `hybrid-rt` | Traffic from app uses production rules; other tables can learn how to return to app. |
| Shared services attachment | `shared-rt` | `prod-rt`, `dev-rt` | Shared services can reply to production and development callers. |
| Analytics attachment | `analytics-rt` | `prod-rt` only where data ingest is allowed | Production can send approved data to analytics. |
| Security inspection attachment | `security-rt` | `prod-rt`, `hybrid-rt` | Inspection paths can carry traffic between approved sides. |
| On-premises attachment | `hybrid-rt` | `prod-rt`, `security-rt` | Approved on-premises prefixes can appear where support access is allowed. |

A common beginner confusion is expecting propagation to grant connectivity by itself. Propagation only adds routes to a table. The source attachment still has to be associated with the table that contains the route. The source VPC subnet still needs a route to TGW. The destination VPC still needs a return route. Packet filters still need to allow the connection.

The cleanest review question is: "For this source attachment, which TGW route table is used, and does that table contain the destination route?" After that, the next question is: "Can the destination side return to the source?" These two questions catch many outages before teams start changing unrelated security groups.

## A Practical Segmentation Design
<!-- section-summary: Segmentation uses separate TGW route tables so application, shared services, analytics, security, and hybrid networks receive only the routes they need. -->

**Segmentation** means separating networks so a path exists only where the business needs it. In AWS, segmentation can happen through accounts, VPCs, subnets, route tables, security groups, NACLs, endpoint policies, IAM, and inspection tools. Transit Gateway route tables add regional routing segmentation between attached networks.

The production scenario has these requirements:

| Requirement | Routing intent |
| --- | --- |
| App VPC can call shared services | App VPC route table includes shared services CIDR through TGW, and `prod-rt` has a route to shared services. |
| Shared services can reply to app | Shared services subnet route table includes app CIDR through TGW, and `shared-rt` has a route to app. |
| App VPC can send data to analytics | `prod-rt` has an analytics route only for approved analytics CIDRs. |
| Analytics receives no broad path into app | `analytics-rt` has narrow or no routes back except what the approved flow needs. |
| On-premises support can reach selected production endpoints | Hybrid routes appear only in route tables for approved production support paths. |
| Internet egress inspection goes through security VPC | Default or selected routes point to the inspection attachment, and return routes preserve symmetry. |

Route tables can express that intent. For example:

| Source attachment | Associated TGW table | Routes in that table |
| --- | --- | --- |
| App VPC | `prod-rt` | Shared services CIDR, analytics ingest CIDR, inspection VPC, selected on-premises support CIDRs |
| Shared services VPC | `shared-rt` | App VPC CIDR, development VPC CIDRs, security tooling CIDR |
| Analytics VPC | `analytics-rt` | Shared services CIDR, no broad production route |
| Security VPC | `security-rt` | App VPC CIDR, shared services CIDR, selected on-premises CIDRs, default egress path if used |
| VPN or Direct Connect | `hybrid-rt` | Approved app and shared services CIDRs, often through inspection |

This table is only an example. The useful pattern is naming route tables by access intent, then reviewing every propagation against that intent. A route table named `prod-rt` should make reviewers ask, "Which destinations may production initiate connections to?" A table named `analytics-rt` should make reviewers ask, "Which routes let analytics initiate traffic?" Good names help reviewers find the exact route table that allowed or blocked a connection during change approval and incidents.

Segmentation also needs security groups and NACLs. TGW route tables can make a path possible, while application-port decisions stay with packet controls and service policy. The app security group might allow outbound HTTPS to the shared services CIDR. The inventory API security group might allow inbound TCP `443` from the app worker security group or app CIDR. Network ACLs need inbound and outbound rules for the same flow and ephemeral reply ports if they are locked down.

Production designs usually document traffic in pairs:

| Flow | Routing | Packet control |
| --- | --- | --- |
| App workers to shared inventory API | App subnets route shared CIDR to TGW; `prod-rt` routes shared CIDR to shared attachment; shared return route points app CIDR to TGW | App egress TCP `443`; inventory ingress TCP `443`; NACLs allow both directions |
| App data export to analytics ingest | App subnets route analytics ingest CIDR to TGW; `prod-rt` routes analytics CIDR to analytics attachment; analytics return route points app CIDR to TGW | Analytics ingress accepts only the ingest endpoint port from app CIDR |
| On-premises support to production admin endpoint | Hybrid attachment and production attachment route through approved tables, often through inspection | Security groups allow support CIDR to admin endpoint port only |

This level of detail gives operations teams the evidence they need during incidents. The next article uses Flow Logs and Reachability Analyzer to troubleshoot exactly these paths.

## Shared Services and Inspection VPCs
<!-- section-summary: Shared services centralize common internal tools, while inspection VPCs add network appliances that require careful symmetric routing. -->

A **shared services VPC** hosts tools used by several application VPCs. Common examples include internal package mirrors, deployment runners, centralized directory connectors, monitoring collectors, DNS forwarders, license servers, and private APIs owned by the platform team. The main reason for a shared services VPC is operational reuse. Teams can operate one hardened service instead of copying the same system into every account.

Routing to shared services should stay narrow. If the app VPC only needs the inventory API and a log collector, the route and security rules should reflect those targets. TGW route tables help keep the shared services VPC from turning into a backdoor between development, staging, production, analytics, and on-premises networks because each attached VPC can use a route table that contains only approved shared service prefixes.

An **inspection VPC** hosts network security appliances or firewall services that inspect traffic between networks. Inspection may apply to traffic from VPCs to on-premises networks, egress traffic toward the internet, or traffic between sensitive VPCs. The inspection VPC often contains AWS Network Firewall, Gateway Load Balancer endpoints, third-party appliances, or centralized logging sensors.

Inspection has one major routing rule: stateful appliances need **symmetric routing**. Symmetric routing means the request and the response pass through the same inspection path. A stateful firewall sees the first packet, remembers the session, and expects to see the return traffic. If the request goes through the firewall and the reply bypasses it, the firewall state no longer matches the traffic. The result can look like random timeouts or one-way connectivity.

Transit Gateway has an **appliance mode** option for VPC attachments that host stateful inspection appliances. Appliance mode helps keep traffic for a flow on the same appliance path across Availability Zones. It matters when an inspection VPC sits between attachments and the design depends on stateful devices.

A simple inspected hybrid path can look like this:

![Inspected hybrid path infographic showing app VPC traffic going through a production route table, Transit Gateway, inspection VPC, hybrid route table, and on-premises network with symmetric return routing](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/inspected-hybrid-path.png)

*Inspection paths need symmetry. The request and response should pass through the same inspection design so stateful appliances see the full conversation instead of one direction only.*

The VPC subnet route tables and TGW route tables both need to support the inspected path. The app subnet may route on-premises CIDRs to TGW. The `prod-rt` TGW table may route those CIDRs to the inspection attachment rather than directly to the VPN or Direct Connect attachment. The inspection VPC route tables may send clean traffic back to TGW toward the hybrid attachment. The hybrid side must return through the inspection path as well.

This is where diagrams and route tables should match. A diagram that says "all on-premises traffic is inspected" and a TGW route table that sends on-premises CIDRs directly to the VPN attachment are telling two different stories. The route table story wins at runtime.

## Cross-Account Sharing with AWS RAM
<!-- section-summary: AWS Resource Access Manager lets a central networking account share a transit gateway so other accounts can create VPC attachments. -->

Production AWS environments often use multiple accounts. The networking team may own a central network account. Application teams may own workload accounts. Security may own the inspection account. That account split helps with permissions and billing, but the network still needs one regional hub.

**AWS Resource Access Manager**, usually called **AWS RAM**, lets one account share supported AWS resources with other accounts or with an organization in AWS Organizations. For Transit Gateway, the central networking account can share the transit gateway with application accounts. After the share is accepted or automatically available through AWS Organizations, the workload account can create a VPC attachment to the shared transit gateway.

At a high level, the workflow looks like this:

1. The network account creates the transit gateway.
2. The network account creates a RAM resource share for the transit gateway.
3. The share is made available to selected AWS accounts, organizational units, or the whole organization.
4. The workload account creates a VPC attachment from its VPC to the shared transit gateway.
5. The network account accepts the attachment when manual acceptance is required.
6. The network team associates the attachment with the right TGW route table and enables the intended propagations.

This split gives each team a clear job. The network account owns the hub and route-table policy. The workload account owns the VPC, subnets, workload route tables, and application security groups. Both sides need change coordination because a working path crosses both ownership boundaries.

Cross-account sharing also needs naming discipline. Attachment names should include the account, environment, VPC purpose, and Region. Tags should carry owner, cost center, environment, data classification, and support contact. During an incident, `tgw-attach-0abc123` carries little useful context. A name like `prod-app-123456789012-us-east-1` gives responders a fighting chance.

## Small Terraform and CLI Examples
<!-- section-summary: Small examples show the moving parts: a TGW, VPC attachment, subnet route, TGW route table association, and propagation. -->

The exact infrastructure code depends on account layout, modules, and naming standards. The examples here are intentionally small so the moving parts are visible.

This Terraform sketch creates a transit gateway, a route table, a VPC attachment, an association, a propagation, and a VPC subnet route toward a shared services CIDR.

```hcl
resource "aws_ec2_transit_gateway" "core" {
  description = "regional-core-network"

  default_route_table_association = "disable"
  default_route_table_propagation = "disable"

  tags = {
    Name = "core-us-east-1"
  }
}

resource "aws_ec2_transit_gateway_route_table" "prod" {
  transit_gateway_id = aws_ec2_transit_gateway.core.id

  tags = {
    Name = "prod-rt"
  }
}

resource "aws_ec2_transit_gateway_vpc_attachment" "app" {
  transit_gateway_id = aws_ec2_transit_gateway.core.id
  vpc_id             = aws_vpc.app.id
  subnet_ids         = [aws_subnet.app_tgw_a.id, aws_subnet.app_tgw_b.id]

  tags = {
    Name = "prod-app-vpc"
  }
}

resource "aws_ec2_transit_gateway_route_table_association" "app_uses_prod" {
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.app.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.prod.id
}

resource "aws_ec2_transit_gateway_route_table_propagation" "app_to_shared" {
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.app.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.shared.id
}

resource "aws_route" "app_private_to_shared_services" {
  route_table_id         = aws_route_table.app_private.id
  destination_cidr_block = "10.40.0.0/16"
  transit_gateway_id     = aws_ec2_transit_gateway.core.id
}
```

The key point in the Terraform is the default route table settings. Many teams disable default association and propagation on production transit gateways, then create explicit associations and propagations. That makes accidental broad routing less likely because every attachment needs an intentional route-table decision.

For a quick CLI inspection during operations, teams often look at the route table attached to a source attachment:

```bash
aws ec2 describe-transit-gateway-attachments \
  --filters Name=resource-id,Values=vpc-0app1234567890abc

aws ec2 get-transit-gateway-route-table-associations \
  --transit-gateway-route-table-id tgw-rtb-0123456789abcdef0

aws ec2 search-transit-gateway-routes \
  --transit-gateway-route-table-id tgw-rtb-0123456789abcdef0 \
  --filters Name=route-search.exact-match,Values=10.40.0.0/16
```

The first command helps identify the attachment. The second shows which attachments are associated with a TGW route table. The third checks whether the destination route exists in the table being reviewed. During an outage, this is usually faster than opening every VPC route table first.

## Operational Guardrails and Common Mistakes
<!-- section-summary: Stable multi-VPC networks depend on address planning, explicit routing, return paths, segmentation reviews, attachment subnet design, and evidence. -->

Most Transit Gateway incidents come from ordinary routing mistakes. The service is powerful, and that power makes small configuration choices matter.

**Overlapping CIDRs** are the hardest mistake to fix late. If two VPCs both use `10.20.0.0/16`, TGW has no safe normal route between them as VPC attachments. The better guardrail is an address plan before accounts create VPCs. Many organizations reserve CIDR ranges by environment, Region, and account type. For example, production application VPCs may use `10.20.0.0/14`, shared services may use `10.40.0.0/16`, analytics may use `10.60.0.0/16`, and hybrid ranges may sit outside those blocks.

**Missing return routes** create silent failures. A request from app to shared services needs a source route, a TGW route, and a destination return route. People often check only the source side because the caller is where the error appears. The destination route table must still know how to send replies back to the source CIDR.

**Default TGW route table surprises** happen when every new attachment automatically associates with and propagates into the default route table. That can accidentally connect networks that should stay separate. Production teams commonly disable default association and propagation, then attach each VPC to an intentionally named route table.

**Attachment subnets in too few AZs** reduce availability and create confusing AZ behavior. A VPC attachment should usually include one dedicated attachment subnet in each AZ where workloads need TGW access. Small `/28` subnets are common because the attachment needs only a few IP addresses.

**Inspection asymmetry** breaks stateful appliances. If outbound traffic goes through an inspection VPC and return traffic takes a direct TGW route, the firewall may drop the reply. Inspection designs need route symmetry and appliance mode consideration when stateful devices sit in the path.

**Shared services routes that are too broad** weaken segmentation. A route to the whole shared services VPC may be fine for platform-managed tools, but many environments prefer smaller destination ranges or service-specific controls when possible. Security groups, endpoint policies, service authentication, and logging still matter after routing is in place.

**Treating TGW as an identity or firewall control** causes overconfidence. Transit Gateway route tables decide IP reachability between attachments. Application authorization, IAM, security groups, NACLs, TLS, payload inspection, and logging still have their own jobs.

**No evidence plan** slows incidents. A production design should include VPC Flow Logs on important workload and attachment paths, Reachability Analyzer paths for critical connections, and documented route-table ownership. The next article focuses on exactly that troubleshooting workflow.

## Putting It All Together
<!-- section-summary: A production multi-VPC design works when each path has a clear source, destination, route-table decision, return route, packet control, and owner. -->

Here is the full story for the company we followed.

The app VPC runs customer-facing workloads. The shared services VPC hosts internal tools. The analytics VPC receives approved data. The security VPC handles inspection and monitoring. On-premises support systems reach a small set of AWS endpoints. VPC peering can handle a single direct relationship, but the growing environment uses AWS Transit Gateway as the regional hub.

Each VPC attaches to the transit gateway through dedicated attachment subnets in multiple AZs. Each attachment associates with exactly one TGW route table. Each attachment propagates only into the route tables that need to know how to return traffic to that VPC. Production route tables contain routes to shared services, analytics ingest, inspection, and selected hybrid prefixes. Analytics receives no broad production routes. Hybrid routing is limited to approved support paths. Inspection paths preserve symmetry for stateful appliances.

The design stays practical because every connection can be described in plain terms:

| Flow | Source route | TGW decision | Return route | Controls |
| --- | --- | --- | --- | --- |
| App to shared inventory API | App private subnet sends shared CIDR to TGW | `prod-rt` sends shared CIDR to shared attachment | Shared subnet sends app CIDR to TGW | Security groups allow TCP `443`; NACLs allow both directions |
| App to analytics ingest | App private subnet sends analytics CIDR to TGW | `prod-rt` sends analytics CIDR to analytics attachment | Analytics route returns only for approved flow | Analytics endpoint allows narrow source and port |
| On-premises support to admin endpoint | Hybrid router advertises support CIDR | `hybrid-rt` and inspection route tables choose approved path | App routes support CIDR back through TGW | Inspection, security groups, IAM, and logs support the access policy |

That is the habit to keep. A private route is useful only when the route, return path, packet controls, and ownership are all visible. Transit Gateway gives the regional hub. Good network design gives the hub boundaries.

![Multi-VPC routing checklist summary board covering unique CIDRs, source route, Transit Gateway table, return route, segmented paths, and evidence owner](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/multi-vpc-routing-checklist.png)

*Use this as the multi-VPC review board: unique CIDRs, source route, TGW route table, return route, segmented path, and evidence owner all need to line up before the private path is trustworthy.*

**References**

- [What is VPC peering? - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/peering/what-is-vpc-peering.html)
- [How VPC peering connections work - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html)
- [What is AWS Transit Gateway for Amazon VPC? - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html)
- [How AWS Transit Gateway works - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html)
- [Transit gateways in AWS Transit Gateway - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-transit-gateways.html)
- [Amazon VPC attachments in AWS Transit Gateway - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html)
- [Transit gateway route tables in AWS Transit Gateway - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-route-tables.html)
- [Work with AWS Transit Gateway - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/tgw/working-with-transit-gateways.html)

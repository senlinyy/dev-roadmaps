---
title: "What Is a VPC?"
description: "Build a first-principles model of VPC boundaries, CIDR ranges, subnets, interfaces, routes, gateways, security rules, and connections to other networks."
overview: "A VPC is a logically isolated IP network inside a cloud provider. This article starts with two computers and derives the addresses, subnets, routes, interfaces, gateways, and security decisions that make cloud connectivity work."
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

1. [Why Does Cloud Computing Need VPCs?](#why-does-cloud-computing-need-vpcs)
2. [How Does a VPC Create a Network Boundary?](#how-does-a-vpc-create-a-network-boundary)
3. [How Do Resources Attach to the VPC?](#how-do-resources-attach-to-the-vpc)
4. [How Do Routes Move Packets?](#how-do-routes-move-packets)
5. [Why Does a Route Not Guarantee Connectivity?](#why-does-a-route-not-guarantee-connectivity)
6. [How Does a Small Application Fit Inside a VPC?](#how-does-a-small-application-fit-inside-a-vpc)
7. [Which Mental Model Makes VPCs Easier to Debug?](#which-mental-model-makes-vpcs-easier-to-debug)
8. [What Does a VPC Not Mean?](#what-does-a-vpc-not-mean)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A **Virtual Private Cloud**, or VPC, is a logically isolated network that you create inside a cloud provider's infrastructure. That short definition contains several ideas—addresses, boundaries, packet forwarding, security, and virtualization—that are easier to understand when built one at a time.

Start with two computers before adding any cloud terminology:

```text
Computer A                    Computer B
10.0.0.10                     10.0.0.20
```

If they are connected to the same network, A can create a packet whose source is `10.0.0.10` and whose destination is `10.0.0.20`. The network forwards that packet toward B.

Even this tiny example needs three things:

1. **Addresses** identify the source and destination.
2. A **network boundary** establishes which machines belong to the networking context.
3. A **forwarding mechanism** moves packets toward their destinations.

Those same ideas become the foundation of a VPC.

Keep these questions in view as you work through the lesson:

1. **Why Does Cloud Computing Need VPCs?**
2. **How Does a VPC Create a Network Boundary?**
3. **How Do Resources Attach to the VPC?**
4. **How Do Routes Move Packets?**
5. **Why Does a Route Not Guarantee Connectivity?**
6. **How Does a Small Application Fit Inside a VPC?**
7. **Which Mental Model Makes VPCs Easier to Debug?**
8. **What Does a VPC Not Mean?**

## Why Does Cloud Computing Need VPCs?
<!-- section-summary: VPCs let cloud customers build separate logical IP networks on shared provider infrastructure. -->

Now imagine a cloud provider operating millions of machines for many customers. Without isolation, one giant network might contain Customer A's servers and databases beside Customer B's systems and the cloud provider's internal infrastructure. Customer A must not automatically be able to reach Customer B's database merely because both use the same physical cloud.

The provider therefore creates separate logical networking contexts:

```text
Cloud provider infrastructure
├── Customer A VPC
│   ├── server
│   └── database
└── Customer B VPC
    ├── server
    └── database
```

The provider still owns the underlying routers, switches, fibre, servers, and data centres. The VPC gives each customer the behaviour of a private IP network on top of that shared infrastructure.

This is why **virtual** matters. A VPC is not a physical router or a box reserved in a data centre. Software-defined networking creates the isolation and forwarding behaviour. You control the network abstraction without operating the physical network that implements it.

In the simplest terms:

> A VPC is your logically isolated IP networking environment inside the cloud.

It does not automatically connect every resource or make every design secure. It gives you a domain in which you can deliberately choose addresses, subnets, routes, gateways, security relationships, and connections to other networks.

## How Does a VPC Create a Network Boundary?
<!-- section-summary: A VPC gives IP addresses meaning inside one logical context, so isolated VPCs can reuse the same private ranges. -->

Suppose you create this network:

```text
VPC A: 10.0.0.0/16
```

Another customer creates:

```text
VPC B: 10.0.0.0/16
```

Both can contain a network interface with the address `10.0.1.10`. There is no conflict while the VPCs remain separate because each address is interpreted inside a different logical networking context. This is similar to two companies both using `192.168.1.10` on their independent office networks.

```text
VPC A                       VPC B
10.0.0.0/16                 10.0.0.0/16

10.0.1.10                    10.0.1.10
```

An IP address is not a complete global identity by itself. It has meaning relative to the network in which it exists. The VPC supplies that context.

That separation continues until you deliberately add a connection. You should not assume that two VPCs can communicate just because your company owns both of them. Their routes and connection mechanisms must create a valid path, and their security controls must permit the traffic.

![The VPC boundary view shows the private address space, subnets, route tables, gateways, endpoints, and external paths around one app](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/vpc-boundary-map.png)

*A VPC boundary creates a private networking context; routes and explicit connection mechanisms decide which outside networks become reachable.*

The boundary is logical, not a claim that your workloads sit behind a single physical wall. The cloud's distributed networking system maintains isolation between virtual networks even when their workloads share the provider's larger physical estate.

### How Do CIDR Blocks and Subnets Organize Addresses?
<!-- section-summary: The VPC CIDR defines the address space, and subnets divide that space for organization, routing, and availability. -->

One of the first VPC decisions is its IP address range. A common example is:

```text
10.0.0.0/16
```

This notation is a **CIDR block**. CIDR stands for Classless Inter-Domain Routing. For this lesson, treat the block as a compact way to say, "Addresses in this range belong to the VPC."

A `/16` IPv4 block runs mathematically from `10.0.0.0` through `10.0.255.255`. The prefix length leaves 16 of the 32 IPv4 bits available for addresses:

```text
2^(32 - 16) = 65,536 IPv4 addresses
```

Cloud providers reserve some addresses for networking infrastructure, so the mathematical total is not necessarily the number available to workloads. The first-principles point is that the VPC CIDR defines the network's address space.

Putting every resource into one flat `/16` would make a growing network difficult to organize and control. A **subnet** divides the VPC range into smaller, non-overlapping ranges. For example:

```text
VPC: 10.0.0.0/16

Subnet A: 10.0.1.0/24
Subnet B: 10.0.2.0/24
Subnet C: 10.0.3.0/24
```

Each `/24` has 256 mathematical IPv4 addresses. The hierarchy is:

```text
Cloud
  └── VPC
      ├── subnet
      ├── subnet
      └── subnet
```

The VPC is the entire private network. A subnet is one section of its address space.

Subnets serve several purposes. They can organize addresses by workload role:

```text
10.0.1.0/24 → web tier
10.0.2.0/24 → application tier
10.0.3.0/24 → database tier
```

They can follow different routes. A web subnet may have an internet path, while a database subnet does not. Cloud providers also commonly associate subnets with particular availability locations, which lets an application place resources across independent infrastructure.

![The two-AZ layout makes public, private app, and database subnet placement visible without jumping straight into every routing detail](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/two-az-subnet-layout.png)

*Dividing the VPC range into workload and availability sections makes placement and routing intent visible.*

Subnet names such as `public`, `private`, or `database` help humans, but the name does not create network behaviour. The subnet's routes and the attached resource's configuration determine which paths exist.

## How Do Resources Attach to the VPC?
<!-- section-summary: Resources connect through virtual network interfaces, and the interface normally owns the resource's IP address. -->

The VPC itself does not run an application. Compute instances, databases, load balancers, container nodes, and other resources attach to it.

They attach through a **network interface**, the virtual equivalent of a physical Ethernet adapter. In AWS, you will often see the term **elastic network interface**, or ENI.

```text
Virtual machine
  └── network interface
      └── private IP address: 10.0.1.17
          └── subnet
              └── VPC
```

The IP address normally belongs to the interface, not to the abstract VPC and not necessarily to the application process. This distinction is useful for a resource with more than one interface or address, or when a managed service creates interfaces on your behalf.

The interface is the concrete attachment point between a resource and the network. Its subnet determines which address range supplies its private address. Network security controls may also attach to the interface. Packets sent by the resource enter the VPC through that attachment.

Keeping resource and network separate avoids a common misconception: a VPC is not a virtual machine. It is the network environment to which virtual machines and other networked resources connect.

## How Do Routes Move Packets?
<!-- section-summary: Addresses identify endpoints, while route tables choose the next path for packets based on destination ranges. -->

Suppose Server A is `10.0.1.10` and Server B is `10.0.2.20`. A creates a packet with B as the destination. The network needs to decide where to forward it.

A **route table** expresses destination-to-target decisions:

```text
Destination       Target
10.0.0.0/16       local
0.0.0.0/0         internet gateway
```

The local route means that a destination inside `10.0.0.0/16` remains inside the VPC. The packet for `10.0.2.20` matches that range and travels through the VPC's internal networking toward the destination interface.

This gives an essential distinction:

> Addresses describe where endpoints are. Routes describe how packets should reach them.

When the destination lies outside the VPC, another route may match. A packet for `8.8.8.8` does not match the local `10.0.0.0/16` range. The route `0.0.0.0/0` can serve as the default for IPv4 destinations not covered by a more specific entry.

```text
Server 10.0.1.10
  └── destination 8.8.8.8
      └── route-table match 0.0.0.0/0
          └── next target: internet gateway
```

A route is a direction, not a permission. It says which next path should receive a matching packet. Security controls separately decide whether the traffic is allowed, and a valid connection still needs a reachable and listening destination.

### How Does a VPC Reach the Internet?
<!-- section-summary: Internet gateways and NAT create different outside paths, and public or private behaviour comes from the complete configuration rather than an address label. -->

A VPC is not automatically the internet. To exchange traffic with the public internet, the networking design needs a connection mechanism such as an **internet gateway** plus the correct route, addressing, and security configuration.

```text
Resource
  ↓
matching route
  ↓
internet gateway
  ↓
internet
```

Attaching the gateway alone does not make every resource reachable. Useful connectivity normally requires several conditions to line up:

```text
address
+ route
+ gateway or other valid path
+ security permission
= connectivity, if the destination also responds
```

This is why the terms **public subnet** and **private subnet** can mislead beginners. A subnet is not public because its range contains special-looking numbers. `10.0.1.0/24` might participate in a public or private design depending on its routes and the resources placed inside it.

A public-subnet route table commonly includes:

```text
10.0.0.0/16 → local
0.0.0.0/0   → internet gateway
```

A private subnet may include only local routes, or it may send default IPv4 traffic through a **NAT gateway**:

```text
10.0.0.0/16 → local
0.0.0.0/0   → NAT gateway
```

**Network Address Translation**, or NAT, supports a useful asymmetry. An application server can start an outbound connection to download packages or call a public API without needing to accept arbitrary new inbound internet connections directly.

```text
Private application server
10.0.2.15
      ↓ starts connection
NAT gateway
      ↓
Internet gateway
      ↓
Internet service

Response follows the established translation back.
```

NAT does not mean the private server has become a public endpoint. The server initiates the flow; the translation mechanism lets responses return. Inbound publication requires a different deliberate design.

The important definition is therefore behavioural: public and private describe connectivity paths, not merely names or private IP ranges.

## Why Does a Route Not Guarantee Connectivity?
<!-- section-summary: End-to-end connectivity requires addressing, routing, a valid path, security permission, and a responding destination service. -->

One of the most common networking mistakes is, "The route exists, so the connection should work." Routing answers only one question: where should this packet go next?

Imagine a web server at `10.0.1.20` connecting to a database at `10.0.3.50` on TCP port `5432`. The VPC may have a complete local route between the subnets. A security rule can still allow that database port only from application servers and reject the web server.

Even if security rules allow the packet, the database process may be stopped or listening on a different port. The return path may be wrong. The destination name may resolve to an unexpected address.

Use this diagnostic chain:

```text
Can the source resolve and address the destination?
                  ↓
Which route matches the destination address?
                  ↓
Does the selected next hop create a valid path?
                  ↓
Do security rules permit the traffic and its return?
                  ↓
Is an application actually listening and responding?
```

Each layer answers a different question:

- **Addressing:** Who or where is the endpoint?
- **Subnetting:** Which part of the address space contains it?
- **Routing:** Which next path handles the destination?
- **Interfaces:** How is the resource attached?
- **Gateways and connections:** How does traffic move into another network?
- **Security rules:** Which traffic may pass?
- **Application state:** Does the destination service respond?

Separating these layers makes troubleshooting more reliable than changing several network controls at once.

## How Does a Small Application Fit Inside a VPC?
<!-- section-summary: A three-tier layout shows how internet entry, private application work, and a database use different subnet paths inside one VPC. -->

Put the ideas together in one small design:

```text
VPC:               10.0.0.0/16
Public subnet:     10.0.1.0/24
Private app subnet:10.0.2.0/24
Database subnet:   10.0.3.0/24
```

The public subnet contains a load balancer. The private subnet contains an application server. The database subnet contains a database.

```text
Internet
   ↓
Internet gateway
   ↓
Load balancer: 10.0.1.20
   ↓
Application server: 10.0.2.20
   ↓
Database: 10.0.3.20
```

The user-facing flow enters through the intended public component. The application and database communicate over private VPC addresses. The database does not need a direct internet path merely because the application serves internet users.

This picture also shows why a VPC is better understood as a collection of decisions rather than one magic object. The CIDR defines the address space. Subnets divide it by role. Interfaces give resources addresses. Route tables choose paths. The internet gateway connects one part of the network to another domain. Security controls decide which hops are permitted.

![The build checks summarize the first VPC review questions for CIDR, subnets, routes, endpoints, security groups, and logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-logical-isolation-network-topology/vpc-build-checks.png)

*A first VPC review checks each independent networking decision rather than treating the VPC as automatic connectivity.*

The same layered reasoning works when the application grows. You can add more subnets, additional availability locations, different outside paths, and stricter security relationships without changing the basic model.

### How Can a VPC Connect to Other Private Networks?
<!-- section-summary: Separate VPCs and corporate networks need explicit connections plus routes in both directions. -->

Suppose your company owns two non-overlapping VPCs:

```text
VPC A: 10.0.0.0/16
VPC B: 10.1.0.0/16
```

Ownership does not create connectivity. The networks need an explicit mechanism such as VPC peering, transit networking, VPN, or another cloud routing service.

The connection itself is not enough. Each side needs a route for the remote range:

```text
VPC A route:
10.1.0.0/16 → connection to VPC B

VPC B route:
10.0.0.0/16 → connection to VPC A
```

Again, having a destination address is not the same as having a path to it. Overlapping CIDR ranges also make the destination ambiguous, which is why address planning matters before networks are joined.

A corporate network can connect by the same underlying logic. Suppose the office uses `172.16.0.0/16` and the VPC uses `10.0.0.0/16`. A VPN can create a private path:

```text
Corporate network                 Cloud VPC
172.16.0.0/16                     10.0.0.0/16
       └──────────── VPN ─────────────┘
```

The corporate side routes `10.0.0.0/16` toward the cloud connection. The VPC side routes `172.16.0.0/16` toward the corporate connection. Larger organizations may use a dedicated private connection instead of a VPN, but the routing question remains the same: for this destination range, which next path should receive the packet?

These logical connections are not literal cables that you plug into a VPC object. Configuring a route such as `10.1.0.0/16 → VPC peer` tells the provider's distributed network how to forward matching packets through the logical relationship.

## Which Mental Model Makes VPCs Easier to Debug?
<!-- section-summary: Following a packet from source address to destination response provides a reusable model for cloud, office, data-centre, and container networking. -->

A private-city analogy can establish the vocabulary:

| VPC concept | City analogy |
|---|---|
| VPC | Private city |
| IP range | City's address system |
| Subnet | Neighbourhood |
| IP address | Street address |
| Network interface | Building entrance |
| Route table | Road signs |
| Router | Intersection |
| Internet gateway | Highway entrance |
| NAT gateway | Controlled highway exit |
| Security rule | Security checkpoint |
| VPN | Private tunnel to another city |

A packet asks, "How do I reach address `10.0.2.45`?" Routing gives a direction, and security controls decide whether it may pass.

The analogy eventually breaks down because cloud routes are implemented by software-defined networking rather than a physical road or a small set of visible routers. The more durable model is an ordered packet trace:

```text
SOURCE
  ↓ 1. What address and interface does the source use?
  ↓ 2. To which address did the destination name resolve?
  ↓ 3. Which route most specifically matches that destination?
  ↓ 4. What is the selected next hop?
  ↓ 5. Does that next hop form a valid end-to-end path?
  ↓ 6. Do security controls permit the traffic and response?
  ↓ 7. Is the destination service listening and responding?
DESTINATION
```

This model is not limited to AWS. It applies to home networks, company networks, data centres, other clouds, Kubernetes networking, VPNs, and hybrid systems because all use the same underlying IP concepts.

## What Does a VPC Not Mean?
<!-- section-summary: Removing common misconceptions keeps virtual networks, resources, subnets, routes, and public connectivity as separate concepts. -->

Several early misconceptions disappear once the layers are separated.

**A VPC is not a virtual machine.** The VPC provides networking. Virtual machines and other resources attach to it through interfaces.

**A VPC is not one subnet.** A VPC commonly contains multiple subnets that divide its address space and follow different routes.

**Private does not mean permanently disconnected from the internet.** A private design can include internet gateways, NAT, VPNs, private service endpoints, other VPC connections, and corporate connections. The important question is which paths exist and which side may initiate traffic.

**A route does not mean the traffic is allowed.** Routes select forwarding paths. Security controls decide whether traffic may pass.

**Public and private are not special types of the private IP range.** In the common subnet terminology, they describe connectivity behaviour produced by routes, addressing, gateways, and resource configuration.

**VPC behaviour is not identical across every cloud.** AWS and Google Cloud use the term VPC. Microsoft Azure calls the comparable abstraction a virtual network, or VNet. Provider implementations differ, including how subnets relate to regions and availability locations. The shared first-principles abstraction is a customer-controlled logical IP networking environment inside cloud infrastructure.

You can now build the definition in layers:

```text
A VPC is a network.
        ↓
A VPC is a virtual network.
        ↓
A VPC is a logically isolated virtual network
inside a cloud provider.
        ↓
Inside it, you define address ranges, subnets,
routes, interfaces, gateways, security controls,
and connections to other networks.
```

The deepest idea is that a VPC does not magically create connectivity. It creates a networking domain in which you deliberately construct connectivity. Once that distinction is clear, subnetting, route tables, internet and NAT gateways, firewall controls, VPC peering, VPNs, and transit networking become extensions of one coherent model.

## Check Your Answers
<!-- section-summary: Test the first-principles distinctions between logical isolation, addressing, forwarding paths, and permission. -->

:::expand[Why Does Cloud Computing Need VPCs?]{kind="recap"}
VPCs let cloud customers build separate logical IP networks on shared provider infrastructure.

The provider uses shared physical networking and distributed software-defined mechanisms to give you the isolation and behaviour of a private network. You control the abstraction without owning the physical routers and switches.

A VPC is a logically isolated, customer-controlled IP networking environment inside cloud infrastructure. Within it, you define address ranges, subnets, interfaces, routes, gateways, security relationships, and connections to other networks.
:::

:::expand[How Does a VPC Create a Network Boundary?]{kind="recap"}
A VPC gives IP addresses meaning inside one logical context, so isolated VPCs can reuse the same private ranges.

The address is interpreted inside a logical networking context. Separate, unconnected VPCs have separate contexts, so the same private value can identify different interfaces without a conflict.

The VPC CIDR defines the address space, and subnets divide that space for organization, routing, and availability.

It defines the address space owned by the VPC. Subnets take smaller, non-overlapping ranges from that space, and network interfaces receive addresses from their subnets.

The VPC is the broader isolated networking environment. A subnet is one subdivision of its address space, often used for a workload tier, availability placement, and a particular routing design.
:::

:::expand[How Do Resources Attach to the VPC?]{kind="recap"}
Resources connect through virtual network interfaces, and the interface normally owns the resource's IP address.

A network interface receives the address and attaches the compute or managed resource to a subnet. Thinking in terms of interfaces is more precise than saying that the abstract VPC or application process owns the address.
:::

:::expand[How Do Routes Move Packets?]{kind="recap"}
Addresses identify endpoints, while route tables choose the next path for packets based on destination ranges.

Internet gateways and NAT create different outside paths, and public or private behaviour comes from the complete configuration rather than an address label.

Its subnet can route outbound IPv4 traffic to a NAT gateway. The server starts the connection, NAT translates it toward the internet path, and responses return through that established translation.
:::

:::expand[Why Does a Route Not Guarantee Connectivity?]{kind="recap"}
End-to-end connectivity requires addressing, routing, a valid path, security permission, and a responding destination service.

For a packet with this destination range, which target or next hop should receive it? The route does not decide whether security rules permit the traffic or whether the destination application responds.

No. Addressing, a matching route, the gateway path, resource configuration, and security permission must line up. A listening destination and valid return path are also required for a working connection.

Routing only chooses a next path. The full flow also needs correct addressing, a valid end-to-end and return path, security permission, and a service listening on the expected destination and port.

They need a suitable explicit connection, non-conflicting addressing, routes that direct each remote range toward that connection, security controls that allow the traffic, and a valid response path.

Identify source and destination addresses, find the matching route and next hop, prove the end-to-end and return path, check security controls, then verify that the destination service is listening and responding.
:::

:::expand[How Does a Small Application Fit Inside a VPC?]{kind="recap"}
A three-tier layout shows how internet entry, private application work, and a database use different subnet paths inside one VPC.

Separate VPCs and corporate networks need explicit connections plus routes in both directions.
:::

:::expand[Which Mental Model Makes VPCs Easier to Debug?]{kind="recap"}
Following a packet from source address to destination response provides a reusable model for cloud, office, data-centre, and container networking.
:::

:::expand[What Does a VPC Not Mean?]{kind="recap"}
Removing common misconceptions keeps virtual networks, resources, subnets, routes, and public connectivity as separate concepts.
:::

## References

- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html) - Introduces Amazon VPC and its core networking resources.
- [How Amazon VPC works](https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html) - Explains VPCs, subnets, routing, gateways, and connections.
- [VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html) - Documents IPv4 address ranges assigned to a VPC.
- [Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html) - Describes destination-based route selection inside a VPC.
- [Connect your VPC to other networks](https://docs.aws.amazon.com/vpc/latest/userguide/extend-intro.html) - Introduces VPC, corporate, and internet connectivity options.

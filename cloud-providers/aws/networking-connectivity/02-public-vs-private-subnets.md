---
title: "Public vs Private Subnets"
description: "Learn how routing, addressing, translation, and policy create public, private, and isolated subnet behavior."
overview: "Public and private are not properties hidden inside a subnet's IP range. This article derives each subnet type from the communication paths a three-tier application actually needs."
tags: ["aws", "vpc", "subnets", "route-tables", "internet-gateway", "nat-gateway", "alb"]
order: 2
id: article-cloud-providers-aws-networking-connectivity-public-private-subnets
aliases:
  - public-vs-private-subnets
  - public-private-subnets
---

## Table of Contents

1. [What Makes a Subnet Public or Private?](#what-makes-a-subnet-public-or-private)
2. [What Does a Public Subnet Make Possible?](#what-does-a-public-subnet-make-possible)
3. [How Should a Public Entry Tier Work?](#how-should-a-public-entry-tier-work)
4. [How Should the Private App and Data Tiers Work?](#how-should-the-private-app-and-data-tiers-work)
5. [How Do Route Tables Express the Three Tiers?](#how-do-route-tables-express-the-three-tiers)
6. [Which Outbound Paths Can Private Workloads Use?](#which-outbound-paths-can-private-workloads-use)
7. [How Does IPv6 Change the Picture?](#how-does-ipv6-change-the-picture)
8. [How Do You Design Subnets From Communication Requirements?](#how-do-you-design-subnets-from-communication-requirements)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The sections below answer these questions in order:

1. **What Makes a Subnet Public or Private?**
2. **What Does a Public Subnet Make Possible?**
3. **How Should a Public Entry Tier Work?**
4. **How Should the Private App and Data Tiers Work?**
5. **How Do Route Tables Express the Three Tiers?**
6. **Which Outbound Paths Can Private Workloads Use?**
7. **How Does IPv6 Change the Picture?**
8. **How Do You Design Subnets From Communication Requirements?**

Once those questions are separate, public entry, private application servers, databases, NAT gateways, and three-tier networks become consequences of system requirements rather than labels to memorize.

## What Makes a Subnet Public or Private?
<!-- section-summary: Subnet behavior comes from routing and connectivity, not from the name or private address range. -->

Suppose a VPC owns `10.0.0.0/16` and divides it into three ranges:

```text
10.0.0.0/24 → subnet A
10.0.1.0/24 → subnet B
10.0.2.0/24 → subnet C
```

A subnet is fundamentally a range of IP addresses that shares a routing context. Nothing inside `10.0.1.0/24` declares, "I am private." All three examples use private IPv4 addresses. The public/private distinction comes mainly from the paths their route tables create.

Three common patterns are:

```text
PUBLIC
direct default route toward an internet gateway

PRIVATE
no direct internet route for workloads;
may use NAT, a proxy, or private endpoints for outbound access

ISOLATED
no general internet path
```

The terminology can vary between providers and organizations, but the connectivity difference is useful. A route table makes the intended path visible in a way that a subnet name cannot.

This does not mean route tables answer every question. A complete connection also depends on the endpoint's address, network translation where required, security policy, and an application that is listening. Public/private is about possible paths, not a guarantee that every packet succeeds.

![The subnet type view shows how public, private app, and data subnets differ mainly by route path and public address exposure](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/subnet-type-routes.png)

*Public, private, and isolated designs differ mainly in the paths their route tables create, while resource addresses and policy decide how each resource uses those paths.*

## What Does a Public Subnet Make Possible?
<!-- section-summary: A public subnet has a direct internet-gateway route, but each resource still needs suitable addressing, policy, and a listening service. -->

Consider this simplified route table:

```text
Destination       Next hop
10.0.0.0/16       local
0.0.0.0/0         internet gateway
```

The local route handles destinations inside the VPC. The default route handles IPv4 destinations for which no more-specific route exists and sends them toward the internet gateway. In AWS, this direct route is the core property normally used to call the associated subnet public.

A public subnet does not automatically publish every machine in it. Suppose a virtual machine has only this address:

```text
Private IP: 10.0.1.25
```

The RFC 1918 ranges `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16` are not globally routed across the public internet. An internet client cannot send a packet to `10.0.1.25` and expect the global network to locate your VPC.

For direct IPv4 internet communication, the resource needs a publicly routable endpoint. Cloud infrastructure can map a public address such as `203.0.113.50` to the private address `10.0.1.25`.

This creates two independent questions:

```text
Does the subnet have a direct internet route?
                     AND
Does this resource have a public endpoint or address?
```

One VM in the subnet may have a public address while another does not. The route makes direct internet connectivity possible for the subnet; the public mapping determines whether a particular IPv4 resource can use that pattern directly.

Policy is another independent layer. A server can have a public address and route while its security rules permit only TCP `443`. Internet clients can potentially reach HTTPS but not SSH on `22`, PostgreSQL on `5432`, or Redis on `6379`.

Direct exposure therefore needs all of these pieces:

```text
public endpoint or address
+ internet route
+ security policy allows the flow
+ application listens on the requested port
= working connection
```

If any piece is absent, the connection can fail. "It is in a public subnet, so it is exposed" is therefore too broad. A public subnet creates a possible direct path; it does not automatically assign a public address, open a firewall, or start a service.

### How Does a Private Subnet Reach the Internet?
<!-- section-summary: A private IPv4 workload can send its default route to NAT, which translates outbound flows and returns their responses without providing a direct inbound endpoint. -->

Now consider an application subnet whose route table says:

```text
Destination       Next hop
10.0.0.0/16       local
0.0.0.0/0         NAT gateway
```

It has no direct default route from its workloads to an internet gateway. A server such as `10.0.2.25` can still start an outbound connection through **Network Address Translation**, or NAT.

Suppose the server downloads an update from `198.51.100.20:443`. Before translation, the packet contains:

```text
Source:      10.0.2.25
Destination: 198.51.100.20
```

The destination is outside `10.0.0.0/16`, so the default route selects the NAT gateway. NAT changes the source visible to the internet:

```text
Before NAT: source 10.0.2.25
After NAT:  source 203.0.113.70
```

The outside server replies to `203.0.113.70`. The NAT system remembers the translation for the flow and maps the response back toward `10.0.2.25`.

```text
Private server initiates
        ↓
NAT gateway
        ↓
Internet service
        ↓ response
NAT remembers translation
        ↓
Private server
```

A random internet client cannot normally use that NAT mapping to start an unrelated new connection toward `10.0.2.25`. This makes the pattern useful for outbound internet access without directly publishing every private workload.

The NAT gateway itself needs an internet path. In AWS's common architecture, it sits in a public subnet that can reach an internet gateway. The private server's default route selects NAT; NAT then uses its public placement to reach the internet.

```text
Private app subnet
  └── default route → NAT gateway in public subnet
                           └── internet gateway → internet
```

The private server is not directly using the internet gateway. It uses an intermediary that can. Keeping those two hops clear helps diagnose a private workload whose outbound connection fails.

## How Should a Public Entry Tier Work?
<!-- section-summary: A dedicated public load balancer can accept legitimate internet traffic and forward it to private application targets. -->

A public-facing application needs an internet entry point, but its application servers do not necessarily need public addresses.

Suppose users visit `https://shop.example.com`. A public load balancer can receive HTTPS and forward the request across the VPC to private application servers:

```text
Internet users
      ↓
public load balancer
      ↓ private VPC traffic
application servers
```

The public tier exists to receive traffic that legitimately originates outside the network. Depending on the system, public entry components can include a load balancer, reverse proxy, API gateway, VPN endpoint, bastion or jump host, and the NAT gateway used for egress. Those components have different jobs, but each may require internet connectivity.

The useful design question is not, "This is a website, so which web servers get public IPs?" It is, **"What is the smallest intended component that internet users must reach?"** Often the answer is a load balancer.

The load balancer then forwards to an application server such as `10.0.2.25:8080`. That server needs no public endpoint. Its security policy can allow TCP `8080` from the load balancer rather than from every address.

```text
Internet → load balancer → app     allowed
Internet ───────────────X→ app     no direct path
```

This topology expresses intent. Normal users have a path to the public entry component, and that component has a specific path to the application. There is no requirement for an arbitrary internet host to connect directly to the app, so the network does not create that path.

![The guided layout shows a public load balancer sending traffic to private app tasks while the database remains in private data subnets](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/public-alb-private-api.png)

*A public entry point can receive external requests while the application and data tiers remain on private addresses.*

## How Should the Private App and Data Tiers Work?
<!-- section-summary: Private application servers accept traffic from the entry tier, while the more restricted data tier accepts only the application flows it needs. -->

The application tier typically needs to communicate with a load balancer, database, cache, internal APIs, cloud APIs, package repositories, and selected third-party services. Ask why an arbitrary machine anywhere on Earth should be allowed to start a direct connection to it. Usually there is no valid reason.

The app tier can therefore remain private. It accepts the application port from the load balancer, starts database and internal-service connections, and uses a controlled outbound mechanism only where required.

Add PostgreSQL as the data tier:

```text
Internet
  ↓
load balancer
  ↓
application
  ↓ TCP 5432
PostgreSQL
```

The database security policy can allow TCP `5432` only from the application tier. The database has no reason to receive arbitrary traffic from internet users, so it needs no direct internet entry.

The data subnet can be more restricted than the app subnet. Compare their route tables:

```text
Private app subnet
10.0.0.0/16 → local
0.0.0.0/0   → NAT gateway

Isolated data subnet
10.0.0.0/16 → local
```

The first can start generic outbound internet connections through NAT. The second has no generic internet route. Both may be called private in casual conversation, but **isolated** communicates the stronger connectivity model.

This layout is not aesthetic organization. It encodes which communication paths should exist:

```text
Internet → load balancer       required
load balancer → application    required
application → database         required
Internet → application         not required
Internet → database            not required
```

Why use separate subnets rather than one large subnet plus per-server firewall rules? Different subnets can share different connectivity models. The topology itself says that the public tier has an internet-gateway route, the application tier has a NAT route, and the database tier has no internet default route. Subnetting also supports address organization, fault-domain placement, segmentation, and clearer policy boundaries.

## How Do Route Tables Express the Three Tiers?
<!-- section-summary: Local and default routes make public, outbound-only, and isolated behavior visible for each subnet tier. -->

For a VPC with `10.0.0.0/16`, use these three subnets:

```text
10.0.1.0/24 → public entry
10.0.2.0/24 → private application
10.0.3.0/24 → private or isolated data
```

The public route table can be:

```text
Destination       Target
10.0.0.0/16       local
0.0.0.0/0         internet gateway
```

The application route table can be:

```text
Destination       Target
10.0.0.0/16       local
0.0.0.0/0         NAT gateway
```

The data route table can be:

```text
Destination       Target
10.0.0.0/16       local
```

Route selection uses **longest-prefix matching**. A packet for `10.0.3.25` matches the `/16` local route, which is more specific than `/0`, so it stays inside the VPC. A packet for `8.8.8.8` does not match `10.0.0.0/16`, so the default `0.0.0.0/0` route handles it where such a route exists.

`0.0.0.0/0` therefore means, in practical terms, "For an IPv4 destination not covered by a more-specific route, use this target."

Now trace four paths:

1. A browser reaches the load balancer through the public internet path, and the load balancer forwards privately to the app.
2. The app reaches the database through the local VPC route; no packet needs the internet.
3. The app reaches a public dependency by following its NAT default route, then the NAT gateway's internet path.
4. An internet client tries to connect directly to the database, but there is no public endpoint, intended inbound path, or permissive security policy.

The route tables reveal much of the architecture, but remember the remaining layers: public addresses, translations, and security controls still decide whether a particular flow is usable.

## Which Outbound Paths Can Private Workloads Use?
<!-- section-summary: Private workloads can use NAT, a controlled proxy, or private service endpoints depending on the destination. -->

Private application code often needs dependencies outside its subnet:

- package repositories for `npm`, `apt`, or `yum`;
- GitHub and container registries;
- third-party APIs, payment processors, and email providers; and
- cloud control-plane APIs and object storage.

Private does not necessarily mean unable to communicate outside the VPC. It normally means the workload does not accept direct, unsolicited internet-originated connections.

Several outbound designs are possible:

```text
Private workload → NAT → internet
Private workload → HTTP proxy → internet
Private workload → private endpoint → cloud service
```

The third path avoids a general internet route for a supported cloud service. Instead of sending object-storage traffic through NAT and the public internet path, the workload uses a private network endpoint for that service. When the provider supports it, this can reduce reliance on general-purpose internet egress.

These mechanisms should follow the dependency. Public third-party services require an appropriate public or private provider connection. A supported cloud API may fit a private endpoint. A company may require outbound inspection through a proxy. "Private subnet" is the starting constraint; the named destination determines the deliberate exception.

### Why Are NAT and Private Placement Not Security by Themselves?
<!-- section-summary: NAT performs address translation, and private placement removes paths, but layered policy and application controls still protect the system. -->

People sometimes say that the NAT gateway protects the application server. NAT's fundamental job is address and port translation:

```text
10.0.2.25:49152
        ↓ translated to
203.0.113.70:31241
```

The inability to start arbitrary inbound connections through the common NAT architecture is useful, but NAT is not a substitute for access-control policy.

Keep three jobs separate:

```text
Routing  → where packets can travel
NAT      → which addresses and ports are translated
Firewall → which packets are permitted
```

Security groups, network ACLs, host firewalls, application authentication, and application authorization still matter.

Private placement is also not a complete security claim. A compromised application server may be able to reach a database that accepts overly broad traffic from the entire app subnet. Neither system needed a public endpoint for the compromise to spread.

Security is layered:

```text
internet-exposure choices
        ↓
network segmentation
        ↓
firewall permission
        ↓
identity and authentication
        ↓
application authorization
        ↓
encryption, patching, and hardening
```

A private subnet removes or restricts network paths. That is valuable, but it does not prove the workload, credentials, application, or permitted internal paths are safe.

The four concepts that most often become mixed together should remain independent:

```text
subnet
route
public address
firewall rule
```

When a connection fails or exposure is suspected, inspect each one instead of assuming the subnet label answers all four.

## How Does IPv6 Change the Picture?
<!-- section-summary: IPv6 can use globally routable addresses without IPv4-style NAT, so routing and policy become even clearer parts of private reachability. -->

Most beginner explanations silently assume IPv4 and NAT. IPv6 changes the address-translation part of the picture.

An IPv6 workload can have a globally routable address without IPv4-style NAT. That does not mean every internet client may connect. Route tables and security policy still decide whether an inbound path exists and which packets are permitted.

Platforms can provide an **egress-only internet gateway** for IPv6:

```text
Private IPv6 workload
       ↓ initiates connection
egress-only internet gateway
       ↓
internet
```

The pattern reinforces the broader principle. Private describes intended reachability and connection initiation, not merely whether an address looks private. An address can be globally routable while routing and firewall configuration reject unwanted inbound access.

## How Do You Design Subnets From Communication Requirements?
<!-- section-summary: Listing who must initiate traffic toward whom produces the subnet and route design from first principles. -->

Do not begin with, "AWS says I need three subnet types." Begin with the arrows your system requires.

For a typical web application:

```text
Internet → load balancer       yes
Internet → application server no
Internet → database           no

load balancer → application   yes
application → database        yes
application → internet        maybe
database → internet           maybe, preferably limited
```

Now configure addressing, routing, translation, and policy to create those arrows and remove unnecessary ones.

The result naturally has a public entry tier, a private application tier, and a private or isolated data tier. The load balancer is public because strangers are supposed to reach it. The app is private because designated internal components should reach it. The database is more restricted because usually only the app tier should initiate its data connection.

![The placement checks summarize the questions a reviewer asks before approving subnet placement for a production workload](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/subnet-placement-checks.png)

*Review subnet placement by checking the intended initiator, destination, route, translation, and policy for every required communication path.*

The model worth retaining is:

```text
Public subnet ≠ public IP
Public IP ≠ open firewall
Open firewall ≠ running service
Private IP ≠ secure system
NAT ≠ firewall
```

Public and private are not properties of what a machine does. They describe the connectivity paths you deliberately give it. Once you think in terms of who needs to initiate a packet toward whom, subnet design becomes a consequence of system requirements rather than a memorized diagram.

## Check Your Answers
<!-- section-summary: Review the independent roles of routes, public addresses, translation, policies, and application listeners. -->

:::expand[What Makes a Subnet Public or Private?]{kind="recap"}
Subnet behavior comes from routing and connectivity, not from the name or private address range.
:::

:::expand[What Does a Public Subnet Make Possible?]{kind="recap"}
A public subnet has a direct internet-gateway route, but each resource still needs suitable addressing, policy, and a listening service.

Its associated route table has a direct default path to an internet gateway. That route makes direct internet connectivity possible, but does not by itself give each resource a public address or allow traffic through its security policy.

It may lack a public IPv4 endpoint, its security rules may reject the traffic, or no application may be listening. The subnet route, resource address, policy, and application state are independent requirements.

A private IPv4 workload can send its default route to NAT, which translates outbound flows and returns their responses without providing a direct inbound endpoint.

The server starts a connection and follows its default route to NAT. NAT replaces the private source with a public source, remembers the flow, and translates the reply back. This does not provide a direct endpoint for arbitrary new inbound connections.

The private subnet sends internet-bound traffic to NAT, and NAT itself needs a route through an internet gateway. The private workload uses the intermediary rather than directly using the internet gateway.
:::

:::expand[How Should a Public Entry Tier Work?]{kind="recap"}
A dedicated public load balancer can accept legitimate internet traffic and forward it to private application targets.

Internet users can reach a dedicated public load balancer, which forwards over the private VPC to application targets. Only the public entry point needs direct internet reachability.
:::

:::expand[How Should the Private App and Data Tiers Work?]{kind="recap"}
Private application servers accept traffic from the entry tier, while the more restricted data tier accepts only the application flows it needs.
:::

:::expand[How Do Route Tables Express the Three Tiers?]{kind="recap"}
Local and default routes make public, outbound-only, and isolated behavior visible for each subnet tier.

The private subnet can start generic outbound internet connections through its NAT default route. The isolated subnet has no generic internet route and normally contains only local or explicitly private destinations.

A destination inside `10.0.0.0/16` uses the more-specific local route. Other IPv4 destinations fall back to the `/0` default route if one exists.
:::

:::expand[Which Outbound Paths Can Private Workloads Use?]{kind="recap"}
Private workloads can use NAT, a controlled proxy, or private service endpoints depending on the destination.

It can use NAT for public destinations, an outbound proxy, or a private endpoint for a supported cloud service. The correct path follows the named dependency and the organization's egress requirements.

NAT performs address translation, and private placement removes paths, but layered policy and application controls still protect the system.

NAT translates addresses and ports. Firewall mechanisms decide which traffic is allowed. The usual NAT flow has a useful inbound limitation, but security groups, ACLs, host controls, and application authentication still enforce policy.

Private placement removes direct paths but does not prevent compromise through allowed internal traffic, weak credentials, excessive application authorization, missing encryption, or unpatched software. It is one layer in a larger security model.
:::

:::expand[How Does IPv6 Change the Picture?]{kind="recap"}
IPv6 can use globally routable addresses without IPv4-style NAT, so routing and policy become even clearer parts of private reachability.

IPv6 addresses can be globally routable without IPv4-style NAT. Routing and firewall policy can still prevent unwanted inbound access, and an egress-only internet gateway can support outbound-initiated connectivity.
:::

:::expand[How Do You Design Subnets From Communication Requirements?]{kind="recap"}
Listing who must initiate traffic toward whom produces the subnet and route design from first principles.

List who must initiate connections to which destinations. Then configure addresses, routes, translation, and policy to allow those arrows and omit the rest. The public, private, and isolated tiers follow from those requirements.
:::

## References

- [VPCs and subnets](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html) - Explains subnet address ranges and routing behavior in Amazon VPC.
- [Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html) - Documents local, default, internet-gateway, and NAT targets.
- [Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html) - Describes direct internet communication requirements for VPC resources.
- [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html) - Explains outbound translation for resources in private subnets.
- [VPC endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html) - Introduces private connectivity to supported services and resources.
- [Egress-only internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html) - Describes outbound-only IPv6 internet communication.

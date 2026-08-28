---
title: "Transit Gateway and Multi-VPC Networking"
description: "Learn how VPC peering, Transit Gateway attachments, two routing layers, association, propagation, segmentation, inspection, and cross-account ownership connect many networks."
overview: "A packet cannot cross isolated VPCs without an explicit next hop. This article begins with direct peering, then derives Transit Gateway as a managed regional router whose attachments and route tables turn many pairwise connections into centrally governed routing domains."
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

1. [Why Do Separate VPCs Need an Explicit Connection?](#why-do-separate-vpcs-need-an-explicit-connection)
2. [When Does VPC Peering Fit?](#when-does-vpc-peering-fit)
3. [What Is a Transit Gateway Attachment?](#what-is-a-transit-gateway-attachment)
4. [Why Are There Two Route-Table Lookups?](#why-are-there-two-route-table-lookups)
5. [How Do Multiple TGW Route Tables Create Segmentation?](#how-do-multiple-tgw-route-tables-create-segmentation)
6. [How Do Shared Services and Inspection Fit the Hub?](#how-do-shared-services-and-inspection-fit-the-hub)
7. [When Should You Choose Peering or Transit Gateway?](#when-should-you-choose-peering-or-transit-gateway)
8. [How Do You Troubleshoot a Multi-VPC Path?](#how-do-you-troubleshoot-a-multi-vpc-path)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The first-principles question behind multi-VPC networking is:

> How does an IP packet move from one isolated routing domain into another?

Once that is clear, peering, Transit Gateway attachments, VPC routes, TGW route-table associations, route propagation, segmentation, shared services, and return-path debugging become variations of ordinary routing.

Treat every cross-VPC flow as a forward path and a return path. The source subnet first chooses an attachment or peer, the transit system makes its own routing decision, and the destination VPC chooses the final local path. Segmentation works only when each lookup and each security boundary agrees with the intended relationship.

Begin with one VPC:

```text
VPC A:    10.1.0.0/16
Subnet A: 10.1.1.0/24
EC2-A:    10.1.1.10
```

When EC2-A sends a packet, the network asks:

```text
What is the destination IP?
        ↓
Which route matches most specifically?
        ↓
Which next hop receives the packet?
```

Keep these questions in view as you work through the lesson:

1. **Why Do Separate VPCs Need an Explicit Connection?**
2. **When Does VPC Peering Fit?**
3. **What Is a Transit Gateway Attachment?**
4. **Why Are There Two Route-Table Lookups?**
5. **How Do Multiple TGW Route Tables Create Segmentation?**
6. **How Do Shared Services and Inspection Fit the Hub?**
7. **When Should You Choose Peering or Transit Gateway?**
8. **How Do You Troubleshoot a Multi-VPC Path?**

## Why Do Separate VPCs Need an Explicit Connection?
<!-- section-summary: A VPC is an isolated Layer-3 network, so traffic to another VPC needs a route and an explicit inter-network next hop. -->

`10.1.2.20` matches the local `10.1.0.0/16` route. `8.8.8.8` may match a default NAT route. AWS uses most-specific, or longest-prefix, destination matching.

Now add VPC B:

```text
VPC B: 10.2.0.0/16
EC2-B: 10.2.1.20
```

EC2-A sends:

```text
Source:      10.1.1.10
Destination: 10.2.1.20
```

If VPC A has only `10.1.0.0/16 → local`, no route matches the remote VPC. Both networks being in AWS or owned by the same company creates no path. A connection object must become the next hop between the routing domains, and the destination must have a way back.

The basic model remains:

```text
destination IP → route lookup → inter-network next hop
```

Transit Gateway does not replace that logic. It introduces a managed router as one possible next hop.

## When Does VPC Peering Fit?
<!-- section-summary: Peering creates a direct, non-transitive Layer-3 relationship that stays simple for a small number of VPC pairs. -->

A **VPC peering connection** directly joins two VPC routing domains:

```text
VPC A ───── VPC peering ───── VPC B
```

VPC A adds:

```text
10.2.0.0/16 → pcx-123
```

VPC B adds the return route:

```text
10.1.0.0/16 → pcx-123
```

The routes create forward and reverse paths. Security groups, NACLs, DNS, and destination listeners still decide whether an application connection succeeds.

![The peering view shows the simple two-VPC case where direct routing can work without a central hub](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/one-peering-relationship.png)

*A direct connection is easy to understand when two VPCs have one stable relationship and non-overlapping addresses.*

Peering is deliberately **non-transitive**. If A peers with B and A peers with C, B cannot use A as a router to reach C. B and C need their own direct peering relationship.

```text
B ──peer── A ──peer── C

B cannot route through A to C
```

A complete three-VPC mesh needs three edges. The number of pairwise relationships grows approximately as:

```text
n(n - 1) / 2
```

Ten VPCs can require 45 peerings; 100 VPCs can require 4,950. Each edge also brings route updates, return routes, security review, DNS considerations, and owner coordination.

Peering remains valuable when two VPCs need a direct, simple connection or the topology is small and stable. A company constructing a network of many networks experiences peering's non-transitivity as an operational burden.

### Why Does Transit Gateway Scale Better?
<!-- section-summary: Transit Gateway replaces many pairwise connections with one regional managed router and a roughly linear number of attachments. -->

Traditional networks avoid a full mesh by introducing a router:

```text
LAN A ─┐
LAN B ─┼→ router ←─ LAN D
LAN C ─┘
```

AWS Transit Gateway applies the same idea:

```text
VPC A ─┐
VPC B ─┼→ Transit Gateway ←─ shared services
VPC C ─┘
```

**AWS Transit Gateway**, or TGW, is a managed regional Layer-3 transit router. It forwards packets between attachments according to destination IP addresses.

Instead of every VPC connecting to every other VPC, each network connects to the hub:

```text
A ↔ TGW
B ↔ TGW
C ↔ TGW
D ↔ TGW
```

The topology grows roughly with the number of attached networks rather than the square of that number. This is the hub-and-spoke model.

![The hub view shows how Transit Gateway reduces many separate peering relationships into shared attachments and route tables](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/transit-gateway-hub.png)

*Transit Gateway centralizes the router, but its route tables still decide which spokes may reach each destination.*

Being attached to one router does not mean every network must communicate. Multiple TGW route tables can create separate routing domains for production, development, shared services, inspection, egress, or hybrid connectivity.

The hub is therefore both a scaling mechanism and a central Layer-3 connectivity-policy point.

## What Is a Transit Gateway Attachment?
<!-- section-summary: An attachment connects one network to Transit Gateway like a router port, but routing policy still determines where its packets may go. -->

Think of a TGW attachment as the AWS equivalent of a router port:

```text
VPC A → attachment A ┐
VPC B → attachment B ├→ Transit Gateway
VPC C → attachment C ┘
```

The attachment says that the VPC and Transit Gateway are connected. It does not automatically create routes between every connected network.

For a VPC attachment, AWS creates TGW network interfaces in the attachment subnets. You select at most one attachment subnet per Availability Zone. Enabling multiple zones gives the VPC paths into TGW from those zones. Resources in an Availability Zone without relevant attachment presence cannot use that attachment as if it had local presence there.

The useful picture is:

```text
workload subnet
  ↓ VPC route chooses TGW
TGW attachment ENI in the VPC
  ↓ attachment
Transit Gateway router
```

Dedicated attachment subnets can make the connection points, NACLs, and route expectations easier to manage. Regardless of subnet layout, the VPC's workload route tables must send relevant remote destinations toward TGW.

An attachment is only the connection. The VPC route decides whether a source packet enters it, and the TGW route table decides which attachment receives the packet next.

## Why Are There Two Route-Table Lookups?
<!-- section-summary: The source VPC route table gets the packet to TGW, and the TGW table associated with the source attachment chooses the destination attachment. -->

Transit Gateway introduces two routing layers:

```text
source resource
  ↓ 1. source subnet's VPC route table
Transit Gateway
  ↓ 2. source attachment's associated TGW route table
destination attachment and VPC
```

Suppose:

```text
VPC A = 10.1.0.0/16
VPC B = 10.2.0.0/16
```

EC2-A sends to `10.2.1.20`. The source subnet table needs:

```text
10.2.0.0/16 → tgw-123
```

That gets the packet to TGW. TGW then needs its own entry:

```text
10.2.0.0/16 → attachment B
```

The full forward path is:

```text
10.1.1.10
  ↓ VPC A route: 10.2.0.0/16 → TGW
attachment A
  ↓ associated TGW route table lookup
10.2.0.0/16 → attachment B
  ↓
VPC B
  ↓
10.2.1.20
```

Transit Gateway does not eliminate VPC routes. Attaching a VPC while leaving its workload table as only `local` plus `0.0.0.0/0 → NAT` does not redirect remote private traffic to TGW. The source must explicitly choose the router.

The return direction repeats both decisions independently:

```text
VPC B subnet route: 10.1.0.0/16 → TGW
TGW table used by attachment B:
10.1.0.0/16 → attachment A
```

Reachability is bidirectional even when each routing decision is made separately. A perfect forward route with a missing return route still produces a broken application.

The route table associated with the **source attachment** controls each TGW lookup. A-to-B traffic uses A's associated TGW table. The reply uses B's associated table. Those tables can contain different routes, which enables segmentation but requires troubleshooting both directions.

### How Do Association and Propagation Differ?
<!-- section-summary: Association chooses the TGW table for traffic arriving from an attachment, while propagation teaches selected tables how to reach that attachment. -->

Transit Gateway route tables separate "which policy handles my traffic" from "which tables know my destination."

An attachment's **association** answers:

> Which TGW route table handles packets arriving from this attachment?

```text
attachment A
  └── associated with Production-TGW-RT
```

An attachment can be associated with one TGW route table at a time. The shorthand is:

> Association controls traffic **from me**.

This is not literally an ACL. It works as a mental model because the selected table contains the next hops available to packets entering from that attachment.

**Propagation** answers:

> Which TGW route tables learn how to reach this attachment's network?

If VPC B `10.2.0.0/16` propagates into a table, that table learns:

```text
10.2.0.0/16 → attachment B
```

An attachment can propagate into multiple TGW route tables. The shorthand is:

> Propagation controls which tables know how to get **to me**.

Static routes provide a third choice: an administrator explicitly maps a destination to an attachment. A blackhole route deliberately drops traffic whose destination matches.

| Concept | Question |
|---|---|
| Association | Which table handles traffic from this attachment? |
| Propagation | Which tables learn how to reach this attachment? |
| Static route | Which explicit next attachment should this destination use? |
| Blackhole route | Which matching destinations should be dropped? |

Do not infer a path merely because a destination attachment propagates into some table. The source attachment must be associated with a table that actually contains that learned or static route.

## How Do Multiple TGW Route Tables Create Segmentation?
<!-- section-summary: Different associations and propagation sets can let spokes reach shared services while omitting routes between the spokes. -->

Suppose App A and App B should both reach Shared Services, but must not reach each other.

Create:

```text
Spoke-RT
Shared-RT
```

Associate both application attachments with `Spoke-RT`. Associate Shared Services with `Shared-RT`.

`Spoke-RT` contains only:

```text
10.100.0.0/16 → shared attachment
```

`Shared-RT` contains:

```text
10.1.0.0/16 → App A attachment
10.2.0.0/16 → App B attachment
```

App A can look up Shared Services and find a route. Shared Services can return to both apps. App A looking for App B finds no route in `Spoke-RT`, so the packet stops.

```text
App A ↔ Shared Services ↔ App B

App A  X──────────────X App B
```

This is routing segmentation. It answers whether a packet can get there before resource firewalls and application authorization are considered.

Now consider a single default table into which every attachment is associated and propagated. Production, development, and test all learn routes to one another. Adding a PCI VPC with the same defaults can suddenly give every existing attachment a route toward PCI.

The set of networks that gain possible reachability from one routing change is the **routing blast radius**. Separate tables such as `Prod-RT`, `NonProd-RT`, `Shared-RT`, `Inspection-RT`, and `Egress-RT` reduce that radius.

Blackhole routes can explicitly reject sensitive ranges, but segmentation should begin with the routes each domain actually needs rather than one fully connected default.

Routing isolation does not replace security groups, NACLs, firewalls, identity, or application authorization. It removes unnecessary paths before those later controls must decide.

## How Do Shared Services and Inspection Fit the Hub?
<!-- section-summary: The hub centralizes common networks and can steer flows through stateful inspection or egress paths while preserving return symmetry. -->

Fifty workload VPCs may all need DNS, directory services, central logging, on-premises connectivity, security inspection, or shared egress. Point-to-point connectivity repeats each relationship.

Transit Gateway lets the network team reason in categories:

```text
workload VPCs
    ↓
Transit Gateway
  ├─ shared services
  ├─ security inspection
  ├─ egress VPC
  └─ VPN or Direct Connect to on-premises
```

This operational centralization is one of TGW's strongest benefits.

Inspection follows the same route logic. If workload-to-internet traffic must cross a firewall:

```text
workload → TGW → inspection VPC → firewall
         → TGW or egress → internet
```

TGW route tables steer the destination toward the inspection attachment. Firewall-subnet routes and the inspection table then carry it onward.

Stateful appliances need the forward and return directions to traverse the expected appliance path. Transit Gateway **appliance mode** supports suitable Availability Zone affinity for VPC attachments that contain stateful network appliances.

![The inspected path shows how segmentation, shared services, inspection VPCs, and hybrid links change the packet route](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/inspected-hybrid-path.png)

*Central inspection is still a sequence of destination-based route decisions, with the added requirement that both directions preserve the stateful appliance path.*

The architecture is advanced, but the first principle stays ordinary:

```text
destination → routing policy → next attachment
```

### How Does Ownership Work Across AWS Accounts?
<!-- section-summary: AWS RAM lets a network account own TGW policy while application accounts own their VPCs, workload routes, and application controls. -->

Large organizations place VPCs in separate AWS accounts:

```text
Network account
  ├─ Transit Gateway
  ├─ TGW route tables
  ├─ Direct Connect and VPN
  └─ firewalls

Application accounts
  └─ workload VPCs
```

The network account can share Transit Gateway through **AWS Resource Access Manager**, or RAM. Application accounts attach their VPCs to the shared TGW. The TGW owner retains control of route tables, associations, and propagations; participants do not modify those central routing structures.

This creates a clean responsibility split:

| Workload team | Central network team |
|---|---|
| Owns its VPC and workload subnets | Owns TGW and its route tables |
| Owns application security groups | Controls cross-VPC routing policy |
| Adds required VPC routes toward TGW | Controls association and propagation |

Depending on TGW configuration, cross-account attachment requests can be accepted automatically or require explicit acceptance by the owner.

The organizational model mirrors the technical model. The workload team provides one network and states which destinations it needs. The network team decides how that attachment participates in the organization's wider routing domains.

## When Should You Choose Peering or Transit Gateway?
<!-- section-summary: Peering is excellent for a small direct relationship, while Transit Gateway fits many networks, transitive hubs, segmentation, hybrid connectivity, and centralized ownership. -->

Transit Gateway is not automatically better because it is more centralized. The choice follows the topology.

| Situation | VPC peering | Transit Gateway |
|---|---:|---:|
| Two VPCs need direct connectivity | Excellent | Often unnecessary |
| Small, stable relationships | Excellent | Possible |
| Many VPCs | Cumbersome | Excellent |
| Transitive routing | No | Yes |
| Shared-services hub | Awkward at scale | Excellent |
| Central VPN or Direct Connect | Limited by peering semantics | Excellent |
| Central segmentation | Distributed | Centralized |
| Inspection and shared egress | Awkward | Natural |
| Cross-account central ownership | Possible but distributed | Strong fit |

The shorthand is:

```text
Peering: Connect these two networks.
Transit Gateway: Build a network that connects many networks.
```

Neither option fixes overlapping addresses. Transit Gateway does not normally route between attached VPCs with overlapping CIDRs, and peering also prohibits overlapping CIDRs. Address planning remains a prerequisite.

## How Do You Troubleshoot a Multi-VPC Path?
<!-- section-summary: A reliable investigation traces the source VPC route, attachment, source-associated TGW table, destination VPC, return path, and security layers. -->

Do not treat green attachment status as proof that an application path works. Trace one exact flow and then its return.

1. Write the source IP, destination IP, protocol, port, source and destination VPCs, and Availability Zones. `10.1.1.10 → 10.2.2.20:443` is actionable; "A cannot reach B" is not.
2. Inspect the source subnet's VPC route table. Find the most-specific destination match and prove its target is TGW.
3. Confirm the VPC attachment is active and that the relevant Availability Zone participates in the attachment.
4. Identify the TGW route table associated with the source attachment. Do not inspect a convenient table that the packet never uses.
5. Look up the destination in that table. Confirm the longest match points to the expected attachment rather than an inspection path, VPN, wrong VPC, or blackhole.
6. Inspect routing inside the destination VPC so packets arriving from TGW can reach the target.
7. Check security groups, NACLs, firewalls, host controls, and the application's listening port only after the route sequence is sound.
8. Trace the whole return independently: destination subnet to TGW, destination attachment's associated table to the source attachment, and source VPC delivery.
9. Test with the destination IP when practical to separate Route 53 behavior from TGW routing.
10. After constructing the expected path, compare it with Reachability Analyzer, TGW Flow Logs, and VPC Flow Logs. Reachability Analyzer statically examines configuration, TGW Flow Logs observe transit traffic, and VPC Flow Logs observe interface-level traffic inside VPCs.

Stateful inspection makes asymmetry especially important. A forward path through one firewall and a return path around it can fail even when every destination has some route.

![The routing checklist gives a multi-VPC investigation order across VPC route tables, Transit Gateway routes, security controls, DNS, and logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/multi-vpc-routing-checklist.png)

*Start with the source VPC and source-associated TGW table, then prove the reverse path through the destination's independently selected tables.*

The entire system reduces to three questions:

```text
1. Does the source VPC send this destination to TGW?

2. Does the route table associated with the source
   attachment send it to the right next attachment?

3. Can the same two-layer process happen in reverse?
```

The progression is:

```text
one VPC → one routing domain
two VPCs → need a connection
peering → direct point-to-point connection
many peerings → mesh growth and no transitive routing
Transit Gateway → central Layer-3 router
attachments → ports into that router
VPC routes → decide whether packets go to the router
TGW routes → decide which attachment the router selects
association → policy for traffic from an attachment
propagation → tables that learn how to reach an attachment
multiple TGW tables → segmentation
AWS RAM → central ownership across accounts
```

The one sentence to retain is: **a VPC route table gets the packet to Transit Gateway; the route table associated with the source attachment gets the packet from Transit Gateway to its next attachment.**

## Check Your Answers
<!-- section-summary: Review the direct, hub, attachment, dual-route, segmentation, ownership, and return-path concepts. -->

:::expand[Why Do Separate VPCs Need an Explicit Connection?]{kind="recap"}
A VPC is an isolated Layer-3 network, so traffic to another VPC needs a route and an explicit inter-network next hop.

Each VPC is an isolated Layer-3 routing domain. The source needs a route to an explicit inter-network next hop, the destination needs a return path, and packet security still has to permit the flow.
:::

:::expand[When Does VPC Peering Fit?]{kind="recap"}
Peering creates a direct, non-transitive Layer-3 relationship that stays simple for a small number of VPC pairs.

Each side routes the other VPC's non-overlapping CIDR to the peering connection. Peering provides the direct connection but does not create a transitive router for additional VPCs.

Transit Gateway replaces many pairwise connections with one regional managed router and a roughly linear number of attachments.

Each network attaches once to a managed hub rather than establishing a pairwise connection to every other network. Attachments grow roughly with the number of networks instead of the square of that number.
:::

:::expand[What Is a Transit Gateway Attachment?]{kind="recap"}
An attachment connects one network to Transit Gateway like a router port, but routing policy still determines where its packets may go.

It connects a network to the Transit Gateway like a router port. It does not grant full connectivity; VPC and TGW route tables still select the paths available through it.

Not through normal VPC attachment routing. Peering also prohibits overlapping CIDRs. Multi-VPC design still needs coordinated address planning.
:::

:::expand[Why Are There Two Route-Table Lookups?]{kind="recap"}
The source VPC route table gets the packet to TGW, and the TGW table associated with the source attachment chooses the destination attachment.

The source subnet's VPC route table decides whether the packet enters TGW. The TGW route table associated with the source attachment then decides which attachment receives it.

Association chooses the TGW table for traffic arriving from an attachment, while propagation teaches selected tables how to reach that attachment.

Association selects the one TGW table used for traffic arriving from an attachment. Propagation teaches one or more TGW tables how to reach the attachment's network.
:::

:::expand[How Do Multiple TGW Route Tables Create Segmentation?]{kind="recap"}
Different associations and propagation sets can let spokes reach shared services while omitting routes between the spokes.

Associate both spokes with a table that has only the shared-services route. Associate shared services with a table containing return routes to both spokes. Omit spoke-to-spoke routes.

It is the set of networks that gain possible reachability when a route, propagation, association, or attachment changes. One shared default table can make a new sensitive attachment visible to many existing networks.
:::

:::expand[How Do Shared Services and Inspection Fit the Hub?]{kind="recap"}
The hub centralizes common networks and can steer flows through stateful inspection or egress paths while preserving return symmetry.

The appliance tracks conversation state. Forward and return traffic must traverse the intended appliance path, which can require inspection route tables and Transit Gateway appliance mode.

AWS RAM lets a network account own TGW policy while application accounts own their VPCs, workload routes, and application controls.

Application accounts own VPCs, workload subnets, VPC routes, and application security groups. A central network account shares TGW and controls its route tables, associations, propagations, and cross-network policy.
:::

:::expand[When Should You Choose Peering or Transit Gateway?]{kind="recap"}
Peering is excellent for a small direct relationship, while Transit Gateway fits many networks, transitive hubs, segmentation, hybrid connectivity, and centralized ownership.
:::

:::expand[How Do You Troubleshoot a Multi-VPC Path?]{kind="recap"}
A reliable investigation traces the source VPC route, attachment, source-associated TGW table, destination VPC, return path, and security layers.

Check the source VPC route, attachment and Availability Zone presence, source attachment's associated TGW table, destination attachment and VPC route, then repeat the entire chain for the return before moving to security and application layers.
:::

## References

- [Route priority](https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html) - Explains longest-prefix destination matching.
- [How VPC peering works](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html) - Documents point-to-point, non-transitive peering behavior.
- [VPC peering at scale](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/vpc-peering.html) - Compares point-to-point peering with larger network designs.
- [How AWS Transit Gateway works](https://docs.aws.amazon.com/vpc/latest/tgw/how-transit-gateways-work.html) - Covers the regional router, attachments, route tables, association, propagation, blackholes, and appliance mode.
- [Transit Gateway VPC attachments](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html) - Documents attachment subnets, Availability Zones, overlapping CIDRs, and VPC routes.
- [Transit gateways](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-transit-gateways.html) - Explains multiple tables and segmentation.
- [Create a VPC attachment](https://docs.aws.amazon.com/cli/latest/reference/ec2/create-transit-gateway-vpc-attachment.html) - Documents the VPC attachment inputs.
- [Work with Transit Gateway](https://docs.aws.amazon.com/vpc/latest/tgw/working-with-transit-gateways.html) - Covers owner and participant responsibilities for shared TGWs.
- [Accept a shared attachment](https://docs.aws.amazon.com/vpc/latest/tgw/acccept-tgw-attach.html) - Describes manual and automatic cross-account acceptance.
- [Reachability Analyzer](https://docs.aws.amazon.com/vpc/latest/userguide/reachability-analyzer.html) - Introduces static path analysis for VPC and TGW configurations.

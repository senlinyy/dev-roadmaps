---
title: "Security Groups and NACLs"
description: "Learn how stateful security groups and stateless network ACLs filter AWS VPC traffic at different layers."
overview: "A route gives a packet a possible path. Security groups and network ACLs decide whether the packet may use that path, but they differ in attachment point, connection state, rule ordering, deny behavior, and return-traffic handling."
tags: ["aws", "vpc", "security-groups", "nacls", "flow-logs", "networking"]
order: 4
id: article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls
aliases:
  - security-groups-and-nacls
  - open-the-right-packet-path
  - article-cloud-providers-aws-networking-connectivity-security-groups-nacls
  - cloud-providers/aws/networking-connectivity/security-groups-and-nacls.md
  - security-groups-vs-nacls
  - cloud-providers/aws/networking-connectivity/security-groups-vs-nacls.md
  - cloud-providers/aws/networking-connectivity/02-security-groups-vs-nacls.md
---

## Table of Contents

1. [What Must Happen to One Packet?](#what-must-happen-to-one-packet)
2. [How Are Security Groups Different From NACLs?](#how-are-security-groups-different-from-nacls)
3. [Why Are Security Group References Useful?](#why-are-security-group-references-useful)
4. [How Do Stateless NACLs Work?](#how-do-stateless-nacls-work)
5. [Why Do NACLs Need Ephemeral-Port Rules?](#why-do-nacls-need-ephemeral-port-rules)
6. [How Do Ordered Allow and Deny Rules Work?](#how-do-ordered-allow-and-deny-rules-work)
7. [How Do Flow Logs Help Explain a Failure?](#how-do-flow-logs-help-explain-a-failure)
8. [How Do You Troubleshoot a Packet Path?](#how-do-you-troubleshoot-a-packet-path)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Suppose a browser connects to a web application over HTTPS:

```text
Client                                  Web server
203.0.113.50:53124 ──────────────────► 10.0.2.10:443
```

The client sends traffic toward a known server port. The server replies to the client's temporary source port:

```text
Client                                  Web server
203.0.113.50:53124 ◄────────────────── 10.0.2.10:443
```

Those two directions explain most of the difference between an AWS security group and a network access control list, or NACL.

A TCP packet carries facts such as:

```text
Source IP:        203.0.113.50
Source port:      53124
Destination IP:   10.0.2.10
Destination port: 443
Protocol:         TCP
```

AWS networking must answer two independent questions:

```text
Where should this packet go?
        → routing

May this packet go there?
        → filtering and security
```

A route such as `0.0.0.0/0 → internet gateway` does not allow internet traffic. It selects a next hop for destinations without a more-specific route. Security groups and NACLs may still reject the packet.

Keep these questions in view as you work through the lesson:

1. **What Must Happen to One Packet?**
2. **How Are Security Groups Different From NACLs?**
3. **Why Are Security Group References Useful?**
4. **How Do Stateless NACLs Work?**
5. **Why Do NACLs Need Ephemeral-Port Rules?**
6. **How Do Ordered Allow and Deny Rules Work?**
7. **How Do Flow Logs Help Explain a Failure?**
8. **How Do You Troubleshoot a Packet Path?**

## What Must Happen to One Packet?
<!-- section-summary: A working connection needs a route, filtering permission in both relevant directions, and a listening destination service. -->

The reverse is also true. A security group can allow TCP `443`, but it cannot manufacture a missing route, internet gateway, NAT path, peering route, or listening service.

The simplified formula is:

```text
working connectivity
    = valid route and return path
    + permitted network traffic
    + destination listening and responding
```

For an EC2 HTTPS server, the route, NACL rules, security-group rules, and server process must all align. Remove one layer and the request can fail.

This separation is practical, not merely theoretical. Randomly widening a security group cannot repair a wrong route. Adding a route cannot override a NACL deny. Opening both network controls cannot start a stopped web server.

## How Are Security Groups Different From NACLs?
<!-- section-summary: Security groups protect resource interfaces with stateful allow rules, while NACLs protect subnet boundaries with ordered stateless allow and deny rules. -->

AWS provides two major VPC packet filters:

| Property | Security group | Network ACL |
|---|---|---|
| Protects | Network interfaces and attached resources | Subnet boundary |
| Mental model | Firewall around a resource | Firewall around a subnet |
| Connection state | Stateful | Stateless |
| Allow rules | Yes | Yes |
| Explicit deny rules | No | Yes |
| Rule ordering | No | Yes |
| Can reference security groups | Yes | No |
| Can use CIDR ranges | Yes | Yes |
| Strongest use | Precise application access | Coarse subnet guardrails |

![The control comparison shows why security groups track connection state while network ACLs require separate inbound and outbound thinking](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/stateful-vs-stateless-controls.png)

*Security groups remember allowed conversations around resources; NACLs evaluate each packet independently at subnet boundaries.*

The most important difference is state. A stateful security group recognizes return traffic for an allowed connection. A stateless NACL evaluates the reply as another packet. That is why a custom NACL often needs broad-looking ephemeral-port rules even when the application's known server port is narrow.

The two controls are not substitutes. A packet crossing a subnet boundary may need to satisfy the applicable NACL and then the destination interface's security groups. Return traffic must also satisfy the stateless NACL directions, even though security-group state recognizes the conversation.

### How Do Stateful Security Groups Work?
<!-- section-summary: Security groups are resource-level allowlists that automatically recognize return traffic for allowed connections. -->

A security group is logically attached to an **elastic network interface**, or ENI. That interface can belong to EC2, a load balancer, an RDS database, or another VPC resource.

```text
network → security group → ENI → resource and application
```

Suppose an EC2 instance at `10.0.2.10` has this inbound permission:

```text
TCP 443 from 0.0.0.0/0
```

For a new packet from `203.0.113.50:53124` to `10.0.2.10:443`, the group checks the protocol, destination port, and allowed source. If the packet matches, the connection can pass this layer.

Security groups are **allowlists**. They do not contain explicit deny rules. If no allow rule matches, traffic is not allowed.

```text
Inbound permissions:
443 from 0.0.0.0/0
22  from 10.20.0.0/16

Internet → 443          allowed
10.20.0.0/16 → 22       allowed
Internet → 22           not allowed
Internet → 3306         not allowed
```

No `DENY everything else` rule is needed. The absence of a matching allow has that effect.

Now the server replies:

```text
10.0.2.10:443 → 203.0.113.50:53124
```

The security group recognizes this as return traffic for the connection it admitted. You do not need to add a broad outbound rule for `1024-65535` merely so that the HTTPS server can answer this inbound flow. That memory of the conversation is what **stateful** means in this context.

For a new connection initiated by an application, reason about the initiator's outbound permission and the destination's inbound permission:

```text
initiator
  └── outbound security-group permission
       ↓ network
destination
  └── inbound security-group permission

return traffic
  └── recognized as part of the allowed conversation
```

If several security groups attach to one ENI, their allow permissions combine. One group cannot override another group's allow with a deny because security groups have no deny rules.

## Why Are Security Group References Useful?
<!-- section-summary: Referencing a source security group expresses workload identity and survives changing resource addresses. -->

Consider a three-tier service:

```text
Internet
  ↓ TCP 443
load balancer, SG: alb-sg
  ↓ TCP 8080
application, SG: app-sg
  ↓ TCP 5432
PostgreSQL, SG: db-sg
```

A clean inbound design is:

| Security group | Inbound permission |
|---|---|
| `alb-sg` | TCP `443` from internet clients |
| `app-sg` | TCP `8080` from `alb-sg` |
| `db-sg` | TCP `5432` from `app-sg` |

The application rule does not say, "Allow everything in `10.0.1.0/24`." It says that network interfaces associated with the load-balancer security group may connect on `8080`. The database rule says the application group may use PostgreSQL rather than trusting every resource that happens to occupy an app subnet.

![The app rule map shows the intended ALB-to-API-to-database path and where each security group rule belongs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/alb-api-db-rules.png)

*Security-group references make the packet permissions follow application relationships rather than changing IP addresses.*

This keeps the network design meaningful when instances are replaced or scale horizontally. New application interfaces receive `app-sg`, so the existing database rule recognizes them without an updated list of IP addresses.

References also communicate intent. `db-sg: allow 5432 from app-sg` reads as "the application may talk to the database." A broad CIDR says only that an address inside a range may talk to the database, regardless of that resource's role.

These relationships are not transitive. The internet may reach the ALB, and the ALB may reach the app. That does not imply that the internet may reach the app. Each hop is a separate connection and must satisfy its own route and rules.

When inspecting an app-to-database failure, write the actual flow:

```text
10.0.2.15:41722 → 10.0.3.20:5432
```

Find the security groups protecting the database ENI and look for TCP `5432` from `app-sg`. The stateful reply from database port `5432` to client port `41722` does not require a separate inbound rule on the application security group for `41722`.

## How Do Stateless NACLs Work?
<!-- section-summary: A NACL applies to every resource in a subnet and evaluates inbound and outbound packets independently. -->

A **network ACL** surrounds a subnet rather than an individual network interface:

```text
network → NACL boundary → subnet → resource ENIs
```

Every resource in that subnet is subject to the subnet's NACL. The NACL does not remember connections. It evaluates each packet from its fields and direction.

Return to the HTTPS flow. An inbound NACL rule permits:

```text
TCP destination 443 from 0.0.0.0/0
```

The request to the server can cross the inbound subnet boundary. The response has different endpoints:

```text
10.0.2.10:443 → 203.0.113.50:53124
```

A security group recognizes it as a reply. A NACL evaluates it from the beginning. The outbound NACL must permit a destination port of `53124`, not `443`.

This independent handling applies on every subnet boundary involved. A request from a load balancer subnet to an app subnet can encounter outbound rules on the source subnet and inbound rules on the destination subnet. Its response reverses those directions and ports.

Because a NACL affects an entire subnet, one narrow-looking change can affect many resources. That makes it suitable for broad network guardrails but less convenient for dynamic application identity.

## Why Do NACLs Need Ephemeral-Port Rules?
<!-- section-summary: Clients use temporary source ports, so stateless return paths must allow those ports in the reverse NACL direction. -->

Servers use well-known ports so clients know where to connect: HTTPS uses `443`, SSH commonly uses `22`, and DNS commonly uses `53`. A client does not need a famous source port for a temporary connection. Its operating system selects a high-numbered **ephemeral port**.

A client can hold several connections at once:

```text
203.0.113.50:53124 → google.com:443
203.0.113.50:53125 → aws.amazon.com:443
203.0.113.50:53126 → github.com:443
```

Those source ports help the client distinguish conversations.

For an inbound-initiated connection:

```text
Client:53124 → Server:443
```

the server subnet needs inbound permission for destination `443`. The reply is:

```text
Server:443 → Client:53124
```

so the same stateless NACL needs outbound permission for the client's ephemeral destination port.

For a connection initiated by an application server, the directions reverse:

```text
App:42871 → external API:443
```

The app subnet NACL needs outbound permission for destination `443`. The response is:

```text
external API:443 → App:42871
```

so the app subnet needs inbound permission for the ephemeral destination port `42871`.

The reusable rule is:

```text
Inbound-initiated connection:
  inbound  → server port
  outbound → client ephemeral port

Outbound-initiated connection:
  outbound → server port
  inbound  → client ephemeral port
```

There is no one universal ephemeral range for every operating system and AWS component. Common modern ranges include `32768-60999` and `49152-65535`, while some AWS patterns require a broader range. This is why examples often permit roughly `1024-65535` at the NACL layer where arbitrary clients or infrastructure need return traffic.

That range can look alarmingly broad, but the layers still restrict one another:

```text
NACL: permits broad network return range
Security group: permits app port 8080 only from alb-sg
Application: listens only on 8080
```

Permitting return packet ranges at a stateless boundary does not automatically publish an application on all of those ports.

## How Do Ordered Allow and Deny Rules Work?
<!-- section-summary: A NACL chooses the lowest numbered matching rule and can explicitly deny traffic before a broader allow. -->

Unlike security groups, NACLs contain both `ALLOW` and `DENY` actions. Their rule numbers determine evaluation order.

Consider:

| Rule | Source | Port | Action |
|---:|---|---:|---|
| 100 | `198.51.100.7/32` | all | DENY |
| 200 | `0.0.0.0/0` | `443` | ALLOW |
| `*` | everything else | all | DENY |

A TCP `443` packet from `198.51.100.7` matches both the narrow deny and the broad allow. AWS processes the lower rule number first, rule `100` denies the packet, and evaluation stops.

Rule ordering makes emergency coarse blocks possible, but it can also create subtle mistakes. A broad allow at rule `100` makes a more-specific deny at rule `200` ineffective for matching packets because the earlier allow has already won.

Keep numbering gaps so future rules can be inserted deliberately. More importantly, read a NACL in numerical order rather than grouping it mentally by allow and deny.

### How Should Security Groups and NACLs Share the Job?
<!-- section-summary: Use NACLs for coarse subnet boundaries and security groups for precise resource-to-resource relationships. -->

Trying to reproduce the entire application policy in NACLs quickly becomes fragile. A precise three-tier system would need to account for:

- ALB-to-app traffic on `8080` and its ephemeral return path;
- app-to-database traffic on `5432` and its ephemeral return path;
- outbound app calls to HTTPS APIs and their inbound ephemeral responses;
- DNS, package repositories, monitoring, and other dependencies; and
- every source and destination subnet CIDR involved.

NACLs cannot express `alb-sg`, `app-sg`, or `db-sg`; they work with packet fields and CIDRs. Their stateless nature requires mirrored direction thinking. A detailed policy becomes a maze that is easy to break.

A more useful division is:

```text
NACL
  → coarse subnet boundary and exceptional deny guardrails

Security group
  → precise resource and application relationships
```

For example, an app-subnet NACL can permit required internal ranges and return traffic. `app-sg` still allows TCP `8080` only from `alb-sg`, and `db-sg` allows `5432` only from `app-sg`.

Trace the ALB-to-app connection:

```text
10.0.1.20:45217 → 10.0.2.15:8080
```

The route must reach the app subnet. The app-subnet NACL must allow inbound TCP destination `8080`. The app security group must allow TCP `8080` from `alb-sg`. The application must listen on `8080`.

The response is:

```text
10.0.2.15:8080 → 10.0.1.20:45217
```

The security group recognizes return traffic. The NACL evaluates it independently, so the app subnet's outbound rules must permit the destination ephemeral port.

The route/security combinations make failure categories visible:

| Route | Security | Meaning |
|---|---|---|
| present | permitted | Packet can potentially reach the destination |
| present | blocked | Correct road, rejected by filtering |
| missing | permitted | Security would allow it, but no path exists |
| missing | blocked | Neither reachable nor permitted |

Changing a security group cannot fix missing NAT, IGW, peering, transit, or VPN routing. Adding a route cannot fix a blocked security group or NACL. Refusing to collapse reachability and permission into one problem makes troubleshooting much faster.

## How Do Flow Logs Help Explain a Failure?
<!-- section-summary: VPC Flow Logs show packet metadata and an ACCEPT or REJECT outcome that can be correlated with routes and filtering rules. -->

Diagrams and policy configuration show intended behavior. **VPC Flow Logs** provide evidence about traffic AWS networking observed.

A record can include:

```text
source address       10.0.1.20
source port          45217
destination address  10.0.2.15
destination port     8080
protocol             6
action               ACCEPT
```

or it may report `REJECT`.

This answers useful packet questions: Did AWS observe the flow? Which addresses and ports did it see? Was the traffic accepted or rejected at the captured VPC layer?

The data can correct a mistaken assumption. A reviewer may believe the load balancer connects to the app on `443`, while the flow shows destination `8080`. A rejected response flow from `10.0.2.15:8080` to `10.0.1.20:45217` points attention toward a stateless NACL and ephemeral-port return handling.

Flow Logs do not contain application payloads. A `REJECT` also does not name the exact rule that caused it. Correlate the record with the source and destination security groups, subnet NACLs, routes, and intended architecture. An `ACCEPT` does not prove the application succeeded; the process can still be stopped, reject authentication, or fail after the network delivers the packet.

![The packet checklist turns security group, NACL, route, DNS, and Flow Logs evidence into a repeatable access review](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/packet-control-checklist.png)

*Flow metadata confirms the actual endpoint and direction so the relevant route, NACL, security group, and listener can be checked together.*

## How Do You Troubleshoot a Packet Path?
<!-- section-summary: A reliable investigation writes the exact flow and checks route, source egress, destination ingress, both NACL directions, listener, and observed evidence. -->

When A cannot connect to B, do not begin by opening more ports. Follow one packet.

1. Write the exact new connection as `source-IP:source-port → destination-IP:destination-port`.
2. Identify which side initiates the connection and which destination port the server is expected to use.
3. Verify the route from A to B and a viable return path.
4. Check A's outbound security-group permission for the new connection.
5. Check B's inbound security-group permission.
6. Check the NACL on A's subnet in the outbound and return-inbound directions.
7. Check the NACL on B's subnet in the inbound and return-outbound directions.
8. Remember that the response's destination is usually the client's ephemeral port.
9. Verify that B listens on the expected address and port.
10. Use Flow Logs or related diagnostics to confirm which flow AWS accepted or rejected.

The complete mental model is:

```text
ROUTE TABLE
Where does the packet go?
        ↓
NACL
May this individual packet cross the subnet boundary?
Stateless, ordered, allow and deny
        ↓
SECURITY GROUP
May this resource start or accept the conversation?
Stateful, allow only, no ordering
        ↓
APPLICATION
Is anything listening and willing to respond?
```

For TCP:

```text
Client:E → Server:443
Client:E ← Server:443

E = ephemeral client port
```

The security group understands that the two directions belong to one conversation. The NACL does not. That is why inbound HTTPS through a security group automatically permits its return traffic, while a NACL needs inbound `443` plus outbound ephemeral destinations. For an app-initiated HTTPS request, the NACL needs outbound `443` plus inbound ephemeral destinations.

These rules are not arbitrary AWS details. They follow directly from how client and server ports create two-direction packet flows.

## Check Your Answers
<!-- section-summary: Test the state, boundary, rule, identity-reference, ephemeral-port, and evidence distinctions. -->

:::expand[What Must Happen to One Packet?]{kind="recap"}
A working connection needs a route, filtering permission in both relevant directions, and a listening destination service.

Routing selects a path or next hop for the destination. Filtering decides whether the packet may use that path. A working connection needs both, plus a valid return path and a listening destination.
:::

:::expand[How Are Security Groups Different From NACLs?]{kind="recap"}
Security groups protect resource interfaces with stateful allow rules, while NACLs protect subnet boundaries with ordered stateless allow and deny rules.

Security groups are resource-level allowlists that automatically recognize return traffic for allowed connections.

After the group allows a new connection, it recognizes response traffic as part of the same conversation. Separate broad rules are not required merely to allow the return direction of that connection.

No. Internet-to-ALB and ALB-to-app are separate allowed connections. The first does not imply direct internet-to-app access; every hop satisfies its own rules.
:::

:::expand[Why Are Security Group References Useful?]{kind="recap"}
Referencing a source security group expresses workload identity and survives changing resource addresses.

The reference follows workload membership and states intent, such as "the app group may reach the database." It survives changing IP addresses and avoids trusting unrelated resources that happen to share a subnet.
:::

:::expand[How Do Stateless NACLs Work?]{kind="recap"}
A NACL applies to every resource in a subnet and evaluates inbound and outbound packets independently.

The NACL does not remember a connection. It evaluates request and response packets independently according to their direction, addresses, protocol, and ports.
:::

:::expand[Why Do NACLs Need Ephemeral-Port Rules?]{kind="recap"}
Clients use temporary source ports, so stateless return paths must allow those ports in the reverse NACL direction.

The request's destination is server port `443`, but the response's destination is the client's temporary source port. The stateless outbound evaluation must permit that ephemeral destination.
:::

:::expand[How Do Ordered Allow and Deny Rules Work?]{kind="recap"}
A NACL chooses the lowest numbered matching rule and can explicitly deny traffic before a broader allow.

They contain allow rules but no explicit deny rules or rule order. Traffic without a matching allow is not permitted, and permissions from multiple groups attached to an ENI combine.

The lowest numbered matching rule wins, and evaluation stops. A narrow deny must have a lower number than a broad matching allow if it is intended to take effect.

Use NACLs for coarse subnet boundaries and security groups for precise resource-to-resource relationships.

Security groups protect ENIs and their resources. A NACL protects a subnet boundary and affects every resource using that subnet.

Detailed application policy creates many mirrored return-path and ephemeral-port rules, while NACLs cannot use application-oriented security-group identities. Security groups express precise workload relationships more safely.
:::

:::expand[How Do Flow Logs Help Explain a Failure?]{kind="recap"}
VPC Flow Logs show packet metadata and an ACCEPT or REJECT outcome that can be correlated with routes and filtering rules.

It can show that AWS observed a flow with specific source and destination addresses, ports, protocol, and an ACCEPT or REJECT result. It does not contain the payload or automatically identify the exact misconfigured rule.
:::

:::expand[How Do You Troubleshoot a Packet Path?]{kind="recap"}
A reliable investigation writes the exact flow and checks route, source egress, destination ingress, both NACL directions, listener, and observed evidence.

Write the exact flow, prove routing and return routing, check source outbound and destination inbound security groups, evaluate every involved NACL direction including ephemeral returns, verify the listener, and correlate Flow Logs.
:::

## References

- [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) - Introduces resource-level VPC security groups.
- [Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html) - Documents stateful allow behavior, references, and rule components.
- [Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - Introduces subnet-level stateless packet filtering.
- [Network ACL rules](https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html) - Explains ordered allow and deny processing.
- [Network ACLs for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html) - Provides guidance on return traffic and ephemeral ports.
- [VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html) - Describes captured IP-flow metadata and ACCEPT or REJECT actions.

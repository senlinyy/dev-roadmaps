---
title: "Network Security Groups"
description: "Use Azure network security groups, rule priority, default rules, application security groups, and effective rules to control packet flows."
overview: "A VNet topology gives packets a possible path. Network security groups decide which new flows may use that path, while application security groups make rules describe workload roles instead of brittle private IP lists."
tags: ["azure", "nsg", "asg", "packet-rules"]
order: 2
id: article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups
aliases:
  - network-security-groups-and-application-security-groups
  - cloud-providers/azure/networking-connectivity/network-security-groups-and-application-security-groups.md
---

## Table of Contents

1. [The Packet Path](#the-packet-path)
2. [Network Security Groups](#network-security-groups)
3. [Rule Shape](#rule-shape)
4. [Priority](#priority)
5. [Default Rules](#default-rules)
6. [Stateful Flow](#stateful-flow)
7. [Subnet And NIC NSGs](#subnet-and-nic-nsgs)
8. [Application Security Groups](#application-security-groups)
9. [Effective Rules](#effective-rules)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Packet Path

The previous article built the Azure network shape: a VNet, subnets, route tables, and an outbound path. That topology says where packets can go next. It does not say which packets are allowed.

For `orders-api`, the intended private path is small:

```text
Application Gateway -> orders API -> Azure SQL private endpoint
```

The route table can make that path possible. Network security groups decide whether a new flow may cross it. The gateway still needs permission to talk to the API. The API still needs permission to talk to SQL. The SQL private endpoint should not accept random traffic just because it has an address inside the VNet.

This article follows the packet rule, not the HTTP route or user session. An NSG does not know whether the request path is `/orders` or `/admin`. It sees source, destination, port, protocol, direction, and priority.

## Network Security Groups

A network security group, or NSG, is a set of security rules that allow or deny network traffic. You can associate an NSG with a subnet, a network interface, or both, depending on the resource type and design.

Read an NSG as a packet checkpoint. When a new flow tries to pass, Azure evaluates the applicable rules and returns allow or deny. If the packet is denied, app code never sees it. The process can be healthy and the listener can be open, but the connection still times out before the application receives a byte.

The first useful habit is to write the packet sentence:

```text
Direction: inbound to orders API
Source: Application Gateway subnet or ASG
Destination: orders API ASG
Protocol: TCP
Destination port: 443
Expected result: allow
```

Notice the destination port. That is where the API listens. Beginners often put the listener port in the source port field. Normal clients use ephemeral source ports, so that rule does not match the traffic they meant to allow.

## Rule Shape

An NSG rule has a source, source port, destination, destination port, protocol, direction, priority, and access result. The access result is `Allow` or `Deny`.

For the orders API, a readable rule looks like this:

| Field | Value |
| --- | --- |
| Direction | Inbound |
| Source | `asg-app-gateway` |
| Source port | `*` |
| Destination | `asg-orders-api` |
| Destination port | `443` |
| Protocol | TCP |
| Access | Allow |
| Priority | `100` |

The rule is about a network flow, not about app permission. It lets the gateway open a TCP connection to the API. It does not prove the user is signed in. It does not prove the API is healthy. It does not grant the API permission to read Key Vault.

That separation is useful. When a request fails, you can ask whether the packet passed the network rule before you debug identity, secrets, routes, or app code.

## Priority

Azure evaluates NSG rules by priority number. Lower numbers are evaluated first. When a rule matches, Azure uses that rule's allow or deny result and stops looking for a later rule.

That means priority is part of the rule's meaning. A specific allow at priority `100` can permit gateway traffic before a broader deny at `400`. A broad deny at priority `100` can block a later allow that looks correct on its own.

For example:

| Priority | Rule | Result |
| --- | --- | --- |
| `100` | Allow `asg-app-gateway` to `asg-orders-api` on TCP `443` | Gateway traffic can reach the API. |
| `200` | Allow `asg-orders-api` to SQL private endpoint on TCP `1433` | API can reach SQL. |
| `400` | Deny internet to `asg-orders-api` | Direct public traffic stays blocked. |

The table is ordered for a reason. If the deny moves above the allow and matches the same packet, the allow never gets a chance.

## Default Rules

NSGs include default security rules. Those defaults are not empty background noise. They already allow some VNet traffic, allow Azure load balancer traffic, and deny inbound internet traffic. They also allow outbound internet traffic unless you create stricter outbound rules.

This surprises teams that assume a new NSG starts as a blank firewall. A workload may already be able to talk to other resources in the same VNet because of default virtual-network rules. If you need a stricter boundary between application tiers, you may need explicit deny and allow rules with the right priority.

For `orders-api`, the review should answer:

```text
Do we depend on default VNet allow rules?
Which explicit rules describe intended app flows?
Which broad flows are denied before they become accidental access?
```

Defaults make simple networks easy. Production reviews should still name the flows the app needs.

## Stateful Flow

NSGs are stateful. If an inbound connection is allowed, return traffic for that connection is allowed automatically. You do not create a separate inbound rule for every response packet in the reverse direction.

Stateful does not mean careless. The initial flow still needs to match an allow rule. If the API initiates a connection to SQL, the outbound flow from the API must be allowed. SQL's response follows the established flow. If the gateway initiates a connection to the API, the inbound flow to the API must be allowed.

The practical question is:

```text
Who starts the connection?
```

That answer tells you whether to inspect inbound rules, outbound rules, or both. It also prevents a common mistake: opening inbound traffic to fix a problem where the workload is actually initiating outbound traffic.

## Subnet And NIC NSGs

An NSG can apply at a subnet and, for some resources, at a network interface. When both apply, both layers matter. A packet has to be allowed by the effective combination of rules on the path.

Use subnet NSGs for broad placement boundaries. Use NIC-level NSGs sparingly when a specific resource needs additional rules. Too many one-off NIC rules make reviews difficult because the subnet's apparent policy no longer tells the full story.

For the orders topology, the cleaner model is:

| Layer | Job |
| --- | --- |
| `snet-public-entry` NSG | Allow gateway traffic patterns and required platform probes. |
| `snet-orders-api` NSG | Allow only approved entry and dependency flows. |
| `snet-private-endpoints` NSG | Keep private endpoint traffic narrow where supported and enabled. |

The key word is effective. The rule you meant to use is less important than the rule Azure actually applies after subnet and NIC policy are combined.

## Application Security Groups

An application security group, or ASG, lets you group network interfaces by application role and use that group in NSG rules. Instead of writing rules against private IP ranges that change or spread, you can write rules like `asg-app-gateway` to `asg-orders-api`.

That makes the rule read like the architecture:

```text
Allow app gateway to orders API on TCP 443.
Allow orders API to SQL private endpoint on TCP 1433.
Deny internet to orders API.
```

ASGs are not global labels. Network interfaces in an ASG must be in the same virtual network for the rule pattern to work. Treat ASGs as readable VNet-local grouping tools, not as cross-network identity.

ASGs are especially helpful when a subnet contains more than one role or when IP addresses are not the stable thing you want reviewers to reason about. The app role should be stable. The private IP behind it may change.

## Effective Rules

When packet behavior is surprising, inspect the effective security rules for the resource. Effective rules show what Azure is actually applying after subnet rules, NIC rules, default rules, and ASG membership are considered.

Good evidence names the flow and the matching rule:

```text
Flow:
  Source: asg-app-gateway
  Destination: asg-orders-api
  Port: TCP 443
Expected rule:
  AllowAppGatewayToApi priority 100
Unexpected blocker:
  DenyAllInbound or broader deny with lower priority number
```

That evidence is better than "NSG looks fine." It says which packet should match which rule. If the packet still fails, the next layer might be route, health probe, DNS, service firewall, or the application itself.

## Putting It All Together

Return to the private path:

```text
Application Gateway -> orders API -> Azure SQL private endpoint
```

The VNet and routes make the path possible. NSGs make the path permitted:

- Write the packet sentence before editing rules.
- Use destination ports for listeners and source ports for caller-side ephemeral ports.
- Remember that lower priority numbers win first.
- Read default rules instead of pretending the NSG starts empty.
- Use ASGs when the rule should describe application roles.
- Inspect effective rules when the behavior does not match the table.

The useful review sentence is now:

```text
Gateway traffic to orders API is allowed by priority 100, API traffic to SQL is allowed by priority 200, and direct internet traffic to the API role is denied.
```

That sentence is small enough to inspect.

## What's Next

The private packet path is now controlled. The next article moves to the public side: when users visit a hostname, which Azure entry point receives the request first?

---

**References**

- [Azure network security groups overview](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview)
- [Application security groups](https://learn.microsoft.com/en-us/azure/virtual-network/application-security-groups)

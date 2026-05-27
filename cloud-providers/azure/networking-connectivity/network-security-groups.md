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

1. [Packet Flow Filtering: The Network Security Group Checklist](#packet-flow-filtering-the-network-security-group-checklist)
2. [Network Security Groups: The Software-Defined Checkpoint](#network-security-groups-the-software-defined-checkpoint)
3. [Rule Shape](#rule-shape)
4. [Priority and Rule Evaluation](#priority-and-rule-evaluation)
5. [Default Rules](#default-rules)
6. [Under-the-Hood: Stateful Flow and Connection Tracking](#under-the-hood-stateful-flow-and-connection-tracking)
7. [The Dual-Evaluation Pipeline: Subnet and NIC NSGs](#the-dual-evaluation-pipeline-subnet-and-nic-nsgs)
8. [Application Security Groups: Logical Role Resolvers](#application-security-groups-logical-role-resolvers)
9. [Effective Rules: Resolving Conflict](#effective-rules-resolving-conflict)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Packet Flow Filtering: The Network Security Group Checklist

A Network Security Group (NSG) is a stateful packet filtering firewall that controls inbound and outbound network traffic flowing across subnets and individual virtual network interfaces.

To construct a resilient architecture, you must separate physical layout from traffic permissions. Designing a Virtual Network (VNet) topology with public and private subnets determines where resources *can* physically communicate. However, topology alone does not prevent traffic from crossing those boundaries. 

By default, subnets in the same VNet are fully routable to each other. If your database subnet and your public web servers share the same VNet space, the web servers can open sockets directly to your database interfaces, exposing your persistent data blocks to compromise.

Network Security Groups solve this vulnerability by establishing software-defined security checkpoints. An NSG does not look at high-level application headers, HTTP request paths (`/orders`), or user login session cookies. 

It functions at the network layer, inspecting every packet for six fundamental coordinates: direction, source address, source port, destination address, destination port, and protocol. If a packet matches a rule's criteria, the NSG returns an allow or deny decision, blocking unauthorized packets at the virtual switch level before they can reach your workload.

```mermaid
flowchart TD
    subgraph Subnet Boundary [snet-orders-api]
        direction TB
        SubnetNSG{"1. Subnet NSG<br/>(Evaluation Check)"}
    end

    subgraph Interface Boundary [app-orders-prod NIC]
        direction TB
        NicNSG{"2. NIC NSG<br/>(Evaluation Check)"}
        Workload["Workload App<br/>(orders-api)"]
    end

    InboundPacket["Inbound Network Packet"] --> SubnetNSG
    SubnetNSG --> |Allow| NicNSG
    SubnetNSG --> |Deny| RejectSubnet["Drop Packet (Timeout)"]
    NicNSG --> |Allow| Workload
    NicNSG --> |Deny| RejectNic["Drop Packet (Timeout)"]
```

## Network Security Groups: The Software-Defined Checkpoint

An NSG contains a list of prioritized security rules. You can associate a single NSG with an entire subnet, an individual Network Interface Card (NIC) attached to a virtual machine, or both. 

When you apply an NSG to `snet-orders-api`, the rules are not written inside the operating system of your virtual machines. They are injected directly into the hosting hypervisor's virtual switches.

This software-defined checkpoint design is incredibly performant and secure. When an unauthorized packet is sent to your workload, the hosting hypervisor drops the packet at the virtual switch level. 

Because the packet is discarded before the hypervisor ever interrupts the virtual machine's CPU, your application remains completely shielded from resource exhaustion attacks. From the client's perspective, the connection simply hangs and times out, with no TCP handshakes returned to indicate that the port is active.

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

The rule controls a network flow instead of app permission. It lets the gateway open a TCP connection to the API. User sign-in, API health, and Key Vault permissions are separate checks.

That separation is useful. When a request fails, you can ask whether the packet passed the network rule before you debug identity, secrets, routes, or app code.

## Priority and Rule Evaluation

Azure evaluates NSG rules in a strict, sequential order based on a priority number ranging from `100` to `65000`. Rules with lower priority numbers are processed first.

When a packet arrives at the virtual switch, the security controller walks the priority list from lowest to highest:

```text
Evaluating Inbound Packet:
  ├── Priority 100: Allow TCP 443 ──> Match! (Stop evaluation and ALLOW)
  ├── Priority 200: Allow TCP 1433 ── (Skipped)
  └── Priority 65000: Deny All Inbound ── (Skipped)
```

The moment a packet matches all parameters of a rule (such as matching the destination port and source IP), the evaluation loop **stops immediately**. Azure applies that rule's access decision (Allow or Deny) and discards the rest of the list.

Understanding this sequence is vital. A broad `Deny All` rule placed at priority `100` will block every single connection attempt, completely blinding any highly specific `Allow` rules defined at priority `500`. 

Conversely, a loose `Allow All` rule at priority `100` will bypass all security filters you attempt to place below it. When writing rules, always leave gaps between priority numbers (e.g. `100`, `110`, `120`) to allow room for future, highly specific rules.

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

## Under-the-Hood: Stateful Flow and Connection Tracking

A Network Security Group is a **stateful firewall**. This means that when a rule permits a connection to open, the NSG remembers that connection state and automatically permits all subsequent response traffic to flow in both directions.

To implement this, the hosting hypervisor utilizes a high-performance **Connection Tracking (`conntrack`) Engine** embedded inside its virtual switches:

```text
Inbound TCP SYN Packet ──> Evaluated by NSG Rules ──> Allowed ──> [conntrack Table Entry Created]
Outbound TCP ACK Packet ──> Queries conntrack Table ──> Matched! ──> Allowed (Bypasses Rules)
```

1.  **The Handshake Initiation**: When an ingress load balancer sends a TCP SYN packet to `orders-api` on port `443`, the hypervisor intercepts the packet. It walks the inbound NSG priority list, finds a matching `Allow` rule, and allows the packet to pass to your container.
2.  **State Entry Creation**: The moment the packet is allowed, the `conntrack` engine generates an ephemeral entry in its local flow state database. This entry records the connection coordinates: Source IP, Source Port, Destination IP, Destination Port, and Protocol.
3.  **The Stateful Return**: When the container app transmits a TCP SYN-ACK response packet back to the load balancer, the hypervisor intercepts the egress packet. Instead of walking the outbound NSG rules, the routing switch queries the `conntrack` table. Because the return coordinates match the active, established session entry, the hypervisor allows the packet to pass instantly, completely bypassing the outbound NSG rules.

This stateful behavior significantly improves performance and simplifies configuration. You do not need to create fragile outbound rules to allow ephemeral response traffic back to clients. Outbound NSG rules are only evaluated when your container **initiates** a new connection to an external target (such as calling a payment API).

## The Dual-Evaluation Pipeline: Subnet and NIC NSGs

When you associate an NSG with a subnet and also apply an NSG to an individual network interface (NIC), Azure processes packets through a strict **Dual-Evaluation Pipeline**.

This pipeline evaluates packets sequentially, and the order of evaluation depends entirely on the direction of the traffic:

```text
Inbound Flow:  [Subnet NSG] (Must Allow) ───> [NIC NSG] (Must Allow) ───> Container App
Outbound Flow: Container App ───> [NIC NSG] (Must Allow) ───> [Subnet NSG] (Must Allow)
```

### Inbound Request Evaluation
When an ingress packet arrives from the internet, Azure first processes the packet against the **Subnet-level NSG**. If the subnet rules allow the packet, it is then forwarded to the **NIC-level NSG**. 

The packet is allowed to reach your application **only if both independent checks return Allow**. If either layer denies the packet, the connection is dropped.

### Outbound Request Evaluation
When your container initiates an outbound connection, Azure reverses the sequence. The packet is first evaluated by the **NIC-level NSG**. 

If allowed, it is then processed by the **Subnet-level NSG**. The packet is allowed to leave the physical network only if both layers approve the flow.

This dual-layer evaluation is highly robust but can lead to complex routing blocks. If you deploy an VM and its NIC NSG allows database traffic on port `1433`, but the parent subnet's NSG blocks all outbound database ports, the traffic is dropped. To maintain a clean architecture and prevent diagnostic confusion, prefer placing security controls at the **Subnet scope**, utilizing NIC-level NSGs strictly as exceptional overrides.

## Application Security Groups: Logical Role Resolvers

An Application Security Group (ASG) is a logical grouping resource that allows you to write NSG rules using workload roles rather than fragile, hardcoded IP address blocks.

In traditional datacenter networks, if your web servers need to connect to your database servers, you must write firewall rules listing the exact IP addresses of every database node (e.g. allow `10.30.2.4`, `10.30.2.5`, `10.30.2.6`). If your database cluster autoscales and provisions a fourth node, your firewall rules instantly break until an operator manually adds the new IP.

Application Security Groups solve this maintenance overhead by acting as logical role resolvers. You create an ASG (such as `asg-orders-api` and `asg-orders-sql`) and bind the network interfaces of your resources to these groups. 

At deployment time, the Azure software-defined network controller automatically resolves the ASGs into a dynamic list of network card Object IDs inside the virtual switches. 

This enables you to write clean, architectural rules inside your NSG:

```text
Allow Inbound: Source: asg-orders-api ── Destination: asg-orders-sql ── Port: TCP 1433
```

If your database cluster scales out, the new node's network interface automatically binds to the `asg-orders-sql` group. The SDN controller updates the hypervisor's lookup tables instantly. Your firewall rules remain untouched, and the new node inherits the security permissions seamlessly, keeping your operations fully automated.

## Effective Rules: Resolving Conflict

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

Operating a secure virtual network requires managing packet flows through the prioritized gates of Azure NSGs:

*   **Rely on Stateful Flow**: Leverage the connection tracking (`conntrack`) engine to manage ephemeral return traffic automatically, focusing rules on connection initiations.
*   **Audit the Dual-Evaluation Pipeline**: Understand that packets must pass both Subnet-level and NIC-level NSGs, resolving rules at the Subnet scope by default.
*   **Decouple IPs with ASGs**: Group network cards logically by application role, allowing firewall rules to scale seamlessly without manual IP adjustments.
*   **Manage Priority Hierarchies**: Sequence rules intentionally, leaving gaps between priority numbers to allow room for future, highly specific filters.
*   **Inspect Effective Rules**: Run CLI diagnostics to verify the final compiled rule set that Azure applies to the network interfaces, eliminating diagnostic ambiguity during outages.

## What's Next

The private packet path is now controlled. The next article moves to the public side: when users visit a hostname, which Azure entry point receives the request first?

---

**References**

* [Azure Network Security Groups Overview](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview) - Physical and logical architecture of NSG switches.
* [How Network Security Groups work](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works) - Stateful conntrack engine and rule processing logs.
* [Application Security Groups Guide](https://learn.microsoft.com/en-us/azure/virtual-network/application-security-groups) - Logical role groupings for automated scaling networks.

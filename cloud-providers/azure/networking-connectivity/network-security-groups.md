---
title: "Network Security Groups"
description: "Use Azure network security groups, rule priority, default rules, application security groups, service tags, and effective rules to control packet flows."
overview: "A VNet gives workloads a private place to live. Network security groups decide which packet flows can cross subnet and network interface boundaries, while application security groups and service tags keep those rules readable as the environment grows."
tags: ["azure", "nsg", "asg", "packet-rules"]
order: 2
id: article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups
aliases:
  - network-security-groups-and-application-security-groups
  - cloud-providers/azure/networking-connectivity/network-security-groups-and-application-security-groups.md
---

## Table of Contents

1. [The Packet Story](#the-packet-story)
2. [What an NSG Controls](#what-an-nsg-controls)
3. [Where NSGs Attach](#where-nsgs-attach)
4. [Rule Shape](#rule-shape)
5. [Priority and First Match](#priority-and-first-match)
6. [Default Rules](#default-rules)
7. [Stateful Flows](#stateful-flows)
8. [Application Security Groups](#application-security-groups)
9. [Service Tags and Augmented Rules](#service-tags-and-augmented-rules)
10. [Outbound Rules](#outbound-rules)
11. [Effective Rules and IP Flow Verify](#effective-rules-and-ip-flow-verify)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Packet Story
<!-- section-summary: This article follows one Orders API network path so packet rules, subnet boundaries, NIC checks, ASGs, service tags, outbound traffic, and troubleshooting evidence stay connected. -->

In the previous Azure networking article, the Orders team placed `orders-api-prod` inside `vnet-devpolaris-prod`. The VNet gave the workload a private address space, and subnets gave different parts of the system their own areas: `snet-public-entry`, `snet-orders-api`, `snet-private-endpoints`, and `AzureFirewallSubnet`.

That placement gives packets a possible path. It still leaves an important security question unanswered: which packets should the network allow through? The public entry layer should reach the API on HTTPS, the API should reach Azure SQL through a private endpoint, and the database path should stay reserved for the workloads that actually need it.

A **Network Security Group**, usually shortened to **NSG**, answers that packet permission question. An NSG is Azure's basic stateful packet filtering firewall for resources in a virtual network. It uses rules to allow or deny inbound and outbound traffic based on the packet's source, destination, port, protocol, and direction.

If you know AWS, an NSG sits between the habits of security groups and network ACLs. It is stateful like a security group, but it uses ordered allow and deny rules and can attach at subnet or network-interface level, so always check the association point and rule priority during troubleshooting.

Here is the path we will keep using through the article. Users reach the public entry layer first, the entry layer forwards approved HTTPS traffic to the Orders API, and the API calls the database through a private endpoint. The NSGs sit on subnet and network interface boundaries so each new flow has to match the rule list before it reaches the workload.

![Azure NSG packet path through public entry, Orders API, and SQL private endpoint](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups/nsg-packet-path.png)

*The packet path starts with routing, then each NSG checkpoint decides whether the flow can keep moving toward the workload.*

This article builds the whole chain in plain steps. First we define what an NSG can see, then where you attach one, then how a rule is shaped, then how Azure chooses a winning rule. After that, we use default rules, stateful flows, application security groups, service tags, outbound rules, and effective security evidence to make the production design readable.

## What an NSG Controls
<!-- section-summary: An NSG controls network flows by matching packet details, while identity, HTTP routing, TLS, and app authorization belong to other controls. -->

A **packet** is a small unit of network data moving from one address to another. A **flow** is the conversation those packets belong to, such as a TCP connection from Application Gateway to `orders-api-prod` on port `443`. When people say an NSG allows traffic, they usually mean the NSG allows a new flow that matches a rule.

An NSG looks at five main packet facts: **source IP and port**, **destination IP and port**, and **protocol**. Microsoft often calls this the **five-tuple**. Direction matters too, because an inbound rule and an outbound rule answer different questions even when the addresses and ports look similar.

For the Orders API, an inbound flow from Application Gateway to the API has a few concrete coordinates. These names are the same kind of facts you read during a real packet review:

| Packet detail | Example value | What it means |
|---|---|---|
| Source | `10.30.1.10` | The private IP of the entry component that starts the connection. |
| Source port | `49152` | A temporary client port chosen by the sender. |
| Destination | `10.30.2.20` | The private IP of `orders-api-prod`. |
| Destination port | `443` | The HTTPS listener on the API. |
| Protocol | `TCP` | The transport protocol used by HTTPS. |
| Direction | `Inbound` | The flow enters the API side of the boundary. |

That is the level where NSGs work. They decide whether a TCP flow to port `443`, a SQL flow to port `1433`, or an SSH flow to port `22` can pass. For user identity, Microsoft Entra ID and application authorization handle the signed-in person. For HTTP paths like `/orders/123`, Application Gateway, Front Door, WAF, or the application handles the request details.

This separation helps during production debugging. If `orders-api-prod` returns `403 Forbidden`, the network probably delivered the request and the application rejected it. If the browser hangs until timeout, or a database connection never opens, the team should check routing, DNS, private endpoints, NSG rules, and firewall paths before spending hours inside application code.

## Where NSGs Attach
<!-- section-summary: An NSG can attach to a subnet, a network interface, or both, and the attachment point decides which resources share the same packet rules. -->

An **NSG attachment** is the place where Azure applies the rule list. You can attach an NSG to a **subnet**, which means the rules apply to resources in that subnet. You can also attach an NSG to a **network interface**, usually called a **NIC**, which means the rules apply to traffic through that specific interface.

For most production designs, subnet-level NSGs carry the main policy because the subnet already represents a workload role. `snet-orders-api` gets `nsg-orders-api`, `snet-private-endpoints` gets `nsg-private-endpoints`, and `snet-public-entry` gets `nsg-public-entry`. This keeps the rule story aligned with the VNet design from the previous article.

NIC-level NSGs add a second checkpoint for special cases. Suppose the Orders team has one legacy VM in the API subnet that needs a temporary SSH rule from Azure Bastion, while the regular API instances keep SSH closed. A NIC-level NSG can make that one VM stricter or more specific while the shared subnet policy stays stable.

When both subnet and NIC NSGs exist, Azure evaluates both. For inbound traffic, Azure checks the subnet NSG first, then the NIC NSG. For outbound traffic, Azure checks the NIC NSG first, then the subnet NSG. A flow needs permission from every NSG in the path, so one deny at either checkpoint stops the flow.

![Inbound and outbound Azure NSG evaluation with subnet and NIC checkpoints](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups/subnet-nic-checkpoints.png)

*Inbound traffic reaches the subnet NSG first, outbound traffic reaches the NIC NSG first, and a deny at either checkpoint stops the flow.*

This dual-check behavior explains a very common support ticket. The subnet NSG allows port `443`, but a NIC NSG still blocks it. The developer sees one allow rule and keeps looking in the wrong place, while Azure sees two rule lists and requires both of them to allow the flow.

## Rule Shape
<!-- section-summary: An NSG rule is a packet match record with source, destination, ports, protocol, direction, action, and priority. -->

An **NSG rule** is one packet match record. It says which source can reach which destination, over which protocol and port, in which direction, and whether Azure should allow or deny that matching traffic. The rule also has a priority number, which decides when Azure checks it.

The Orders API needs a rule that lets the public entry subnet reach the API on HTTPS. The rule should describe the source subnet, the destination role, the destination port, and the protocol. The source port usually stays as `*` because clients choose temporary source ports during normal TCP connections.

| Field | Orders API value | Why it matters |
|---|---|---|
| Name | `allow-entry-to-orders-api-https` | Names the reason for the rule. |
| Direction | `Inbound` | Controls traffic entering the API subnet or NIC. |
| Source | `10.30.1.0/24` | Limits the caller to `snet-public-entry`. |
| Source port | `*` | Accepts normal temporary client ports. |
| Destination | `asg-orders-api` | Targets only the API workload role. |
| Destination port | `443` | Allows HTTPS to the API listener. |
| Protocol | `TCP` | Matches the protocol used by HTTPS. |
| Action | `Allow` | Lets matching packets create a flow. |
| Priority | `100` | Evaluates before broader deny rules. |

Here is the same idea as Azure CLI commands. This example creates a subnet-level NSG and adds one inbound HTTPS rule. The destination ASG appears later in the article, so for now read it as a role name for the API network interfaces.

```bash
az network nsg create \
  --resource-group rg-devpolaris-network-prod \
  --name nsg-orders-api \
  --location uksouth

az network nsg rule create \
  --resource-group rg-devpolaris-network-prod \
  --nsg-name nsg-orders-api \
  --name allow-entry-to-orders-api-https \
  --priority 100 \
  --direction Inbound \
  --access Allow \
  --protocol Tcp \
  --source-address-prefixes 10.30.1.0/24 \
  --source-port-ranges '*' \
  --destination-asgs asg-orders-api \
  --destination-port-ranges 443
```

The rule controls network reachability. If a user lacks permission to place an order, the API still rejects the request after the packet arrives. Application trust belongs to app authorization, while the NSG answers whether the entry component can open the TCP connection to the API port.

Verify the rule after creating it. The important fields are the priority, source prefix, destination role, port, and action, because those fields decide whether the entry component can start the flow.

```bash
az network nsg rule show \
  --resource-group rg-devpolaris-network-prod \
  --nsg-name nsg-orders-api \
  --name allow-entry-to-orders-api-https \
  --query "{priority:priority,direction:direction,access:access,source:sourceAddressPrefixes,destinationAsgs:destinationApplicationSecurityGroups[].id,ports:destinationPortRanges}"
```

Example output:

```json
{
  "priority": 100,
  "direction": "Inbound",
  "access": "Allow",
  "source": ["10.30.1.0/24"],
  "destinationAsgs": [
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationSecurityGroups/asg-orders-api"
  ],
  "ports": ["443"]
}
```

Healthy output proves the rule is narrow and points at the application role. A suspicious result would use source `*`, destination `*`, or a priority that sits below a broad deny rule.

## Priority and First Match
<!-- section-summary: Azure checks custom NSG rules from lower priority number to higher priority number, and the first matching rule wins. -->

**Priority** is the ordering number on an NSG rule. Custom NSG rule priorities use numbers from `100` through `4096`, and lower numbers run first. Azure requires each rule priority to be unique within the same direction, so two inbound rules in one NSG cannot both use priority `100`.

Azure stops as soon as a packet matches a rule. If `allow-entry-to-orders-api-https` at priority `100` matches the packet, Azure applies that allow decision and skips the rest of the inbound list. If a broader deny rule at priority `200` also could have matched, it never gets a turn for that packet.

This is why rule order deserves careful naming and spacing. The Orders team can use `100`, `110`, and `120` for specific allows, then `4000` or `4096` for a broad deny that closes the remaining space. Leaving gaps gives the team room to add a new rule later without renumbering the whole NSG.

| Priority | Name | Source | Destination | Port | Action |
|---:|---|---|---|---:|---|
| `100` | `allow-entry-to-orders-api-https` | `10.30.1.0/24` | `asg-orders-api` | `443` | Allow |
| `110` | `allow-bastion-to-orders-admin` | `AzureBastionSubnet prefix` | `asg-orders-api` | `22` | Allow |
| `200` | `allow-orders-api-to-sql-pe` | `asg-orders-api` | `10.30.40.7` | `1433` | Allow |
| `4096` | `deny-api-inbound-remaining` | `*` | `*` | `*` | Deny |

![Azure NSG priority ladder showing first matching custom rule before default rules](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups/priority-ladder.png)

*The packet stops at the first matching rule, so specific custom rules need to sit above broad deny rules and far above Azure's defaults.*

A rule table like this reads like a production review. First, the expected entry traffic can reach the API. Second, the controlled admin path can reach the VM when that VM exists. Third, the API can reach the SQL private endpoint. Finally, everything else that reaches this boundary gets denied before the Azure default rules matter.

The danger shows up when a broad rule comes too early. A rule named `deny-all-inbound` at priority `100` blocks the HTTPS allow at priority `200`, because Azure reaches the deny first. A rule named `allow-any-inbound` at priority `100` creates the opposite problem, because later denies never run for matching traffic.

## Default Rules
<!-- section-summary: Every NSG includes default rules that allow VNet traffic and outbound internet traffic, then deny unmatched traffic at the end. -->

Every NSG starts with **default security rules**. These rules sit at very high priority numbers, so your custom rules run before them. You cannot delete the default rules, but you can override them with custom rules that have higher priority, which means lower priority numbers.

The defaults explain surprising first-day behavior. Resources in the same VNet can often communicate because `AllowVNetInBound` and `AllowVnetOutBound` allow traffic inside the `VirtualNetwork` service tag. Inbound internet traffic gets denied by default because `DenyAllInbound` closes anything that no custom inbound allow rule matched.

| Direction | Default rule | Priority | What it means for the Orders workload |
|---|---|---:|---|
| Inbound | `AllowVNetInBound` | `65000` | VNet-sourced traffic can enter unless a custom rule blocks it first. |
| Inbound | `AllowAzureLoadBalancerInBound` | `65001` | Azure load balancer health and platform traffic can reach where needed. |
| Inbound | `DenyAllInbound` | `65500` | Unmatched inbound traffic gets denied. |
| Outbound | `AllowVnetOutBound` | `65000` | VNet destinations can receive outbound traffic unless a custom rule blocks it first. |
| Outbound | `AllowInternetOutBound` | `65001` | Internet destinations pass the NSG unless a custom rule blocks them first. |
| Outbound | `DenyAllOutBound` | `65500` | Unmatched outbound traffic gets denied. |

The most important default for internal segmentation is `AllowVNetInBound`. It gives the Orders API a working internal network before the team writes rules, which helps early development. In production, that same default can allow too much east-west movement inside a VNet, so teams often add specific allows and then a broad custom deny before the default allow.

For the API subnet, the team might keep the first three expected flows and deny the rest of inbound traffic. The custom deny at `4096` runs long before `AllowVNetInBound` at `65000`, so the default VNet allow no longer opens the whole subnet.

```bash
az network nsg rule create \
  --resource-group rg-devpolaris-network-prod \
  --nsg-name nsg-orders-api \
  --name deny-api-inbound-remaining \
  --priority 4096 \
  --direction Inbound \
  --access Deny \
  --protocol '*' \
  --source-address-prefixes '*' \
  --source-port-ranges '*' \
  --destination-address-prefixes '*' \
  --destination-port-ranges '*'
```

This rule needs careful review because it changes the subnet from open internal communication to explicit inbound communication. That is usually the right direction for production tiers, but the team has to account for health probes, admin paths, monitoring agents, private endpoints, and service-specific requirements before closing the space.

After adding a broad custom deny, check its priority. It should sit after the specific allows and before the default `AllowVNetInBound` rule at priority `65000`.

```bash
az network nsg rule show \
  --resource-group rg-devpolaris-network-prod \
  --nsg-name nsg-orders-api \
  --name deny-api-inbound-remaining \
  --query "{priority:priority,access:access,direction:direction,source:sourceAddressPrefix,destination:destinationAddressPrefix,ports:destinationPortRange}"
```

Example output:

```json
{
  "priority": 4096,
  "access": "Deny",
  "direction": "Inbound",
  "source": "*",
  "destination": "*",
  "ports": "*"
}
```

This output is healthy only when the expected allow rules above it already cover gateway, health probe, admin, and monitoring paths. A broad deny with no matching allows creates clean-looking security and broken traffic.

## Stateful Flows
<!-- section-summary: NSGs keep flow records, so response traffic for an allowed connection can return without a matching reverse rule. -->

**Stateful filtering** means Azure remembers an allowed connection as a flow record. When `orders-api-prod` starts an outbound HTTPS connection to a package repository, the NSG can allow the response packets back because they belong to the same connection. The team writes the rule for the side that starts the connection, then Azure handles the matching return packets through the flow record.

The same works in the other direction. If Application Gateway starts an inbound TCP connection to the API and the inbound NSG rule allows it, the API's response packets can go back through that established flow. The NSG tracks the connection state so the return side can work like a normal network conversation.

Stateful behavior matters during rule changes. If an engineer removes the SSH allow rule while an SSH session is already active, the existing session can keep working because the flow record already exists. A new SSH connection attempt has to match the updated rules, so the new connection fails after the allow rule disappears.

This detail can make incident response feel confusing. Someone changes a rule and tests from an already open terminal, then concludes the rule did nothing. A better test uses a new connection after the rule change, because NSG updates affect new flows while existing flow records can continue until the connection ends or times out.

## Application Security Groups
<!-- section-summary: Application security groups let NSG rules target workload roles instead of fragile private IP lists. -->

An **Application Security Group**, usually shortened to **ASG**, is a named group of network interfaces that represent an application role. Instead of writing an NSG rule from `10.30.2.20` to `10.30.3.40`, the team can write a rule from `asg-orders-api` to `asg-orders-worker`. The rule then follows the role as VM instances scale, move, or receive new private IP addresses.

This name can confuse AWS readers because an Azure ASG is neither an AWS Auto Scaling group nor an AWS security group. In Azure, the ASG is a role label for network interfaces that you reference inside NSG rules; the NSG still owns the allow and deny decision.

This helps the Orders team because production IPs change more often than intent. The API might move from one VM scale set instance to another, or a worker tier might add capacity during a release. The rule should keep saying "orders API can reach orders worker on the approved port" while humans stay out of routine IP address edits.

Role names make the shape easier to review. The table now describes application intent instead of a temporary set of private IP addresses:

| Role | ASG name | Members |
|---|---|---|
| Orders API | `asg-orders-api` | Network interfaces for `orders-api-prod` instances. |
| Orders worker | `asg-orders-worker` | Network interfaces for background worker instances. |
| Admin hosts | `asg-admin-tools` | Network interfaces for approved operational test hosts. |
| Legacy database VM | `asg-orders-db` | Network interfaces for a database VM when a managed service has not replaced it yet. |

ASGs have one important boundary. Network interfaces assigned to the same ASG must live in the same virtual network, and a rule that uses source and destination ASGs expects both sides to belong to the same VNet. That fits our Orders example because the API and worker roles live inside `vnet-devpolaris-prod`.

Here is the practical flow for a VM-backed API. The deployment creates the ASG, adds a network interface to it, and then references the ASG in NSG rules. The exact NIC names come from the compute service, so production teams usually automate this with Bicep, Terraform, or deployment scripts.

```bash
az network asg create \
  --resource-group rg-devpolaris-network-prod \
  --name asg-orders-api \
  --location uksouth

az network nic update \
  --resource-group rg-devpolaris-compute-prod \
  --name nic-orders-api-prod-001 \
  --application-security-groups asg-orders-api
```

ASGs shine when rules describe long-lived workload roles. For Azure services that hide their network interfaces, service-specific subnet rules, private endpoint policies, IP prefixes, or service tags may fit better. The useful habit stays the same: write rules around the role and path you intend, then use the Azure construct that can express that path cleanly.

For VM-backed workloads, verify membership from the NIC. The ASG should appear on the IP configuration that carries the workload traffic.

```bash
az network nic show \
  --resource-group rg-devpolaris-compute-prod \
  --name nic-orders-api-prod-001 \
  --query "ipConfigurations[].applicationSecurityGroups[].id"
```

Example output:

```json
[
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationSecurityGroups/asg-orders-api"
]
```

## Service Tags and Augmented Rules
<!-- section-summary: Service tags represent Azure-managed address groups, and augmented rules reduce repeated rules for ports and address ranges. -->

A **service tag** is an Azure-managed name for a group of IP address prefixes. Microsoft updates the underlying prefixes for the service, while your rule keeps the stable tag name. This helps when a rule needs to describe Azure platform ranges or common service groups and the team wants to avoid copying changing IP lists into the NSG.

You already saw service tags in the default rules. `VirtualNetwork`, `AzureLoadBalancer`, and `Internet` are service tags that represent managed address groups. `VirtualNetwork` covers more than the local VNet in many connected designs, because it can include peered networks, gateway-connected networks, and other prefixes Azure treats as part of the virtual network reachability set.

For the Orders API, the team might use a service tag for a controlled platform dependency. If a VM must reach Azure Storage endpoints for bootstrapping or diagnostics, a rule can target the `Storage` service tag instead of a long list of public prefixes. The team still has to decide whether that broad service tag matches the security goal, because a service tag can represent many service IP ranges.

An **augmented security rule** lets one NSG rule include multiple ports or multiple explicit IP prefixes. This reduces repeated rules when the meaning is truly the same. For example, an outbound rule can allow TCP `443` and `5671` to a set of approved monitoring collector ranges if both ports belong to the same operational path.

| Rule ingredient | Good use | Review question |
|---|---|---|
| `VirtualNetwork` service tag | Internal VNet and connected-network reachability | Does this include peered or on-premises ranges the team forgot about? |
| `AzureLoadBalancer` service tag | Azure load balancer health probe paths | Does the service actually need platform load balancer probes? |
| `Internet` service tag | Broad public internet direction | Does a NAT Gateway or firewall path also control this traffic? |
| `Storage` service tag | Azure Storage service prefixes | Does the workload need all matching Storage prefixes, or one private endpoint? |
| Multiple ports in one rule | Same source, destination, and reason | Do these ports really share one business purpose? |

Service tags and augmented rules make NSGs easier to maintain when the rule meaning stays clear. They can also hide too much reach behind one friendly name. A good review explains why a tag or multi-port rule fits the path and treats a shorter rule table as only part of the evidence.

## Outbound Rules
<!-- section-summary: Outbound NSG rules decide which destinations a workload may start connections to, but routing and NAT still decide the actual network path. -->

An **outbound rule** controls flows that a workload starts toward another destination. In the Orders system, outbound traffic includes the API calling Azure SQL through a private endpoint, sending telemetry to Azure Monitor, downloading packages during a controlled deployment, or calling an external payment provider. Each of those flows has a different risk level.

The default `AllowInternetOutBound` rule often surprises people. It means the NSG allows internet-bound traffic unless a custom outbound deny blocks it first. That NSG allow only covers the packet filter decision, while routing, NAT Gateway, Azure Firewall, public IPs, load balancer outbound rules, and subnet outbound settings still decide how packets leave Azure and which source address the outside service sees.

For a private production subnet, the Orders team wants outbound traffic to become explicit. The API can reach the SQL private endpoint on `1433`, reach approved observability endpoints, and reach the payment provider through the firewall or NAT path. A broad custom outbound deny then prevents surprise egress from using the default allow.

| Priority | Name | Destination | Port | Action |
|---:|---|---|---:|---|
| `100` | `allow-api-to-sql-private-endpoint` | `10.30.40.7` | `1433` | Allow |
| `120` | `allow-api-to-monitoring` | Approved monitoring tag or prefix | `443` | Allow |
| `130` | `allow-api-to-payment-provider` | Approved payment prefix | `443` | Allow |
| `4096` | `deny-api-outbound-remaining` | `*` | `*` | Deny |

The database rule shows why NSGs and private connectivity work together. The private endpoint gives Azure SQL a private IP inside the VNet, DNS resolves the SQL name to that private IP, routes carry the packet to the private endpoint subnet, and the NSG allows only the expected API role to start the SQL flow. Each control answers one part of the path.

This is also where network and application teams need to talk to each other. A developer may only know that the API calls `https://payments.example.com`. The platform team needs the destination IP ranges, expected ports, DNS behavior, TLS requirements, NAT source IP, and monitoring evidence. Turning that call into an outbound rule forces the production dependency to become visible.

## Effective Rules and IP Flow Verify
<!-- section-summary: Effective security rules and IP flow verify show what Azure actually applies, which matters more than one rule file during troubleshooting. -->

**Effective security rules** are the combined rules Azure applies to a network interface after it includes subnet NSGs, NIC NSGs, default rules, and security admin rules from Azure Virtual Network Manager when those exist. This view matters because production traffic follows the final set Azure evaluated, even when one individual file or portal page tells only part of the story.

For a VM-backed Orders API, this CLI command shows the effective NSGs on the network interface. The result helps the team see whether the subnet NSG, NIC NSG, and default rules combine into the access path they expected. Azure only shows effective rules for a NIC when the NIC is attached to a running VM and an NSG exists on the NIC or subnet.

```bash
az network nic list-effective-nsg \
  --resource-group rg-devpolaris-compute-prod \
  --name nic-orders-api-prod-001
```

The full output is large, so responders usually pull out the applied NSG names and the rule rows that match the failing path. The useful evidence should read like this:

```json
[
  {
    "association": "Subnet",
    "networkSecurityGroup": "nsg-orders-api",
    "rule": "allow-entry-to-orders-api-https",
    "access": "Allow",
    "direction": "Inbound",
    "source": "10.30.1.0/24",
    "destination": "asg-orders-api",
    "ports": "443"
  },
  {
    "association": "Subnet",
    "networkSecurityGroup": "nsg-orders-api",
    "rule": "deny-api-inbound-remaining",
    "access": "Deny",
    "direction": "Inbound",
    "source": "*",
    "destination": "*",
    "ports": "*"
  }
]
```

**IP flow verify** is a Network Watcher check that asks Azure about one specific packet shape. You give it direction, protocol, local address and port, remote address and port, and the target VM or NIC. Azure returns whether that packet would be allowed or denied and which rule made the decision.

```bash
az network watcher test-ip-flow \
  --direction Inbound \
  --protocol TCP \
  --local 10.30.2.20:443 \
  --remote 10.30.1.10:* \
  --vm /subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-devpolaris-compute-prod/providers/Microsoft.Compute/virtualMachines/vm-orders-api-prod-001 \
  --nic nic-orders-api-prod-001
```

Example output:

```json
{
  "access": "Allow",
  "ruleName": "UserRule_allow-entry-to-orders-api-https"
}
```

If the same test returns `Deny`, the `ruleName` gives the next clue. A custom deny points to a local rule change. A default deny means no custom allow matched. A security admin rule can mean the organization-level policy blocked the packet before the local NSG rule could help.

These tools change the troubleshooting conversation. Instead of saying "the NSG looks fine," the team can ask a precise question: can `10.30.1.10` start inbound TCP to `10.30.2.20:443`, and which rule decides? That one question includes the source, destination, protocol, port, direction, and actual Azure evaluation result.

Security admin rules add one more production detail. Large organizations can use Azure Virtual Network Manager to push global security admin rules across virtual networks. Those rules evaluate before NSG rules, so an organization-level deny can block a packet before the local NSG ever gets a chance to allow it.

## Putting It All Together
<!-- section-summary: A production NSG design starts with workload paths, turns them into specific rules, closes broad defaults, and verifies the effective result from Azure. -->

Now the Orders network has a clearer shape. The VNet gives the private address space. Subnets separate public entry, API compute, private endpoints, and shared network services. NSGs turn that placement into packet permission rules, so a route existing inside the VNet no longer means every workload can freely talk to every other workload.

The final rule story should sound like a production conversation. The entry layer can reach the Orders API on TCP `443`. Azure Bastion can reach approved admin ports only where the team allows it. The API can reach the SQL private endpoint on TCP `1433`. Observability and payment egress have explicit outbound paths. Everything else hits a custom deny before broad default rules can open the subnet.

![Azure NSG review board summarizing path design, narrow rules, defaults, and evidence](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups/nsg-review-board.png)

*A useful NSG review keeps four things visible at the same time: network shape, narrow rule fields, broad defaults, and Azure evidence.*

ASGs keep the rule table tied to workload roles instead of individual private IPs. Service tags help with Azure-managed address groups when the tag truly matches the path. Augmented rules reduce repetition when multiple ports or prefixes share one reason. Effective security rules and IP flow verify prove what Azure applies after all of those pieces combine.

The main operational habit is to review packets as complete flows. A useful NSG review names the source, destination, protocol, destination port, direction, priority, and reason. A useful incident check asks whether the packet matched the intended allow, hit a custom deny, fell through to a default rule, or got stopped by another control before the NSG.

## What's Next

Network security groups give private workloads packet-level boundaries, but users still need a public way to reach the system. That public entry path has its own concerns: DNS, TLS, health probes, WAF policy, Layer 4 load balancing, Layer 7 routing, and global edge behavior.

The next article follows Azure public entry points. We will connect Front Door, Application Gateway, Load Balancer, DNS, TLS, and backend health to the same Orders workload so public traffic reaches the private application path while backend services stay behind the entry layer.

---

**References**

- [Azure network security groups overview](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview) - Documents NSG rule properties, priority order, default rules, stateful flow behavior, service tags, ASGs, and security admin rule precedence.
- [How network security groups filter network traffic](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works) - Explains subnet and NIC NSG evaluation order for inbound and outbound traffic.
- [Azure Application Security Groups overview](https://learn.microsoft.com/en-us/azure/virtual-network/application-security-groups) - Describes ASG behavior, NSG rule use, and same-VNet constraints.
- [Effective security rules overview](https://learn.microsoft.com/en-us/azure/network-watcher/effective-security-rules-overview) - Explains how Network Watcher aggregates effective inbound and outbound rules for a network interface.
- [Troubleshoot NSG misconfigurations that block traffic](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic) - Shows common NSG troubleshooting cases, effective rules, and IP flow verify usage.
- [Configure NSG rules for Azure Bastion](https://learn.microsoft.com/en-us/azure/bastion/bastion-nsg) - Documents the target VM subnet rule that allows RDP or SSH from the Azure Bastion subnet.
- [az network nic list-effective-nsg](https://learn.microsoft.com/en-us/cli/azure/network/nic?view=azure-cli-latest#az-network-nic-list-effective-nsg) - Documents the Azure CLI command for listing effective NSGs on a network interface.
- [az network nsg rule](https://learn.microsoft.com/en-us/cli/azure/network/nsg/rule?view=azure-cli-latest) - Documents Azure CLI NSG rule options, including custom priority range and supported protocols.
- [Azure best practices for network security](https://learn.microsoft.com/en-us/azure/security/fundamentals/network-best-practices) - Covers subnet segmentation, NSG rule management, ASGs, and when higher-layer network appliances are useful.

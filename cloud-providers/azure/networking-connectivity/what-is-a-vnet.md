---
title: "What Is a VNet"
description: "Understand how Azure Virtual Networks give workloads a regional private network boundary, subnet placement, routing, explicit outbound access, and connection points to other networks."
overview: "A VNet is the private network shape that Azure workloads live inside. This article follows the Orders API through one production design so address spaces, subnets, reserved IPs, system routes, user-defined routes, NAT Gateway, effective routes, peering, and private connectivity fit together."
tags: ["azure", "vnet", "subnets", "routes", "nat"]
order: 1
id: article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model
aliases:
  - azure-networking-mental-model
  - virtual-networks-subnets-and-routes
  - article-cloud-providers-azure-networking-connectivity-virtual-networks-subnets-and-routes
  - cloud-providers/azure/networking-connectivity/azure-networking-mental-model.md
  - cloud-providers/azure/networking-connectivity/virtual-networks-subnets-and-routes.md
---

## Table of Contents

1. [The Network Story](#the-network-story)
2. [What a VNet Does](#what-a-vnet-does)
3. [Region, Address Space, and Non-Overlap](#region-address-space-and-non-overlap)
4. [Subnets as Workload Areas](#subnets-as-workload-areas)
5. [Reserved Addresses and Sizing](#reserved-addresses-and-sizing)
6. [Route Tables and Effective Routes](#route-tables-and-effective-routes)
7. [User-Defined Routes](#user-defined-routes)
8. [Explicit Outbound Access](#explicit-outbound-access)
9. [NAT Gateway and SNAT](#nat-gateway-and-snat)
10. [Connecting VNets and On-Premises Networks](#connecting-vnets-and-on-premises-networks)
11. [A Production VNet Shape](#a-production-vnet-shape)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Network Story
<!-- section-summary: This article follows one Orders production network so VNet boundaries, subnets, routes, outbound access, and private connectivity stay connected. -->

We are going to follow one production workload through the article. The Orders team runs `orders-api-prod` in Azure, and that API needs three network paths. It receives traffic from the company's public entry layer, calls Azure SQL through a private endpoint, and reaches a payment provider on the public internet through an approved outbound path.

That one story already gives us the main VNet concepts. The **Virtual Network**, usually shortened to **VNet**, gives the workload a private regional network boundary. The **address space** gives that boundary its private IP range. **Subnets** divide that range into workload areas. **Routes** decide where packets go when they leave a subnet. **NAT Gateway**, firewall routes, peering, VPN, and ExpressRoute decide how the private network connects to things outside itself.

Here is the shape we will keep using. The names look realistic because production network debugging usually starts with names like these, not with abstract boxes.

![Orders VNet map showing public entry, API subnet, private endpoints, firewall, NAT Gateway, and external networks](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model/orders-vnet-map.png)

*The Orders API lives inside one private regional VNet boundary, but each path has a different job: public entry, private service access, outbound payment calls, and corporate connectivity.*

The rest of the article builds from the inside out. First we define the VNet boundary, then we choose the address space, then we divide it into subnets, then we read routes, then we make outbound access explicit, and finally we connect the VNet to other networks. Each step answers one practical production question: where can the workload live, what private address can it use, and what path does its traffic take?

## What a VNet Does
<!-- section-summary: A VNet is Azure's private regional network boundary where resources communicate, attach security controls, and connect to other networks. -->

An **Azure Virtual Network** is the private network boundary for Azure resources in one region. Microsoft describes it as the fundamental building block for a private network in Azure. In everyday engineering terms, it is the place where you put workloads before you decide which subnets, routes, security rules, private endpoints, gateways, and outbound paths they will use.

For the Orders system, `vnet-devpolaris-prod` is the private network home for the production API and its supporting network pieces. The API can receive traffic from a controlled entry subnet, call private endpoints inside the VNet, and send approved outbound traffic through NAT Gateway or a firewall path. The VNet gives those paths a shared private IP space and a common routing surface.

Keep one request in view while reading this article. A browser reaches the public entry layer, the entry layer forwards to `orders-api-prod` on a private address, the API resolves Azure SQL to a private endpoint IP, and the same API calls a payment provider through the chosen outbound path. The VNet does not replace DNS, TLS, NSGs, or identity, but every one of those controls depends on the private network shape underneath.

If you know AWS, a VNet fills the same broad job as a VPC. One Azure detail matters early: Azure virtual networks and subnets span all availability zones in a region. A zonal virtual machine can still live in a specific zone, but the subnet itself stays regional. That means Azure subnet design usually starts with workload role boundaries, such as public entry, app compute, private endpoints, firewall, and gateway, rather than one subnet per zone.

The VNet is also the attachment point for later networking topics. Network security groups filter packet flows. Application Gateway and Front Door handle public entry patterns. Private Link brings specific Azure service instances into the private address space. VPN Gateway and ExpressRoute connect the VNet to corporate networks. The VNet does the base job that all of those later controls need.

## Region, Address Space, and Non-Overlap
<!-- section-summary: A VNet address space is the private IP range for the network, and non-overlap keeps future peering and hybrid routing possible. -->

A **VNet address space** is the private IP range assigned to a virtual network. It uses CIDR notation, such as `10.30.0.0/16`. The `10.30.0.0` part names the range, and the `/16` part tells Azure how many addresses belong to that range. In this example, the VNet has room for 65,536 total addresses before subnet reservations and service-specific limits enter the picture.

The Orders team chooses `10.30.0.0/16` for production because it gives enough room for current subnets and future growth. The same company might use `10.20.0.0/16` for development and `10.40.0.0/16` for analytics. That planning matters when networks connect to each other.

Connected networks need **non-overlapping address spaces**. If the Orders VNet and the corporate datacenter both use `10.30.0.0/16`, a router cannot make a clean decision for `10.30.2.15` because both sides claim that address range. Peering, VPN, ExpressRoute, and hub-and-spoke designs all depend on ranges that point to one clear owner.

| Design choice | Orders example | Why it matters |
|---|---|---|
| **Production VNet range** | `10.30.0.0/16` | Gives one regional private space for production workloads. |
| **Development VNet range** | `10.20.0.0/16` | Keeps dev and prod separate before any peering or hub routing. |
| **Corporate network range** | `10.80.0.0/16` | Avoids overlap when VPN or ExpressRoute connects offices to Azure. |
| **Reserved growth room** | Keep unused `/24` blocks | Leaves space for private endpoints, new app tiers, and future services. |

This is also where naming starts helping operations. A name like `vnet-devpolaris-prod-uksouth` tells a reviewer the organization, environment, and region. A range like `10.30.0.0/16` tells a network engineer which private space belongs to that VNet. The combination makes later routing evidence easier to read.

## Subnets as Workload Areas
<!-- section-summary: A subnet is a smaller range inside the VNet where Azure places workloads and attaches subnet-level routing, security, and service settings. -->

A **subnet** is a smaller IP range carved from the VNet address space. It gives one workload role a placement area, and Azure attaches subnet-level settings there. Route tables, network security groups, NAT Gateway associations, service endpoints, private endpoint placement, and service delegation all meet the workload at the subnet boundary.

For the Orders team, the public entry layer, the API runtime, and private endpoints all deserve separate subnets because they have different jobs. `snet-public-entry` can hold Application Gateway or another regional entry component. `snet-orders-api` can hold the compute that runs the API. `snet-private-endpoints` can hold private endpoint network interfaces for Azure SQL and Key Vault.

| Subnet | CIDR | Job |
|---|---|---|
| `snet-public-entry` | `10.30.1.0/24` | Regional public-entry components that forward approved traffic inward. |
| `snet-orders-api` | `10.30.2.0/24` | Private application compute that runs the Orders API. |
| `snet-private-endpoints` | `10.30.40.0/24` | Private endpoint interfaces for managed services such as SQL and Key Vault. |
| `AzureFirewallSubnet` | `10.30.100.0/26` | Azure Firewall placement when the VNet owns an inspection point. |
| `GatewaySubnet` | `10.30.200.0/27` | VPN Gateway or ExpressRoute Gateway placement when hybrid connectivity exists. |

Subnet names should describe the job instead of the tool of the week. A name like `snet-orders-api` survives a move from virtual machines to Container Apps or App Service integration because the subnet still belongs to the Orders API tier. A name like `snet-vm-1` goes stale as soon as the team changes the compute service.

Some Azure services also use **subnet delegation**. Subnet delegation tells Azure that a specific service can create service-specific resources in that subnet and apply the rules it needs. Azure Container Apps environments, App Service VNet integration patterns, and managed database services can all have subnet requirements, so production subnet planning usually leaves dedicated space for services that need their own subnet behavior.

The basic creation flow can start small. This command creates the VNet and the first application subnet, then a later command makes the subnet private so the workload uses an explicit outbound method instead of relying on default outbound behavior.

```bash
az network vnet create \
  --resource-group rg-devpolaris-network-prod \
  --name vnet-devpolaris-prod \
  --location uksouth \
  --address-prefixes 10.30.0.0/16 \
  --subnet-name snet-orders-api \
  --subnet-prefixes 10.30.2.0/24

az network vnet subnet update \
  --resource-group rg-devpolaris-network-prod \
  --vnet-name vnet-devpolaris-prod \
  --name snet-orders-api \
  --default-outbound false
```

The first command creates the private address container and one subnet. The second command records an important production decision: outbound internet access should use an explicit design such as NAT Gateway, firewall, public IP, or load balancer outbound rules, instead of an implicit platform-provided outbound IP.

The quick verification is a read-only subnet check. The address prefix should match the plan, and `defaultOutboundAccess` should show `false` for a private application subnet.

```bash
az network vnet subnet show \
  --resource-group rg-devpolaris-network-prod \
  --vnet-name vnet-devpolaris-prod \
  --name snet-orders-api \
  --query "{addressPrefix:addressPrefix, defaultOutboundAccess:defaultOutboundAccess}"
```

Example output:

```json
{
  "addressPrefix": "10.30.2.0/24",
  "defaultOutboundAccess": false
}
```

If the value is missing or true on a new production subnet, the team should decide whether the subnet intentionally allows default outbound behavior or whether the deployment used an older API version or template that left the property unset.

## Reserved Addresses and Sizing
<!-- section-summary: Azure reserves five IP addresses in every subnet, so subnet size needs to account for platform reservations and workload growth. -->

Every Azure subnet loses five addresses to platform reservation. Azure reserves the first four addresses and the last address in each subnet range. In `10.30.2.0/24`, those reserved addresses are `10.30.2.0`, `10.30.2.1`, `10.30.2.2`, `10.30.2.3`, and `10.30.2.255`.

That rule matters because small subnets run out of usable addresses faster than their CIDR size suggests. A `/28` has 16 total addresses, and Azure reserves five of them, so only 11 remain for resources. A busy private endpoint subnet, a scaling compute subnet, or a delegated service subnet can hit that limit during normal growth.

| Subnet size | Total addresses | Azure-reserved addresses | Usable addresses |
|---|---:|---:|---:|
| `/28` | 16 | 5 | 11 |
| `/27` | 32 | 5 | 27 |
| `/26` | 64 | 5 | 59 |
| `/24` | 256 | 5 | 251 |

The Orders team uses `/24` for normal app and private endpoint subnets because it gives comfortable room for growth. The team can still choose smaller ranges for special infrastructure subnets when the service documentation supports that size. The important habit is to size from the service's scaling behavior, not from the number of resources visible on day one.

![Azure subnet sizing infographic showing VNet address space, subnet blocks, five reserved addresses, and usable IP comparison](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model/subnet-sizing-reserved-ips.png)

*Subnet sizing is capacity planning. The VNet range gives the network room, each subnet gets a job, and Azure's five reserved addresses reduce the usable IP count in every subnet.*

This sizing step connects directly to routes. After the subnet exists and has enough usable addresses, Azure adds system routes for the VNet address space and other defaults. The next question is where packets go when `orders-api-prod` talks to another address.

## Route Tables and Effective Routes
<!-- section-summary: Azure gives each subnet system routes, and effective routes show the combined path after system routes, custom routes, peering, gateways, and service routes are considered. -->

A **route** tells Azure the next hop for traffic that leaves a subnet toward a destination IP address. A **route table** is a set of custom routes that can be associated with a subnet. Azure also creates system routes automatically, so a subnet has routing behavior even before the team creates a custom route table.

For AWS readers, Azure route tables and user-defined routes fill the same broad job as VPC route tables: they decide the next hop for traffic leaving a subnet. The Azure detail to check is **effective routes**, because system routes, custom routes, peering, gateways, service routes, and private endpoints can all influence the final path.

For the Orders API, a route question sounds like this: traffic leaves `snet-orders-api` toward `10.30.40.7`, `10.80.4.20`, or `203.0.113.25`; which route wins, and what next hop receives the packet? That question is much better than saying "the network is broken" because it names the source subnet, destination, and route decision.

Azure creates default system routes for the VNet address space, for `0.0.0.0/0`, and for common private ranges that the VNet does not own. The VNet address space route lets subnets inside the VNet communicate. The `0.0.0.0/0` route describes the broad internet direction, though modern private subnet behavior means a workload still needs an explicit outbound method to reach public endpoints reliably.

| Source | Destination prefix | Next hop type | Orders meaning |
|---|---|---|---|
| System | `10.30.0.0/16` | Virtual network | Traffic inside the Orders VNet stays on the VNet path. |
| System | `0.0.0.0/0` | Internet | Public destinations have a default direction, subject to outbound configuration. |
| Peering or gateway | `10.80.0.0/16` | VNet peering or virtual network gateway | Corporate network routes can appear after connectivity is configured. |
| User route | `0.0.0.0/0` | Virtual appliance | A custom default route can send outbound traffic to a firewall or NVA. |

Azure selects routes by **longest prefix match**. A route for `10.30.40.0/24` wins over a route for `10.30.0.0/16` when the destination is `10.30.40.7`, because `/24` describes a smaller and more specific range. If two routes have the same prefix length, Azure uses route source priority: user-defined routes first, then BGP routes, then system routes, with specific platform exceptions for some service routes.

The route table you create is only part of the evidence. The **effective route table** is the combined result after Azure includes system routes, custom routes, peering routes, gateway routes, service endpoint routes, and other platform-added routes. During a real incident, the effective route table usually matters more than the route table file in the repository.

For a VM-based test host in the same subnet, the Azure CLI can show the effective route table for its network interface. This is especially useful when the production runtime hides low-level network interface details from the app team.

```bash
az network nic show-effective-route-table \
  --resource-group rg-devpolaris-network-prod \
  --name nic-orders-api-test \
  --query "value[].{source:source,prefixes:addressPrefix,nextHop:nextHopType,nextHopIp:nextHopIpAddress}" \
  --output table
```

Example output:

```console
Source    Prefixes       NextHopType       NextHopIp
--------  -------------  ----------------  ----------
Default   10.30.0.0/16   VnetLocal
Default   0.0.0.0/0      Internet
User      0.0.0.0/0      VirtualAppliance  10.30.100.4
Default   10.80.0.0/16   VirtualNetworkGateway
```

That output gives the team route evidence from Azure itself. If `orders-api-prod` cannot reach `10.30.40.7`, the reviewer can check whether a custom route, peering route, or gateway route sends that private endpoint traffic somewhere unexpected. That is the point where user-defined routes matter, because they can intentionally override default behavior.

![Azure effective routes infographic showing local VNet, gateway or peering, and outbound firewall or NAT paths](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model/effective-routes-paths.png)

*Effective routes show the route table Azure actually uses after system routes, peering, gateways, and UDRs combine. That is why route debugging starts with the source subnet and destination IP.*

## User-Defined Routes
<!-- section-summary: A user-defined route is a custom route that can steer subnet traffic through a firewall, gateway, or other approved next hop. -->

A **user-defined route**, usually shortened to **UDR**, is a custom route that the team creates in a route table. UDRs let a subnet send traffic through a specific next hop such as a firewall, network virtual appliance, virtual network gateway, or explicit internet next hop. Azure combines those UDRs with the subnet's other routes, and UDRs override conflicting default system routes.

The Orders team might want all general outbound traffic from `snet-orders-api` to pass through an inspection point. A route for `0.0.0.0/0` with next hop `VirtualAppliance` can send broad outbound traffic to a firewall IP such as `10.30.100.4`. That route makes the firewall part of the application path, so firewall health, IP forwarding, return routing, and allow rules all become production dependencies.

```bash
az network route-table create \
  --resource-group rg-devpolaris-network-prod \
  --name rt-orders-private \
  --location uksouth

az network route-table route create \
  --resource-group rg-devpolaris-network-prod \
  --route-table-name rt-orders-private \
  --name default-to-firewall \
  --address-prefix 0.0.0.0/0 \
  --next-hop-type VirtualAppliance \
  --next-hop-ip-address 10.30.100.4

az network vnet subnet update \
  --resource-group rg-devpolaris-network-prod \
  --vnet-name vnet-devpolaris-prod \
  --name snet-orders-api \
  --route-table rt-orders-private
```

Those commands create the route table, add one broad route, and associate the table with the Orders API subnet. The association is the step that makes the route affect packets. A route table sitting unattached in a resource group has no effect on a subnet.

Verify both pieces. The route should point at the firewall IP, and the subnet should show the route table association.

```bash
az network route-table route show \
  --resource-group rg-devpolaris-network-prod \
  --route-table-name rt-orders-private \
  --name default-to-firewall \
  --query "{prefix:addressPrefix,nextHop:nextHopType,nextHopIp:nextHopIpAddress}"

az network vnet subnet show \
  --resource-group rg-devpolaris-network-prod \
  --vnet-name vnet-devpolaris-prod \
  --name snet-orders-api \
  --query "{subnet:name,routeTable:routeTable.id}"
```

Example output:

```json
{
  "prefix": "0.0.0.0/0",
  "nextHop": "VirtualAppliance",
  "nextHopIp": "10.30.100.4"
}
```

That first result proves the route intent. The second result should contain the `rt-orders-private` resource ID. If the route exists but the subnet output has no route table, Azure will not use the custom route for that subnet.

UDRs are useful because they make network intent explicit. They are risky for the same reason. A broad `0.0.0.0/0` route can move many destinations through one next hop, and a more specific private prefix can override the VNet-local path. A route to a virtual appliance also requires the appliance network interface to allow IP forwarding, because Azure drops forwarded traffic when the NIC is not configured for that gateway job.

The safest UDR review names four things in one sentence: source subnet, destination prefix, next hop, and return path. For example, `snet-orders-api` sends `0.0.0.0/0` to firewall `10.30.100.4`, and the firewall sends approved internet traffic out through its outbound configuration while return traffic comes back through the same path. That sentence gives the team something concrete to test.

## Explicit Outbound Access
<!-- section-summary: Modern Azure production networks should choose an explicit outbound method because new private subnet behavior removes reliance on hidden default outbound public IPs. -->

**Outbound access** means a private workload starts a connection to something outside its subnet or VNet. The Orders API needs outbound access for payment provider calls, package mirrors, telemetry endpoints, and some platform dependencies. The design question is which outbound method owns those connections and which public or private source address the outside service sees.

Azure has older default outbound behavior for virtual machines in nonprivate subnets. In that model, a VM without an explicit outbound method can receive a Microsoft-owned default outbound public IP. Microsoft recommends explicit outbound connectivity because the default outbound IP can change, the behavior is implicit, and it conflicts with clearer Zero Trust network design.

The date matters here. Microsoft documents that for API versions released after **March 31, 2026**, new virtual networks use private subnets by default, with `defaultOutboundAccess` set to `false`. Existing VNets keep their existing behavior unless teams change the subnet settings, and templates or tools that pin older API versions can still leave the property unset. Since this article is about new production design, the Orders team treats outbound access as something the architecture must name directly.

| Outbound method | Where it fits | Orders example |
|---|---|---|
| **NAT Gateway** | Managed outbound internet for private subnets | `snet-orders-api` calls payment APIs from a stable public IP. |
| **Azure Firewall or NVA through UDR** | Inspection, central policy, and hub egress | Orders traffic goes to the hub firewall before the internet. |
| **Standard Load Balancer outbound rules** | VM and load-balancer-specific outbound patterns | A VM pool needs outbound tied to a load balancer design. |
| **Instance public IP** | Direct public identity for a specific VM | A temporary admin VM has a controlled public IP during migration. |

For most private application subnets, NAT Gateway is the clean starting point. It gives the subnet a managed outbound path without assigning public IPs to each workload. A firewall path can fit when the organization needs inspection, centralized allow lists, or hub-and-spoke egress control. The main point is that the chosen path appears in the architecture, route evidence, and operations checklist.

This outbound choice connects directly to NAT and SNAT. When a private IP talks to a public internet service, Azure needs to translate that private source into a usable public source. NAT Gateway gives Azure a managed way to do that translation.

## NAT Gateway and SNAT
<!-- section-summary: NAT Gateway gives private subnets managed outbound connectivity by translating private source addresses to stable public IP addresses and SNAT ports. -->

**Azure NAT Gateway** is a managed outbound connectivity service for resources in a virtual network. The Orders API can sit on private IP `10.30.2.7`, start a connection to a payment provider, and have NAT Gateway translate that source to a public IP owned by the NAT Gateway. Outside services see the NAT Gateway public IP, while the workload keeps its private address inside the VNet.

A useful AWS anchor is AWS NAT Gateway: private workloads make outbound internet calls through a managed public source. In Azure, associate NAT Gateway with the subnet and still check effective routes, because a broad custom route to a firewall or gateway can change the outbound path.

**SNAT**, or Source Network Address Translation, is the translation of the source IP address and source port on outbound connections. A flow might start as `10.30.2.7:50124` inside the subnet and leave Azure as `52.174.12.34:32001` after NAT Gateway translates it. Return traffic for that active flow comes back through the translation table and reaches the private workload.

![Azure NAT Gateway SNAT infographic showing private source translation to stable public egress and return traffic](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model/nat-snat-translation.png)

*SNAT lets the private workload keep its VNet IP while NAT Gateway presents a stable public source address and tracks return traffic for the active connection.*

NAT Gateway works at the subnet level. Multiple subnets in the same VNet can use the same NAT Gateway, and one subnet can have one NAT Gateway attached. A Standard NAT Gateway can use up to 16 IPv4 public IP addresses, and Microsoft documents that each public IP address provides 64,512 SNAT ports for outbound connections. That means one NAT Gateway can scale to more than one million SNAT ports when enough public IPs are attached.

Those numbers are large, but the application still affects the outcome. If `orders-api-prod` creates a fresh HTTP client for every payment request, it can produce many short-lived outbound sockets to the same destination. Reusing clients and connection pools keeps socket pressure lower, reduces cooldown churn, and makes NAT capacity behave predictably under load.

```ts
const client = new PaymentProviderClient({
  baseUrl: process.env.PAYMENTS_BASE_URL,
  timeoutMs: 5000
});

export async function chargeOrder(orderId: string) {
  return client.post("/charges", { orderId });
}
```

The important idea in that small example is the long-lived client. The app creates the provider client once and reuses the underlying connection pool instead of creating a new network client inside every request handler. NAT Gateway gives the subnet a strong outbound platform, and application connection reuse helps that platform keep enough ports available during traffic spikes.

The infrastructure check should prove that the subnet actually uses the NAT Gateway. Effective routes still decide the packet path, and this check confirms the subnet association before the team inspects those routes.

```bash
az network vnet subnet show \
  --resource-group rg-devpolaris-network-prod \
  --vnet-name vnet-devpolaris-prod \
  --name snet-orders-api \
  --query "{subnet:name,natGateway:natGateway.id,defaultOutboundAccess:defaultOutboundAccess}"
```

Example output:

```json
{
  "subnet": "snet-orders-api",
  "natGateway": "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/natGateways/ngw-orders-prod",
  "defaultOutboundAccess": false
}
```

NAT Gateway also interacts with routes. If the subnet has a UDR for `0.0.0.0/0` to a virtual appliance or virtual network gateway, that UDR can override NAT Gateway for broad internet-bound traffic. A production review should look at both the NAT Gateway association and the effective routes before deciding which outbound path the packet actually takes.

## Connecting VNets and On-Premises Networks
<!-- section-summary: Peering, VPN Gateway, and ExpressRoute connect the VNet to other private networks, and those connections add routes that affect packet paths. -->

A single VNet can host a useful workload, but production networks often need more private connections. The Orders VNet might connect to a shared hub VNet, a data platform VNet, or a corporate datacenter. Each connection method changes the route story because Azure adds or propagates routes for the connected address spaces.

**VNet peering** connects two Azure virtual networks so resources can communicate through private IP addresses over Microsoft's backbone network. The peered VNets keep their own boundaries, address spaces, route tables, and security rules. Peering works well for hub-and-spoke designs where a shared hub provides firewall, DNS, or connectivity services to workload spokes.

**VPN Gateway** connects a VNet to another network through encrypted tunnels, commonly over the internet. It fits branch offices, partner connections, and early hybrid setups. **ExpressRoute** connects a private network to Microsoft through a connectivity provider, and teams use it when they need private connectivity with more predictable enterprise network integration.

The AWS anchors are VPC peering, Site-to-Site VPN, and Direct Connect. The Azure names are VNet peering, VPN Gateway, and ExpressRoute, and the shared operating habit is to review address overlap, propagated routes, security rules, and DNS before assuming two private networks can talk.

For the Orders team, a route to `10.80.0.0/16` might appear because the corporate network connects through VPN or ExpressRoute. A route to `10.10.0.0/16` might appear because a hub VNet is peered to the Orders VNet. Those routes can be correct and still surprise an app team that only reads the custom route table. Effective routes tell the fuller story.

| Connection | Plain-English job | Route effect |
|---|---|---|
| **VNet peering** | Connect Azure VNets privately | Adds routes for the peered VNet address space. |
| **VPN Gateway** | Connect Azure to another network through encrypted tunnels | Adds configured or BGP-learned routes through the gateway. |
| **ExpressRoute** | Connect through private enterprise connectivity | Propagates private network routes through the gateway path. |
| **Hub-and-spoke** | Centralize firewall, DNS, or shared services | Sends spoke traffic through peering and sometimes UDRs to the hub. |

This section also explains why address planning came early. Peering and hybrid routing work cleanly when each network owns a unique private range. Overlap turns every later connection into a routing problem, so the Orders VNet range should be chosen with known Azure and corporate ranges in view.

## A Production VNet Shape
<!-- section-summary: A practical VNet design assigns each subnet a job, makes outbound explicit, leaves growth room, and keeps route evidence reviewable. -->

Now the Orders VNet has enough pieces to read as a production design. The VNet gives one regional private boundary. The address space gives it private room. The subnets separate workload jobs. The route table makes broad outbound steering explicit. NAT Gateway or firewall egress gives the private app a clear public outbound path. Peering or gateways connect the private network to other private networks.

![Production Azure VNet topology showing Front Door, workload subnets, private endpoints, route table, firewall, NAT Gateway, corporate network, and payment provider](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model/production-vnet-shape.png)

*A production VNet review names the subnet, destination, route decision point, and egress path so network changes stay concrete instead of becoming vague connectivity guesses.*

This diagram keeps the article boundaries clear. Public entry belongs to the load balancing and edge routing topic. Packet filtering belongs to the network security group topic. Private endpoints and DNS belong to private connectivity. This article owns the foundation underneath those topics: VNet, address space, subnets, routes, outbound access, and network connection points.

A review of this design can stay concrete. `snet-orders-api` has enough usable IPs for scale. It has `defaultOutboundAccess` disabled for private-subnet behavior. It has a route table only where the route table serves a known job. It has a NAT Gateway or firewall path for outbound access. It has effective route evidence for private endpoints, corporate destinations, and public internet destinations.

That same review can catch common mistakes before users feel them. A private endpoint subnet that is too small can block new service endpoints. A route to a firewall with no return path can create timeouts. A broad `0.0.0.0/0` UDR can override a NAT Gateway path. A VNet range that overlaps with the corporate network can block hybrid connectivity later.

## Putting It All Together
<!-- section-summary: A VNet design is understandable when every workload has a subnet, every subnet has enough space, every route has a reason, and every outbound path is explicit. -->

A VNet gives Azure workloads a private regional network shape. The useful beginner view is one connected chain: choose a non-overlapping address space, carve it into role-based subnets, account for Azure's five reserved addresses per subnet, inspect effective routes, add UDRs only when the next hop is part of the design, and choose an explicit outbound method for private workloads.

The Orders production story now has clear network facts. `vnet-devpolaris-prod` owns `10.30.0.0/16`. `snet-orders-api` gives the API a private placement area. `snet-private-endpoints` holds private IPs for Azure SQL and Key Vault. Effective routes explain whether packets stay local, go to a firewall, use a gateway, or leave through NAT Gateway. The outbound path is an architecture choice, not a hidden platform surprise.

These facts make troubleshooting more practical. A connection failure can become a route question, a subnet sizing question, a private endpoint DNS question, a NAT source question, or a security rule question. The team can inspect each layer with evidence instead of changing random app settings and hoping the packet finds a path.

![Production VNet review checklist showing address space, subnet jobs, reserved IPs, effective routes, outbound path, and peering or gateway ranges](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-azure-networking-mental-model/production-vnet-review.png)

*Use this checklist before changing a VNet: check range overlap, subnet jobs, reserved IP capacity, effective routes, outbound path, and peering or gateway ranges.*

## What's Next

The VNet gives packets a possible path. The next article covers the packet filters that decide which flows can use that path: Azure network security groups and application security groups.

---

**References**

* [What is Azure Virtual Network?](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview) - Microsoft overview of VNets, communication scenarios, routing, service integration, and availability zone behavior.
* [Azure virtual network traffic routing](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview) - Microsoft reference for system routes, user-defined routes, route selection, route priority, and `0.0.0.0/0`.
* [Private IP addresses in Azure](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/private-ip-addresses) - Microsoft reference for Azure private IP assignment and the five reserved addresses in each subnet.
* [Default outbound access in Azure](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/default-outbound-access) - Microsoft guidance on default outbound access, private subnets, and the March 31, 2026 behavior change.
* [What is Azure NAT Gateway?](https://learn.microsoft.com/en-us/azure/nat-gateway/nat-overview) - Microsoft overview of NAT Gateway setup, subnet behavior, outbound precedence, and limitations.
* [Source Network Address Translation with Azure NAT Gateway](https://learn.microsoft.com/en-us/azure/nat-gateway/nat-gateway-snat) - Microsoft reference for SNAT port inventory, allocation, reuse, and scaling.
* [Subnet Delegation in Azure Virtual Network](https://learn.microsoft.com/en-us/azure/virtual-network/subnet-delegation-overview) - Microsoft overview of delegated subnets and service-specific subnet behavior.
* [Create, change, or delete Azure virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-manage-peering) - Microsoft reference for same-region and cross-region virtual network peering.

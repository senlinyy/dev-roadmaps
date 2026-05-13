---
title: "Virtual Networks, Subnets, and Routes"
description: "Plan Azure private address space, subnet placement, route tables, next hops, and effective route evidence for a production service."
overview: "Place orders-api in a production Azure network and learn why address ranges, VNet boundaries, subnet associations, and user-defined routes can make a healthy app look broken."
tags: ["azure", "vnet", "subnets", "routes"]
order: 2
id: article-cloud-providers-azure-networking-connectivity-virtual-networks-subnets-and-routes
---

## Table of Contents

1. [The Network Check Before Production](#the-network-check-before-production)
2. [What This Article Owns](#what-this-article-owns)
3. [The Orders API Production Network](#the-orders-api-production-network)
4. [Private Address Space Is A Promise](#private-address-space-is-a-promise)
5. [VNet Boundaries Decide What Shares A Routing Area](#vnet-boundaries-decide-what-shares-a-routing-area)
6. [Subnet Placement Changes Runtime Behavior](#subnet-placement-changes-runtime-behavior)
7. [System Routes Are Already There](#system-routes-are-already-there)
8. [User-Defined Routes Change The First Hop](#user-defined-routes-change-the-first-hop)
9. [Route Tables Belong To Subnets](#route-tables-belong-to-subnets)
10. [Next Hops Are Operational Dependencies](#next-hops-are-operational-dependencies)
11. [Evidence Before You Blame The App](#evidence-before-you-blame-the-app)
12. [Failure Path: A Healthy App With A Broken Route](#failure-path-a-healthy-app-with-a-broken-route)
13. [Failure Modes And Fix Directions](#failure-modes-and-fix-directions)
14. [A Review Habit Before Route Changes](#a-review-habit-before-route-changes)

## The Network Check Before Production

The `orders-api` service can pass every unit test and still fail the
first hour it is moved into production. The code starts. The container
is healthy. The deployment pipeline is green. Then checkout requests
begin timing out because the app is standing in a subnet whose traffic
does not follow the path the team expected.

That is the kind of failure this article owns. We are not debugging
business logic yet. We are checking whether a production workload has a
private address plan, a clear Virtual Network boundary, the right subnet
placement, and route evidence that matches the design.

An Azure Virtual Network, often shortened to VNet, is the private
network boundary you create for Azure resources in a region. A subnet is
a smaller address range inside that VNet. A route tells Azure the next
hop for traffic that leaves a subnet. A route table is the Azure
resource that holds your user-defined routes and becomes active only
after you associate it to a subnet.

Those terms sound tidy. Production makes them less tidy. The address
space chosen today decides whether tomorrow's VNet peering or VPN can
work. The subnet chosen for the app decides which route table and
network controls the app inherits. A single `0.0.0.0/0` user-defined
route can move every outbound call through an inspection device. If that
device is wrong or unreachable, the application symptom looks like a
payment outage, a database outage, or a DNS outage.

We will follow one concrete service. `orders-api` receives checkout
requests from a public entry point, writes order records to a database
through private network access, sends telemetry, and calls an external
payment provider. The team wants a network design that can be reviewed
before Terraform, Bicep, the Azure portal, or `az network` commands make
it real.

The production question is plain:
when traffic starts from `orders-api`, which subnet does it leave, which
route wins, and where is the next hop?

If we can answer that with evidence, a route problem becomes small
enough to fix. If we cannot answer it, we will waste time changing app
settings while the packet is being sent to the wrong place.

## What This Article Owns

The Azure networking module has several neighboring ideas. This article
keeps a narrow job so those ideas do not blur together.

We own the private address plan, the VNet boundary, the subnet placement
decision, the route table association, the next hop, and the evidence
that proves the route Azure is using. We mention DNS, private endpoints,
and network security groups only when they help separate a route failure
from a different network layer.

That distinction matters during incidents. If a public hostname,
certificate, or backend health check is wrong, the public entry article
owns the deeper fix. If a private endpoint is pending approval or
attached to the wrong service, the private access article owns that
topic. If a packet is denied by a network security group, the NSG
article owns the rule model.
Here we ask the route questions first:

| Question | This article's responsibility |
|----------|-------------------------------|
| What private IP range belongs to production? | Plan non-overlapping VNet and subnet CIDRs |
| Where does the app runtime sit? | Place the app in the intended subnet |
| Which custom routes apply? | Check the subnet's route table association |
| Which next hop wins for a destination IP? | Read effective routes and next-hop evidence |
| Why does the app look broken? | Trace the packet path before changing code |

This focus gives the article a useful mental model:
routes are not permission, identity, or name resolution. Routes answer
the first-hop question for traffic leaving a subnet. They decide where
Azure sends the packet next. Other layers can still allow, deny, resolve,
or reject the connection after the route is correct.

## The Orders API Production Network

Start with the network shape before the Azure resource names. The orders
service needs an app placement area, a private access area for managed
service endpoints, and an egress path for calls to the internet. The
egress path is where route mistakes become especially visible, because a
payment provider call often crosses that path during checkout.

Here is the production inventory we will use:

| Job | Azure resource | Address range or IP | Why it exists |
|-----|----------------|---------------------|---------------|
| Production private network | `vnet-orders-prod-uksouth` | `10.42.0.0/16` | Holds the private address space for this environment |
| API runtime placement | `snet-orders-api-prod` | `10.42.10.0/24` | Contains the app runtime integration or VM NICs |
| Private service access | `snet-orders-private-access-prod` | `10.42.20.0/24` | Contains private endpoint network interfaces |
| Build and admin tools | `snet-orders-ops-prod` | `10.42.30.0/24` | Contains controlled operational tooling |
| Egress inspection | `snet-orders-egress-prod` | `10.42.100.0/26` | Contains a firewall or network virtual appliance |
| Egress next hop | `nva-orders-egress-prod` | `10.42.100.4` | Receives selected traffic from route tables |

The same plan can be written as a compact artifact in a design review:

```yaml
networkIntent:
  environment: prod
  region: uksouth
  vnet:
    name: vnet-orders-prod-uksouth
    addressSpace:
      - 10.42.0.0/16
  subnets:
    - name: snet-orders-api-prod
      prefix: 10.42.10.0/24
      workload: orders-api runtime
      routeTable: rt-orders-api-prod
    - name: snet-orders-private-access-prod
      prefix: 10.42.20.0/24
      workload: private endpoint network interfaces
      routeTable: null
    - name: snet-orders-ops-prod
      prefix: 10.42.30.0/24
      workload: build agents and admin tools
      routeTable: rt-orders-ops-prod
    - name: snet-orders-egress-prod
      prefix: 10.42.100.0/26
      workload: egress inspection appliance
      routeTable: null
  app:
    name: orders-api
    sourceSubnet: snet-orders-api-prod
  routes:
    - table: rt-orders-api-prod
      prefix: 0.0.0.0/0
      nextHopType: VirtualAppliance
      nextHopIp: 10.42.100.4
```

This artifact is not meant to replace infrastructure code. It is meant
to make the production intent readable. A reviewer can see the address
space, the subnet roles, the route table on the app subnet, and the
egress next hop without clicking through several Azure blades.

Now read the same shape as a packet path:

```text
customer
  -> public HTTP entry point
  -> orders-api runtime in snet-orders-api-prod
  -> route decision on traffic leaving snet-orders-api-prod
  -> private destination in 10.42.20.0/24, or egress appliance at 10.42.100.4
  -> database, telemetry, or payment provider
```

The path is intentionally simple. The useful discipline is not drawing a
beautiful network. The useful discipline is knowing which source subnet
gets the first route decision.

## Private Address Space Is A Promise

Private address space is a promise that a range belongs to one network
design. When the team chooses `10.42.0.0/16` for production, it is saying
that addresses from `10.42.0.0` through `10.42.255.255` belong to this
production VNet unless the plan says otherwise.

CIDR notation is the compact way to write that promise. In `10.42.0.0/16`,
the `/16` means the first 16 bits stay fixed. That gives the VNet a large
block. In `10.42.10.0/24`, the `/24` gives one subnet a smaller slice of
that block. You do not need to do binary math during every design review,
but you do need to know that a smaller suffix number means a larger range.

Here is the planning scale for this article:

| CIDR | Role in this design | Planning meaning |
|------|---------------------|------------------|
| `10.42.0.0/16` | Production VNet | Large enough for several subnet groups |
| `10.42.10.0/24` | API subnet | Room for runtime scale and platform reservations |
| `10.42.20.0/24` | Private access subnet | Room for several private endpoint IPs |
| `10.42.100.0/26` | Egress appliance subnet | Smaller dedicated appliance range |

Azure reserves platform addresses in every subnet, so a subnet is never
as spacious as the raw CIDR count suggests. More importantly, cloud
networks need room for the services you have not deployed yet. A
perfectly packed address plan often becomes a migration project later.

The mistake to catch early is overlap. If `vnet-orders-prod-uksouth`
uses `10.42.0.0/16`, and a future hub VNet or office network also uses
`10.42.0.0/16`, private connectivity becomes ambiguous. A packet bound
for `10.42.10.25` cannot tell which network owns that destination. Azure
will not let overlapping VNets peer cleanly, and humans cannot fix that
ambiguity by adding a route table after the fact.

The production CIDR register should be boring and explicit:

```text
CIDR register for orders production

Allocated:
  10.10.0.0/16    corporate VPN
  10.20.0.0/16    shared platform hub
  10.41.0.0/16    staging Azure VNet
  10.42.0.0/16    production orders VNet

Reserved:
  10.43.0.0/16    future disaster recovery region
  10.44.0.0/16    future analytics VNet

Decision:
  vnet-orders-prod-uksouth may use 10.42.0.0/16.
  No known connected network currently owns that range.
```

This is not glamorous work. It is the work that prevents a Friday
afternoon peering failure from becoming a network redesign.

## VNet Boundaries Decide What Shares A Routing Area

A VNet is the private network boundary where Azure can route traffic
between subnets by default. If `snet-orders-api-prod` and
`snet-orders-private-access-prod` both sit inside `vnet-orders-prod-uksouth`,
Azure has a built-in route for traffic inside the VNet address space.
That does not mean every packet is allowed. It means the route layer has
a local path before security, DNS, and service checks have their say.

The boundary is regional and resource-scoped. A VNet lives in one Azure
region, inside a subscription and resource group. The route table,
subnets, network interfaces, and many troubleshooting commands all live
under Azure Resource Manager resource IDs. That is why "I checked the
route table" is not enough during an incident. You need to check the
route table in the same subscription, resource group, region, and VNet
where the app is actually running.

A VNet boundary also decides what does not share the local route. A
staging VNet with `10.41.0.0/16` is a different routing area until you
connect it with peering, VPN, ExpressRoute, or another network design.
An on-premises network is also separate until a gateway or routing
service exchanges routes. The same Azure tenant or subscription does not
magically create a private path.

The orders team can make that boundary visible in CLI evidence:

```bash
$ az network vnet show \
  --resource-group rg-orders-network-prod \
  --name vnet-orders-prod-uksouth \
  --query "{name:name,location:location,addressSpace:addressSpace.addressPrefixes,subnets:subnets[].{name:name,prefix:addressPrefix}}" \
  --output json
{
  "name": "vnet-orders-prod-uksouth",
  "location": "uksouth",
  "addressSpace": [
    "10.42.0.0/16"
  ],
  "subnets": [
    {
      "name": "snet-orders-api-prod",
      "prefix": "10.42.10.0/24"
    },
    {
      "name": "snet-orders-private-access-prod",
      "prefix": "10.42.20.0/24"
    },
    {
      "name": "snet-orders-ops-prod",
      "prefix": "10.42.30.0/24"
    },
    {
      "name": "snet-orders-egress-prod",
      "prefix": "10.42.100.0/26"
    }
  ]
}
```

This output proves the VNet address space and the subnet ranges. It does
not prove the app is in the right subnet. It also does not prove the
route table association. Treat it as the first layer of evidence, not
the whole diagnosis.

## Subnet Placement Changes Runtime Behavior

A subnet is a smaller address range, but that definition undersells it.
In production, a subnet is a placement decision. The runtime placed in
`snet-orders-api-prod` inherits the routing and network controls attached
to that subnet. If the same runtime lands in `snet-orders-ops-prod`, it
may still start, but its packet path can be completely different.

That is why "wrong subnet" is a real outage cause. The application
process does not know that a route table was meant for a different
subnet. It only sees timeouts. The platform team sees a healthy runtime
and a clean deployment. The route table may even look correct. The
missing fact is that the route table is not attached to the subnet where
the app source traffic begins.

The orders production design separates subnet roles:

| Subnet | Source traffic starts here? | Route table | What the placement means |
|--------|-----------------------------|-------------|--------------------------|
| `snet-orders-api-prod` | Yes, for app outbound calls | `rt-orders-api-prod` | Checkout dependency calls use the app egress policy |
| `snet-orders-private-access-prod` | No, for app runtime traffic | None | Private endpoint IPs sit here, but the app does not inherit this subnet |
| `snet-orders-ops-prod` | Yes, for admin tooling | `rt-orders-ops-prod` | Operational tools may have a different outbound path |
| `snet-orders-egress-prod` | Yes, for appliance traffic | None | The appliance forwards or drops traffic after receiving it |

Notice the private access subnet. It contains private endpoint network
interfaces for managed services. It is not where the app runtime stands.
Putting a route table on that subnet does not change the app subnet's
outbound route. This is a common beginner mix-up because the database
private IP may live there, so the subnet feels "database related." Route
tables care about the source subnet for traffic leaving a resource.

Placement evidence depends on the compute service. A virtual machine has
a network interface. App Service VNet integration, Container Apps
environment networking, and Kubernetes nodes each expose the placement
through different resource views. The habit is the same: prove the
source subnet before reading routes.

For a VM-hosted example, the app NIC shows its subnet:

```bash
$ az network nic show \
  --resource-group rg-orders-app-prod \
  --name nic-orders-api-prod-01 \
  --query "{name:name,privateIp:ipConfigurations[0].privateIPAddress,subnet:ipConfigurations[0].subnet.id}" \
  --output json
{
  "name": "nic-orders-api-prod-01",
  "privateIp": "10.42.10.17",
  "subnet": "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-network-prod/providers/Microsoft.Network/virtualNetworks/vnet-orders-prod-uksouth/subnets/snet-orders-api-prod"
}
```

That subnet ID is a more useful clue than the app's resource group. It
tells us where outbound routing begins.

## System Routes Are Already There

Azure creates system routes for every subnet in a VNet. That means the
subnet already has route behavior before you create a route table. The
system route for the VNet address space lets subnets inside the VNet
communicate by default. Other default system routes handle the internet
path and several private ranges that are not otherwise known to the VNet.

The most useful beginner insight is this:
you do not create routes so two subnets in the same VNet can find each
other. Azure already has a route for the VNet address space. You add
user-defined routes when the default route is not the path you want.

In our design, `orders-api` at `10.42.10.17` can have a local route to a
private endpoint IP at `10.42.20.8`, because both addresses are inside
the VNet address space `10.42.0.0/16`. A network security group or target
service can still block the connection, but the route layer has a local
path.

Effective route evidence might show this:

```text
Source    State   Address Prefix    Next Hop Type       Next Hop IP
--------  ------  ----------------  ------------------  -----------
Default   Active  10.42.0.0/16      VNetLocal
Default   Active  0.0.0.0/0         Internet
Default   Active  10.0.0.0/8        None
Default   Active  172.16.0.0/12     None
Default   Active  192.168.0.0/16    None
Default   Active  100.64.0.0/10     None
```

Read this table by destination. A packet for `10.42.20.8` matches
`10.42.0.0/16`, so the next hop is the local VNet path. A packet for
`8.8.8.8` does not match the VNet range, so the default internet route
can win unless a custom route overrides it. A packet for `10.10.4.20`
may match the broader `10.0.0.0/8` route with next hop `None` unless a
more specific route to corporate networks exists.

That last example matters. Many teams expect all private RFC 1918
addresses to be reachable from Azure. They are not. A private address in
another network still needs a route and a connection. If corporate DNS
returns `10.10.4.20` for an internal service, but the VNet has no VPN,
ExpressRoute, peering, or specific route for `10.10.0.0/16`, the app
will see an outage even though the target IP looks private.

Azure selects routes by longest prefix match first. A route for
`10.42.20.0/24` is more specific than `10.42.0.0/16`, so it wins for a
destination such as `10.42.20.8`. If multiple routes have the same
prefix, Azure route source priority matters. User-defined routes win
over BGP routes, and BGP routes win over system routes for the same
prefix, with documented exceptions for certain preferred system routes.

The practical habit is simpler than the implementation detail:
for the destination IP in the incident, find the most specific active
route that applies to the source subnet.

## User-Defined Routes Change The First Hop

A user-defined route, often shortened to UDR, is a custom route you add
because Azure's default route is not the path you want. In production,
UDRs commonly send internet-bound traffic through a firewall or network
virtual appliance. They can also send traffic to a virtual network
gateway or keep a specific prefix on the VNet path.

The orders team wants outbound internet calls from `orders-api` to pass
through an inspection appliance. That means a custom route for the app
subnet:

| Route name | Address prefix | Next hop type | Next hop IP | Intent |
|------------|----------------|---------------|-------------|--------|
| `default-to-egress` | `0.0.0.0/0` | `VirtualAppliance` | `10.42.100.4` | Send internet-bound app traffic to inspection |

The route does not say "allow checkout traffic." It only says that
destinations not matched by a more specific route should use the
appliance as the next hop. The appliance, firewall policy, DNS, and
destination service still need to cooperate.

The CLI artifact for the custom route looks like this:

```bash
$ az network route-table route list \
  --resource-group rg-orders-network-prod \
  --route-table-name rt-orders-api-prod \
  --output table
Name               AddressPrefix    NextHopType       NextHopIpAddress
-----------------  ---------------  ----------------  ----------------
default-to-egress  0.0.0.0/0        VirtualAppliance  10.42.100.4
```

That output proves the route exists in the route table. It does not
prove the route table is attached to the app subnet. It does not prove
the app is in that subnet. It does not prove the appliance can forward
traffic. Each of those is a separate check.

The most dangerous UDR for beginners is `0.0.0.0/0`. It is powerful
because it catches almost every IPv4 destination that does not have a
more specific route. It is risky for the same reason. When you override
the default internet route with a virtual appliance, a wrong appliance
IP can break payment providers, package downloads, telemetry export, and
calls to Azure services reached through public endpoints.

A narrower route can be safer when the intent is narrow. For example,
if only corporate service traffic should cross a VPN, a route for
`10.10.0.0/16` is easier to reason about than sending all destinations
through a gateway. Broad routes are not bad. Broad routes just deserve a
clear owner and strong evidence.

## Route Tables Belong To Subnets

A route table in Azure is a resource that can hold user-defined routes.
By itself, it changes nothing. Azure applies the table only after you
associate it to a subnet. Route tables are not associated to a whole
VNet. A route table can be associated with zero or more subnets, and a
subnet can have zero or one route table.

This is the small detail that explains many route incidents. The orders
team creates `rt-orders-api-prod` with a correct `0.0.0.0/0` route. The
route table sits in the resource group. Everyone can see it. The app
still bypasses inspection because `snet-orders-api-prod` has no route
table association.

The association is visible on the subnet:

```bash
$ az network vnet subnet show \
  --resource-group rg-orders-network-prod \
  --vnet-name vnet-orders-prod-uksouth \
  --name snet-orders-api-prod \
  --query "{name:name,addressPrefix:addressPrefix,routeTable:routeTable.id}" \
  --output json
{
  "name": "snet-orders-api-prod",
  "addressPrefix": "10.42.10.0/24",
  "routeTable": "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-network-prod/providers/Microsoft.Network/routeTables/rt-orders-api-prod"
}
```

The route table resource is not enough evidence. The subnet association
is the evidence. During a review, ask for both:

```bash
$ az network route-table show \
  --resource-group rg-orders-network-prod \
  --name rt-orders-api-prod \
  --query "{name:name,location:location,routes:routes[].{name:name,prefix:addressPrefix,nextHop:nextHopType,nextHopIp:nextHopIpAddress}}" \
  --output json
{
  "name": "rt-orders-api-prod",
  "location": "uksouth",
  "routes": [
    {
      "name": "default-to-egress",
      "prefix": "0.0.0.0/0",
      "nextHop": "VirtualAppliance",
      "nextHopIp": "10.42.100.4"
    }
  ]
}
```

Then check the subnet:

```bash
$ az network vnet subnet show \
  --resource-group rg-orders-network-prod \
  --vnet-name vnet-orders-prod-uksouth \
  --name snet-orders-api-prod \
  --query "routeTable.id" \
  --output tsv
/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-network-prod/providers/Microsoft.Network/routeTables/rt-orders-api-prod
```

Azure also requires the route table and the target subnet's VNet to be
in the same subscription and Azure location. That detail is easy to
forget when a platform team centralizes network resources. A route table
in a shared network resource group can work if it is in the right
subscription and location for the VNet. A route table in a different
region cannot be attached to this subnet just because the name matches.

Shared route tables are a tradeoff. One shared table keeps several
subnets consistent. It also gives every route change a wider blast
radius. A route table named `rt-prod-egress-shared` should make that
shared impact obvious. For a single production API, a role-specific name
such as `rt-orders-api-prod` is often safer to review.

## Next Hops Are Operational Dependencies

The next hop is where Azure sends matching traffic. That can be the
local virtual network path, the internet path, a virtual network gateway,
or a virtual appliance. When the route points to `VirtualAppliance`, the
next hop IP is not just a value in a table. It is an operational
dependency that must exist, receive traffic, and forward traffic
correctly.

For orders production, the egress appliance IP is `10.42.100.4`. The
route table sends default traffic there. If that appliance loses
forwarding, has the wrong firewall policy, or is replaced without
updating the route, the app sees timeouts. The app may report:
"payment provider unavailable." The network truth may be:
"the first hop for internet traffic is wrong."

A virtual appliance route deserves a small dependency record:

```text
Egress dependency for orders-api

Route table:
  rt-orders-api-prod

Route:
  0.0.0.0/0 -> VirtualAppliance 10.42.100.4

Appliance:
  name: nva-orders-egress-prod
  private IP: 10.42.100.4
  subnet: snet-orders-egress-prod
  owner: platform-networking

Required behavior:
  accepts traffic from 10.42.10.0/24
  forwards allowed HTTPS traffic to the internet
  returns traffic without asymmetric routing
  emits firewall decision logs
```

That record connects a route to the thing that has to do work after the
route wins. Without it, teams often treat a route table as if it were a
complete solution. It is not. A UDR can direct traffic to an appliance
that drops every packet.

There is also a routing-loop risk. If the appliance subnet has a route
that sends its own outbound traffic back to itself or back through the
source route in the wrong way, packets can disappear. In hub and spoke
networks, this becomes more subtle because one route table may send
spoke traffic to a hub appliance, and the hub appliance needs a return
path to the spoke. The beginner rule is to check both directions: source
to next hop, and next hop back to source.

When the next hop is a virtual network gateway, the dependency changes.
Now the route relies on gateway health and route propagation from a VPN
or ExpressRoute design. When the next hop is `Internet`, the dependency
is Azure's default internet path. The route table tells you the next
place. It does not prove that the next place is healthy.

## Evidence Before You Blame The App

Good route debugging begins with source placement and effective routes.
The app log tells you what the app experienced. Azure route evidence
tells you whether the network path matches the design.

Start by proving you are inspecting production:

```bash
$ az account show \
  --query "{subscription:name,subscriptionId:id,tenantId:tenantId}" \
  --output json
{
  "subscription": "sub-orders-prod",
  "subscriptionId": "11111111-2222-3333-4444-555555555555",
  "tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
}
```

Then prove the source subnet:

```bash
$ az network nic show \
  --resource-group rg-orders-app-prod \
  --name nic-orders-api-prod-01 \
  --query "{privateIp:ipConfigurations[0].privateIPAddress,subnet:ipConfigurations[0].subnet.id}" \
  --output json
{
  "privateIp": "10.42.10.17",
  "subnet": "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-network-prod/providers/Microsoft.Network/virtualNetworks/vnet-orders-prod-uksouth/subnets/snet-orders-api-prod"
}
```

Now prove the subnet route table:

```bash
$ az network vnet subnet show \
  --resource-group rg-orders-network-prod \
  --vnet-name vnet-orders-prod-uksouth \
  --name snet-orders-api-prod \
  --query "{name:name,prefix:addressPrefix,routeTable:routeTable.id}" \
  --output json
{
  "name": "snet-orders-api-prod",
  "prefix": "10.42.10.0/24",
  "routeTable": "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-network-prod/providers/Microsoft.Network/routeTables/rt-orders-api-prod"
}
```

Then read the effective route table for the NIC:

```bash
$ az network nic show-effective-route-table \
  --resource-group rg-orders-app-prod \
  --name nic-orders-api-prod-01 \
  --output table
Source    State   Address Prefix    Next Hop Type       Next Hop IP
--------  ------  ----------------  ------------------  -----------
Default   Active  10.42.0.0/16      VNetLocal
User      Active  0.0.0.0/0         VirtualAppliance    10.42.100.4
Default   Active  10.0.0.0/8        None
Default   Active  172.16.0.0/12     None
Default   Active  192.168.0.0/16    None
Default   Active  100.64.0.0/10     None
```

This output is stronger than the route table list because it is scoped
to the actual network interface. It shows the routes Azure sees for that
source. The `User` row proves the custom default route is active. The
`VNetLocal` row proves the local VNet route still exists for
`10.42.0.0/16`.

If the destination is known, ask Azure for the next hop. For example,
the payment provider resolved to an example public IP in this incident:

```bash
$ az network watcher show-next-hop \
  --resource-group rg-orders-app-prod \
  --vm vm-orders-api-prod-01 \
  --source-ip 10.42.10.17 \
  --dest-ip 203.0.113.54 \
  --output json
{
  "nextHopType": "VirtualAppliance",
  "nextHopIpAddress": "10.42.100.4",
  "routeTableId": "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-network-prod/providers/Microsoft.Network/routeTables/rt-orders-api-prod"
}
```

That output does not say the payment provider is reachable. It says the
first network hop from this VM to that destination is the appliance at
`10.42.100.4`. If the appliance logs show drops, the failure has moved
past the Azure route decision and into appliance policy or forwarding.

Keep app logs in the same bundle:

```text
2026-05-11T08:43:19Z orders-api prod checkout payment_authorize failed
request_id=ord_8a913f
source_ip=10.42.10.17
target=payments.example.net
resolved_ip=203.0.113.54
error=connect ETIMEDOUT 203.0.113.54:443
```

This log is useful because it includes the resolved destination IP. A
route table does not match a hostname. It matches a destination IP. If
the app only reports a name, resolve the name from the same runtime
context before making route claims.

## Failure Path: A Healthy App With A Broken Route

Now put the pieces together in a realistic failure. The team deploys a
new checkout release at 09:00. The app starts cleanly. Health checks pass
because `/healthz` only checks process liveness and a local dependency.
At 09:08, checkout payments begin timing out.

The first app evidence looks like this:

```text
2026-05-11T09:08:14Z orders-api prod error payment_authorize timeout
request_id=ord_19b7c1
target=payments.example.net
resolved_ip=203.0.113.54
duration_ms=30000
error=connect ETIMEDOUT 203.0.113.54:443

2026-05-11T09:08:18Z orders-api prod warning checkout_queue_depth_high
queue=checkout-authorize
depth=148
```

It is tempting to blame the app release because the timing lines up.
The better first question is whether the network path changed. The app
is trying to reach a public IP on port `443`, so the route table for the
source subnet matters.

The effective route table shows the problem:

```bash
$ az network nic show-effective-route-table \
  --resource-group rg-orders-app-prod \
  --name nic-orders-api-prod-01 \
  --output table
Source    State   Address Prefix    Next Hop Type       Next Hop IP
--------  ------  ----------------  ------------------  -----------
Default   Active  10.42.0.0/16      VNetLocal
User      Active  0.0.0.0/0         VirtualAppliance    10.42.100.99
Default   Active  10.0.0.0/8        None
Default   Active  172.16.0.0/12     None
Default   Active  192.168.0.0/16    None
Default   Active  100.64.0.0/10     None
```

The expected egress appliance IP is `10.42.100.4`, but the active UDR
points at `10.42.100.99`. The app is healthy enough to make the call.
Azure is sending the packet to the wrong next hop.

The route table history explains why:

```text
Change record

09:03Z  rt-orders-api-prod/default-to-egress changed
        previous nextHopIpAddress: 10.42.100.4
        current nextHopIpAddress:  10.42.100.99
        requestedBy: platform-rollout-sp
        changeReason: firewall blue-green cutover
```

The appliance cutover changed the route before the new appliance was
ready. From the application's point of view, this looks like an external
payment outage. From the network's point of view, it is a broken first
hop.

The fix direction is not to add retries or redeploy the app. The safe
fix is to restore the known-good next hop or complete the appliance
cutover, then prove the effective route again:

```bash
$ az network route-table route update \
  --resource-group rg-orders-network-prod \
  --route-table-name rt-orders-api-prod \
  --name default-to-egress \
  --next-hop-ip-address 10.42.100.4

$ az network nic show-effective-route-table \
  --resource-group rg-orders-app-prod \
  --name nic-orders-api-prod-01 \
  --output table
Source    State   Address Prefix    Next Hop Type       Next Hop IP
--------  ------  ----------------  ------------------  -----------
Default   Active  10.42.0.0/16      VNetLocal
User      Active  0.0.0.0/0         VirtualAppliance    10.42.100.4
Default   Active  10.0.0.0/8        None
Default   Active  172.16.0.0/12     None
Default   Active  192.168.0.0/16    None
Default   Active  100.64.0.0/10     None
```

After the route evidence is correct, the team still checks the appliance
logs and application metrics. A fixed route does not prove the whole
payment path is healthy. It proves the first network hop now matches the
intended design.

## Failure Modes And Fix Directions

The most common VNet, subnet, and route failures have a pattern. They
feel like application outages because the app reports the timeout, but
the fix lives in address planning, placement, or next-hop routing.

The first failure is overlapping address space. It often appears when a
team tries to peer a new VNet with a hub or connect production to an
on-premises network:

```text
Peering operation failed.
Virtual networks vnet-orders-prod-uksouth and vnet-platform-hub-uksouth
have overlapping address spaces.

vnet-orders-prod-uksouth:      10.42.0.0/16
vnet-platform-hub-uksouth:     10.42.0.0/17
```

Fix direction:
do not try to solve overlap with a route table. Choose a non-overlapping
range, rebuild or migrate the affected VNet, and update the CIDR
register so the mistake is not repeated. Routes cannot make two networks
stop claiming the same address.

The second failure is the app in the wrong subnet:

```text
Expected placement:
  app subnet: snet-orders-api-prod
  route table: rt-orders-api-prod

Actual placement:
  app subnet: snet-orders-ops-prod
  route table: rt-orders-ops-prod
```

Fix direction:
move or redeploy the runtime integration into the intended subnet. Then
verify the source subnet and effective routes from the real runtime or
network interface. Do not update the route table until you prove the
source placement.

The third failure is a route table that exists but is not associated:

```bash
$ az network vnet subnet show \
  --resource-group rg-orders-network-prod \
  --vnet-name vnet-orders-prod-uksouth \
  --name snet-orders-api-prod \
  --query "routeTable.id" \
  --output tsv

```

The empty output is the evidence. The route table may be perfect, but it
is not affecting this subnet.

Fix direction:
associate the route table to the source subnet. Then read effective
routes from the app's NIC or service-specific network view.

The fourth failure is a broad default route through the wrong next hop:

```text
Route table:
  rt-orders-api-prod

Active route:
  0.0.0.0/0 -> VirtualAppliance 10.42.100.99

Expected route:
  0.0.0.0/0 -> VirtualAppliance 10.42.100.4

App symptom:
  payment provider timeout
  telemetry export timeout
  image pull failures during restart
```

Fix direction:
restore the correct next hop or bring the new appliance fully online.
Check appliance forwarding and logs. Then confirm effective routes and a
real application dependency call.

The fifth failure is missing a specific route to another private
network. The destination looks private, so someone assumes it is
reachable:

```text
App target:
  pricing.internal.corp -> 10.10.4.20

Effective route:
  10.0.0.0/8 -> None

App symptom:
  connect ETIMEDOUT 10.10.4.20:443
```

Fix direction:
create or restore the intended private connectivity, such as VPN,
ExpressRoute, peering, or a routing service, and make sure a more
specific route for `10.10.0.0/16` appears for the source subnet. Do not
open a random public path just because the private path is missing.

The sixth failure is route evidence that is correct while another layer
still blocks the call:

```text
Route evidence:
  10.42.20.8 matched 10.42.0.0/16 with next hop VNetLocal

Connection symptom:
  connect ETIMEDOUT 10.42.20.8:5432

Likely next checks:
  subnet or NIC network security group
  private endpoint approval and target
  database listener or service firewall
  application hostname and port
```

Fix direction:
keep the route conclusion narrow. The route is not the problem if the
right route wins. Move to the next layer instead of changing routes
until something else breaks.

The seventh failure is a shared route table changed for one team and
felt by three teams:

```text
Route table:
  rt-prod-egress-shared

Associated subnets:
  snet-orders-api-prod
  snet-billing-api-prod
  snet-support-api-prod

Change:
  0.0.0.0/0 next hop changed from 10.42.100.4 to 10.42.100.99
```

Fix direction:
review route table associations before changing a shared route. If one
service needs a different egress path, create a narrower route table or
move the change to a subnet-specific association.

## A Review Habit Before Route Changes

The tradeoff in Azure routing is between default simplicity and
controlled paths. System routes make a new VNet useful quickly. Azure
can route between subnets in the VNet and provide a default path for
destinations that do not match a more specific route. That simplicity is
valuable when the network is small and the risk is low.

User-defined routes give you control. They let a team steer traffic
through inspection, gateways, or carefully chosen next hops. That control
adds responsibility. Every custom route needs an owner, a source subnet,
a destination prefix, a next hop, and a way to prove it is active.

Before changing a route table, write the decision as a short review:

```text
Route change review

Source subnet:
  snet-orders-api-prod

Current effective route for 203.0.113.54:
  0.0.0.0/0 -> VirtualAppliance 10.42.100.4

Proposed route:
  0.0.0.0/0 -> VirtualAppliance 10.42.100.99

Reason:
  move app egress to replacement appliance

Blast radius:
  only subnets associated with rt-orders-api-prod

Pre-change evidence:
  new appliance receives test traffic from 10.42.10.0/24
  new appliance forwards HTTPS to the internet
  return path to 10.42.10.0/24 works

Post-change evidence:
  effective route on orders-api source shows 10.42.100.99
  next-hop check for payment provider returns VirtualAppliance 10.42.100.99
  checkout smoke test succeeds
  appliance logs show allow decision
```

This review is short enough to fit in a pull request. It protects the
team from the two most common routing mistakes: changing the wrong
subnet's behavior and changing the right subnet before the next hop is
ready.

When an app looks broken after a network change, come back to the route
questions in order:
where is the source resource placed, what destination IP is it trying to
reach, which effective route wins, what next hop receives the packet,
and what evidence proves the next hop forwarded or dropped it?

Those questions do not solve every network problem. They do make VNet,
subnet, and route failures concrete enough that the team can stop
guessing and start fixing the right layer.

---

**References**

- [What is Azure Virtual Network?](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview) - Used for the VNet, subnet, communication, filtering, routing, and integration model.
- [Plan Azure virtual networks](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-vnet-plan-design-arm) - Used for address space planning, non-overlapping subnet ranges, and service subnet planning guidance.
- [Private IP addresses](https://learn.microsoft.com/azure/virtual-network/ip-services/private-ip-addresses) - Used for private IP allocation behavior and Azure-reserved subnet addresses.
- [Azure virtual network traffic routing](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview) - Used for system routes, user-defined routes, next hop types, route selection, and `0.0.0.0/0` behavior.
- [Create, change, or delete an Azure route table](https://learn.microsoft.com/en-us/azure/virtual-network/manage-route-table) - Used for route table operations, subnet association rules, and same-location and same-subscription constraints.
- [Diagnose an Azure virtual machine routing problem](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-network/diagnose-network-routing-problem) - Used for effective route table evidence and route debugging workflow.

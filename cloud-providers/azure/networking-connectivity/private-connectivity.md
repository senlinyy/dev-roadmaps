---
title: "Private Connectivity"
description: "Use private endpoints, Private Link, private DNS, service endpoints, resource firewalls, peering, and hybrid paths to keep Azure service access controlled."
overview: "After public traffic reaches the app, the app still needs controlled private paths to Azure SQL, Key Vault, and Storage. This article follows one orders API through private endpoints, Private Link, private DNS, resource firewalls, service endpoints, VNet peering, hybrid DNS, and the evidence teams collect during a real incident."
tags: ["azure", "private-link", "private-endpoints", "private-dns", "service-endpoints"]
order: 4
id: article-cloud-providers-azure-networking-connectivity-public-and-private-access
aliases:
  - private-connectivity
  - public-and-private-access
  - azure-public-and-private-access
  - private-link-and-service-endpoints
  - cloud-providers/azure/networking-connectivity/public-and-private-access.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Private Endpoints](#private-endpoints)
3. [Private Link](#private-link)
4. [Private DNS](#private-dns)
5. [Resource Firewalls](#resource-firewalls)
6. [Service Endpoints](#service-endpoints)
7. [VNet And Hybrid Reach](#vnet-and-hybrid-reach)
8. [Evidence](#evidence)
9. [Putting It All Together](#putting-it-all-together)

## The Problem
<!-- section-summary: Private connectivity starts by deciding which resources need public reachability and which resources should only accept controlled private paths. -->

The previous article got users from `orders.devpolaris.com` to the public edge of the orders system. Front Door handled the global entry point, Application Gateway handled regional layer 7 routing, and the backend app stayed in a private subnet. That solves how users reach the app, but the app still has to reach Azure SQL, Key Vault, and Blob Storage after the request arrives.

That second path needs a different design. The browser should reach the public entry point, while the database, secrets store, and internal object data should be reached through private network paths. If every managed service keeps a wide public endpoint and the team only adds IP firewall rules after each breakage, production slowly turns into a pile of exceptions that becomes hard to trust.

**Private connectivity** means the workload reaches a service through a controlled private path from the VNet. In Azure, the main pieces are **private endpoints**, **Private Link**, **private DNS**, and the service's own network settings. A private endpoint gives the service a private IP in your VNet, Private Link carries traffic to the Azure service, private DNS makes the normal hostname resolve to that private IP, and the service firewall controls public access.

Here is the production story we will follow. `orders-api` runs in `vnet-devpolaris-prod`. It needs Azure SQL for orders, Key Vault for secrets, and Blob Storage for invoice exports. Customers reach the app through the public entry chain, but the app's data path should stay private.

| Resource | Public reachability | Private path |
| --- | --- | --- |
| `orders.devpolaris.com` | Yes, through Front Door and Application Gateway | Backend subnet stays private behind the entry chain |
| `devpolaris-orders-sql` | Closed for normal app traffic | Private endpoint in `snet-private-endpoints` |
| `kv-orders-prod` | Closed for normal app traffic | Private endpoint plus Key Vault network rules |
| `stordersprod` Blob | Closed or tightly scoped | Private endpoint for `blob`, sometimes service endpoint policy for simpler subnet access |

![Public entry path separated from private dependency access for orders-api, Azure SQL, Key Vault, and Blob Storage](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-public-and-private-access/public-private-boundary.png)

*Use this as the first split: customers enter through public edge services, while the app reaches SQL, Key Vault, and Blob Storage through private dependency paths with their own evidence.*

The key idea is to split **public entry** from **private dependency access**. The public entry path has DNS, TLS, WAF, health probes, and backend routing. The private dependency path has service hostnames, private DNS, private endpoint IPs, service firewalls, routes, and identity authorization.

Once you know which resources belong on the private side, the next question is simple. How does a managed Azure service like SQL get a private IP inside your VNet when Azure still operates the service outside your subnet? That object is the private endpoint.

## Private Endpoints
<!-- section-summary: A private endpoint is a private network interface in your VNet that connects one service instance and one target subresource to a private IP. -->

A **private endpoint** is a network interface in your VNet that uses an IP address from one of your subnets. Azure attaches that interface to one specific service connection, such as one SQL server, one Key Vault, or one Storage subresource. From the app's point of view, the target now has a private address inside the network it already uses.

For the orders system, the SQL private endpoint might look like this. The endpoint resource is named `pe-orders-sql`, it lives in `snet-private-endpoints`, and Azure assigns it `10.30.40.7`. The SQL server is still an Azure SQL server managed by Azure, but the app reaches it through that private endpoint IP.

![Private endpoint path showing service hostname, private DNS answer, approved private endpoint, and Private Link to Azure SQL](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-public-and-private-access/private-endpoint-path.png)

*Use this as the private endpoint path: the app keeps a service name, DNS returns the private endpoint IP, and Private Link carries the approved connection to Azure SQL.*

Private endpoints have a few details that matter in real designs. First, a private endpoint consumes an IP address from the subnet where you place it. Teams often create a dedicated `snet-private-endpoints` subnet so endpoint IPs, route tables, network policies, and operations stay easy to reason about.

Second, the **target subresource** matters. A Storage account has different subresources such as `blob`, `dfs`, `file`, `queue`, `table`, and `web`. A private endpoint for `blob` covers Blob access, while Data Lake Storage Gen2 workflows may also need `dfs`. A Key Vault private endpoint targets the `vault` subresource. Azure SQL commonly uses the `sqlServer` group.

Third, the private endpoint connection has an approval state. When the requester has the right permissions on the target service, Azure can approve the connection automatically. When the service belongs to another subscription, team, tenant, or provider, the service owner may need to approve it manually. Traffic starts flowing only after the connection becomes `Approved`.

Fourth, network placement controls who can reach the endpoint. Clients in the same VNet can reach it when routes and security rules allow the path. Clients in peered VNets, on-premises networks connected through VPN or ExpressRoute, and other routed environments can also use the endpoint when routing and DNS line up.

That last sentence introduces the next layer. The private endpoint is the local network object, but Azure still needs a platform path from that object to the managed service. That platform path is Private Link.

## Private Link
<!-- section-summary: Private Link is the Azure platform path that carries private endpoint traffic to a specific Azure, customer-owned, or partner service over Microsoft's backbone. -->

**Azure Private Link** is the managed connectivity system behind private endpoints. A private endpoint is the network interface you see in your VNet. Private Link is the Azure service fabric that carries traffic from that interface to the target service over Microsoft's backbone network.

This distinction helps during design reviews. When someone says "we added Private Link for SQL," the concrete resource in the VNet is the private endpoint. Private Link is the platform feature that makes that private endpoint connect to Azure SQL, Azure Storage, Key Vault, Cosmos DB, or another supported private-link resource.

Private Link is also resource-specific. The endpoint maps to one selected service instance, which gives the orders app a private path to `devpolaris-orders-sql`. Any other SQL server in the subscription needs its own intended path, and this resource-level mapping is one reason teams use Private Link to reduce data exfiltration paths.

Private Link covers more than Azure-owned PaaS services. A team can publish its own service through **Private Link service** by placing it behind a Standard Load Balancer and sharing a resource ID or alias with consumers. That pattern shows up when a platform team exposes an internal payment API to other business units without placing the payment API on the public internet.

For this article, we are mostly consuming Azure services through private endpoints. The practical workflow is the same across SQL, Key Vault, and Storage: create the private endpoint, approve the connection, configure DNS, then lock down the service's public network path.

Now the path has a private IP, but the application usually connects to service names like `devpolaris-orders-sql.database.windows.net`. The name still has to produce the private endpoint address, so private connectivity often succeeds or fails at DNS before it ever reaches routing.

## Private DNS
<!-- section-summary: Private DNS makes the normal Azure service hostname resolve to the private endpoint IP inside the right networks. -->

**DNS** maps a name to an address. In this design, **private DNS** makes the normal service hostname answer with the private endpoint IP for the VNets that should use the private path. The application can keep using its normal SQL connection string, Key Vault URI, or Storage URL while the network sends the traffic to the private endpoint.

For the orders SQL server, the app still asks for `devpolaris-orders-sql.database.windows.net`. Azure's public DNS chain can point that name toward a `privatelink` name, and the linked private DNS zone supplies the private endpoint address for clients inside the production VNet.

| Name the app uses | Private DNS zone | Answer inside prod VNet |
| --- | --- | --- |
| `devpolaris-orders-sql.database.windows.net` | `privatelink.database.windows.net` | `10.30.40.7` |
| `kv-orders-prod.vault.azure.net` | `privatelink.vaultcore.azure.net` | Private endpoint IP for Key Vault |
| `stordersprod.blob.core.windows.net` | `privatelink.blob.core.windows.net` | Private endpoint IP for Blob |

This is sometimes called split DNS. A developer laptop on a coffee shop network may resolve the SQL hostname to the public Azure service path. The production app subnet resolves the same logical service name to the private endpoint IP. The name stays familiar, while the answer changes based on where the query comes from.

The private DNS zone needs to be linked to every VNet that should resolve the private endpoint address. In a hub-and-spoke design, the platform team may link `privatelink.database.windows.net` to the app spoke, the operations spoke, and the shared services VNet. Without those links, a VM or container can have perfect routing to `10.30.40.7` and still call the public endpoint because DNS gave it the public answer.

Hybrid networks add one more step. On-premises DNS servers need a way to resolve Azure private zones, so teams commonly use **Azure DNS Private Resolver** with inbound endpoints and conditional forwarding. The on-premises resolver forwards `privatelink.database.windows.net` queries to Azure, Azure resolves the private zone, and the on-premises client receives the private endpoint IP.

DNS and access control stay separate. A successful DNS lookup proves that a name exists and that the resolver returned an address. The remaining questions stay open: private endpoint approval, route table behavior, service firewall acceptance, and identity permission for the database or secret.

Once DNS returns the private endpoint IP, the next control lives inside the target service. The private path can be correct while the service's public endpoint is still too open, so the service firewall deserves its own section.

## Resource Firewalls
<!-- section-summary: Resource firewalls and public network access settings decide which network paths the service accepts after the private endpoint exists. -->

A **resource firewall** is the network access control built into the Azure service itself. Azure SQL, Storage, Key Vault, Cosmos DB, and many other services have their own network settings. These settings decide which public networks, selected VNets, trusted services, or private endpoint connections can reach the service.

Creating a private endpoint gives the service a private path, and the service's public endpoint settings remain their own control. For Storage, Microsoft documents this clearly: a private endpoint can be created while the public endpoint still has its own firewall behavior. Production teams usually pair the private endpoint with a public network access setting or firewall default action that matches the intended exposure.

For the orders system, the desired state is straightforward. Azure SQL should accept the approved private endpoint path from `orders-api`, and normal public network access should be closed. Key Vault should accept the private endpoint path and still require proper Entra ID authorization for secret reads. Blob Storage should accept the private endpoint for app traffic, while any public or selected-network access should be intentional and documented.

Network access and identity authorization answer different questions. The network path answers, "Can a packet reach the service front door through an approved path?" Identity answers, "Is this caller allowed to perform this operation on this resource?" A managed identity with `Key Vault Secrets User` still needs a reachable network path, and a private endpoint path still needs an identity with permission to read the secret.

This separation explains a lot of real outages. A private endpoint may show `Approved`, DNS may return `10.30.40.7`, and the app may still fail because the managed identity lacks database permissions. Another app may have perfect identity permissions and still fail because its subnet resolves the public endpoint while the SQL server public network access is closed.

Now we can place service endpoints properly. They also secure Azure service access from a subnet, but they work differently from private endpoints and show up in many older designs.

## Service Endpoints
<!-- section-summary: Service endpoints secure supported Azure services to trusted subnets, while private endpoints give a specific service instance a private IP. -->

A **service endpoint** is a subnet feature that gives traffic from that subnet a trusted VNet identity when it reaches a supported Azure service. Azure routes that service traffic over the Azure backbone, and the target service can use a virtual network rule to accept traffic from that subnet. The service keeps its normal Azure service endpoint and DNS behavior, while the service firewall recognizes the subnet as an allowed source.

This means service endpoints solve a different problem from private endpoints. With a private endpoint, `devpolaris-orders-sql.database.windows.net` resolves to a private IP in your VNet. With a service endpoint, the service keeps the normal Azure endpoint path, and the service firewall allows the subnet because the request carries VNet identity.

Microsoft recommends Private Link and private endpoints for secure private access to Azure platform services, but service endpoints still appear in production for simple subnet-to-service designs. A team may use service endpoints when a subnet needs access to a supported service and the service can stay on its normal endpoint path. For Storage, service endpoint policies can narrow outbound service endpoint traffic to specific storage accounts, which helps reduce data exfiltration risk.

Here is the practical comparison for the orders system. The two options can both improve service access, but they leave different evidence behind during an outage.

| Question | Private endpoint | Service endpoint |
| --- | --- | --- |
| What appears in the VNet? | A private endpoint network interface with a private IP | A subnet setting for a supported Azure service |
| What happens to DNS? | The service name resolves to the private endpoint IP in linked private DNS zones | The normal service DNS path stays in use |
| What does the service trust? | An approved private endpoint connection to a specific resource | A virtual network rule for a subnet |
| What scope fits best? | Specific service instance, private IP, hybrid access through routed networks | Simpler subnet access to supported services |
| What extra controls matter? | Private DNS, connection approval, public network access, identity | Service firewall VNet rules, service endpoint policies, identity |

![Private endpoint and service endpoint comparison showing private IP access versus subnet trust](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-public-and-private-access/private-access-pattern-choice.png)

*Use this as the access-pattern chooser: private endpoints give a service instance a private IP, while service endpoints let a supported service trust traffic from a subnet.*

Service endpoints cover traffic from Azure subnets. For on-premises clients, teams usually choose Private Link through a connected VNet, or they intentionally allow the on-premises NAT addresses in the service firewall. That distinction matters during hybrid migrations because a branch office app may connect through VPN or ExpressRoute and still need private endpoint DNS to reach the Azure service privately.

At this point, the service access choice is clearer. Private endpoints give the strongest resource-specific private path. Service endpoints give a simpler subnet trust path for supported services. Both still depend on VNet reachability when clients live in another VNet or on-premises network.

## VNet And Hybrid Reach
<!-- section-summary: Private endpoints can serve same-VNet, peered-VNet, VPN, and ExpressRoute clients when routing, DNS, and address spaces line up. -->

A private endpoint lives in one VNet, but the clients that use it can live in several places. Azure supports private endpoint access from the same VNet, regionally and globally peered VNets, on-premises environments connected through VPN or ExpressRoute, and services powered by Private Link. The design work is making those clients resolve the right name and route to the endpoint subnet.

**VNet peering** connects Azure VNets so resources can communicate using private IP addresses across Microsoft's backbone network. In a hub-and-spoke design, the orders app may run in an app spoke, private endpoints may sit in a shared services VNet, and operations tooling may run in another spoke. The private DNS zone links and peering routes need to match that layout.

Address planning matters here. VNets and on-premises networks need non-overlapping CIDR ranges, otherwise a route to `10.30.40.7` may point to two possible places. A private endpoint IP should feel boring and specific: one address in one endpoint subnet, reachable from the intended client networks, with no overlapping range fighting the route table.

Security appliances add another layer. Some organizations force spoke-to-spoke or hybrid traffic through Azure Firewall or a network virtual appliance. That design can work, but the route table must send the client traffic toward the endpoint subnet and the return path must come back cleanly. A one-way route creates the classic timeout where SYN packets leave the client and replies go missing.

Hybrid DNS also needs a planned path. If an on-premises app calls `stordersprod.blob.core.windows.net`, the on-premises resolver needs to receive the private endpoint answer for the storage account. Azure DNS Private Resolver can provide an inbound endpoint in Azure, and the on-premises DNS servers can forward the private link zones to that endpoint.

This is why private connectivity diagrams should include two lines. One line is the **DNS line**, where the client asks for a name and receives the private endpoint IP. The other line is the **packet line**, where traffic travels from the client network to that private IP and back. A diagram with only network arrows misses half the incident.

Now we can talk like responders. During an outage, the team needs evidence for each layer before changing security rules.

## Evidence
<!-- section-summary: Good private connectivity evidence proves endpoint approval, DNS resolution, VNet links, service firewall state, routing, and identity separately. -->

**Evidence** means facts collected from Azure and from the client runtime. Private connectivity has several moving pieces, so a single error such as `connection timed out` or `forbidden` leaves too much unknown. A useful incident review proves each layer separately.

Private endpoint evidence usually comes first. The endpoint should point to the intended target resource, use the expected target subresource, and show an approved connection state. For the orders SQL endpoint, the evidence might come from Azure CLI like this.

```bash
az network private-endpoint show \
  --resource-group rg-devpolaris-data-prod \
  --name pe-orders-sql \
  --query "{status:privateLinkServiceConnections[0].privateLinkServiceConnectionState.status,groupIds:privateLinkServiceConnections[0].groupIds,customDns:customDnsConfigs}"
```

The useful result is small. It should show `Approved`, the expected group ID such as `sqlServer`, and a DNS configuration that includes the private IP.

```json
{
  "status": "Approved",
  "groupIds": ["sqlServer"],
  "customDns": [
    {
      "fqdn": "devpolaris-orders-sql.database.windows.net",
      "ipAddresses": ["10.30.40.7"]
    }
  ]
}
```

Private DNS evidence comes next. The record in `privatelink.database.windows.net` should point to the endpoint IP, and the zone should be linked to the VNet where the client runs. Without both pieces, the app can drift back to the public service path.

```bash
az network private-dns record-set a show \
  --resource-group rg-devpolaris-network-prod \
  --zone-name privatelink.database.windows.net \
  --name devpolaris-orders-sql \
  --query "aRecords[].ipv4Address"
```

```bash
az network private-dns link vnet list \
  --resource-group rg-devpolaris-network-prod \
  --zone-name privatelink.database.windows.net \
  --query "[].{name:name,vnet:virtualNetwork.id,registration:registrationEnabled}"
```

Client-side DNS evidence matters too. The lookup should come from the same subnet, VM, container environment, or jump host that represents the failing workload. A lookup from a laptop proves the laptop's resolver path, while a lookup from the app subnet proves the app's resolver path.

```bash
nslookup devpolaris-orders-sql.database.windows.net
```

The important answer is the private endpoint IP, such as `10.30.40.7`. If the app gets a public answer, the next fix belongs in private DNS zone links, custom DNS forwarding, or Azure DNS Private Resolver. Opening a wider SQL firewall rule at that moment would treat the symptom and leave the private path broken.

Service firewall evidence comes after DNS. Azure SQL exposes `publicNetworkAccess`, Storage exposes `publicNetworkAccess` and `networkRuleSet`, and Key Vault exposes network ACL settings. The exact command changes by service, but the goal stays the same: prove the service accepts the intended private path and has the intended public exposure.

```bash
az sql server show \
  --resource-group rg-devpolaris-data-prod \
  --name devpolaris-orders-sql \
  --query "publicNetworkAccess"
```

```bash
az storage account show \
  --resource-group rg-devpolaris-data-prod \
  --name stordersprod \
  --query "{publicNetworkAccess:publicNetworkAccess,defaultAction:networkRuleSet.defaultAction}"
```

After DNS and service settings, look at the packet path. Effective routes on the client NIC, NSG flow logs, Azure Firewall logs, and packet capture from a test VM can show whether traffic actually leaves for the private endpoint and whether replies return. A clean private endpoint with broken routing still fails like any other TCP path.

The last split is authorization versus networking. A SQL login failure, an Entra ID token error, or a Key Vault `Forbidden` response can happen after private connectivity succeeds. The private path gets the request to the service, then the service checks identity, roles, database users, access policies, or RBAC assignments.

Good evidence keeps fixes small. DNS failures get DNS fixes. Endpoint approval failures get endpoint approval fixes. Service firewall mistakes get service network setting fixes. Identity failures get identity fixes.

## Putting It All Together
<!-- section-summary: A strong private connectivity design lines up the service target, endpoint IP, DNS answer, firewall setting, route path, and identity permission. -->

Let's put the whole orders API path into one picture. A customer reaches `orders.devpolaris.com` through the public entry chain. The app receives the request in a private subnet. When it needs the database, it resolves the normal SQL hostname, gets a private endpoint IP from private DNS, sends traffic to that IP, and Azure Private Link carries the connection to the SQL service.

![Private connectivity evidence board for orders-api showing target service, private endpoint, private DNS, service firewall, route and NSG, and identity checks](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-public-and-private-access/private-connectivity-evidence-board.png)

*Use this as the end-of-article evidence board: prove the target, endpoint, DNS, firewall, route, and identity layers separately before changing the design.*

The operating checklist follows the same order every time. It starts with the service target and ends with identity, because each layer can fail independently.

| Layer | Healthy state | Evidence |
| --- | --- | --- |
| Target service | The app points to the intended SQL server, vault, or storage account | Resource ID, hostname, and environment naming match production |
| Private endpoint | Endpoint uses the right subnet, target subresource, and approved state | `az network private-endpoint show` |
| Private DNS | The normal service hostname resolves to the private endpoint IP in the client network | Private DNS A record, VNet links, client `nslookup` |
| Service firewall | Public exposure and selected-network rules match the design | SQL, Storage, or Key Vault network settings |
| Routing and security | Client can reach the endpoint IP and receive replies | Effective routes, NSGs, firewall logs, packet capture |
| Identity | The workload identity can perform the requested operation | Entra ID roles, database permissions, Key Vault RBAC, service logs |

For a new workload, teams usually choose private endpoints for the sensitive managed services first: databases, secrets, storage, queues, and internal APIs. They keep the public entry path limited to the user-facing edge and regional proxy. Then they connect private DNS, close or restrict public service access, and document the evidence commands before the first incident.

Service endpoints still have a place in this story. They can be useful for simple subnet-based access to supported services, especially where a team wants Storage service endpoint policies or where an older design already depends on virtual network rules. The important part is naming the pattern clearly so everyone knows whether the workload is using a private endpoint IP or a service endpoint subnet rule.

Private connectivity becomes manageable when every connection has a named target, a named private path, and named evidence. For the orders API, that means `orders-api` reaches `devpolaris-orders-sql` through `pe-orders-sql`, resolves the hostname through `privatelink.database.windows.net`, and proves the path from the app subnet before changing firewall rules.

---

**References**

- [What is Azure Private Link?](https://learn.microsoft.com/en-us/azure/private-link/private-link-overview) - Explains Private Link, private endpoints, Microsoft backbone connectivity, resource-specific access, hybrid access, and Private Link service.
- [What is a private endpoint?](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview) - Defines private endpoint network interfaces, target subresources, approval states, DNS requirements, and supported service types.
- [Azure Private Endpoint private DNS zone values](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns) - Documents private DNS zone behavior, recommended zone names, CNAME behavior, and common DNS warnings.
- [Azure virtual network service endpoints](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-service-endpoints-overview) - Describes service endpoints, VNet identity, Azure backbone routing, supported services, and limitations.
- [Virtual network service endpoint policies for Azure Storage](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-service-endpoint-policies-overview) - Explains Storage service endpoint policies and how they restrict service endpoint traffic to selected storage accounts.
- [Use private endpoints for Azure Storage](https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints) - Documents Storage private endpoints, per-subresource endpoints, firewall behavior, and private endpoint access with public network access disabled.
- [Azure Private Endpoint DNS integration scenarios](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration) - Covers private endpoint DNS options for same-VNet, peered-VNet, and on-premises scenarios.
- [Azure Virtual Network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview) - Explains private VNet-to-VNet communication over Microsoft's backbone network.

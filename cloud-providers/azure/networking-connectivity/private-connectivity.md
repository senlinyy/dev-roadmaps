---
title: "Private Connectivity"
description: "Use private endpoints, Private Link, private DNS, service endpoints, resource firewalls, peering, and hybrid paths to keep Azure service access controlled."
overview: "After public traffic reaches the app, the app still needs private paths to managed services. This article follows one orders API as it reaches Azure SQL, Key Vault, and Blob Storage through private endpoints, private DNS, service endpoints, resource firewalls, peering, and hybrid connectivity."
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
5. [Service Endpoints](#service-endpoints)
6. [Resource Firewalls](#resource-firewalls)
7. [VNet Peering](#vnet-peering)
8. [Hybrid Paths](#hybrid-paths)
9. [Evidence](#evidence)
10. [Putting It All Together](#putting-it-all-together)

## The Problem

The orders API is reachable from the public entry point. Now it needs to call its dependencies: Azure SQL, Key Vault, and Blob Storage. The app has the right managed identity, but a secret read still fails with `403`.

That error can hide two different problems:

- The request reached Key Vault, but Key Vault rejected the caller's identity or role.
- The request never arrived through an accepted network path because DNS, a private endpoint, or the vault firewall was wrong.

Reachability and authorization are different checks. Reachability asks whether the app can connect to the service through the intended network path. Authorization asks whether the service accepts the caller for the requested operation.

This article owns the reachability half for managed Azure services. The useful question is:

> When the app uses the normal service hostname, does it resolve and connect through the intended private path, and does the service accept that network path?

## Private Endpoints

A private endpoint is a network interface with a private IP address from your VNet. It connects that private IP to a specific Azure service resource through Azure Private Link.

For the orders API, a SQL private endpoint might look like this:

```text
Private endpoint: pe-orders-sql
Subnet: snet-private-endpoints
Private IP: 10.30.40.7
Target resource: devpolaris-orders-sql
Target subresource: sqlServer
Connection status: Approved
```

The important idea is specificity. The private endpoint maps to a specific resource or subresource, not to every SQL server or every storage account in Azure. That helps reduce data leakage risk because the private path is tied to the intended target.

Private endpoints also create lifecycle evidence. They have connection state. Approved means the endpoint can be used. Pending means an owner still needs to approve. Rejected or disconnected means the path is not usable as expected.

## Private Link

Private Link is the capability that lets a private endpoint connect to Azure platform services, your own services, or partner services over Microsoft's backbone network. A private endpoint is the object you place in your VNet. Private Link is the platform behind that private connection.

The distinction helps in design reviews:

| Term | Plain meaning |
| --- | --- |
| Private Link | The Azure capability for private access to a service. |
| Private endpoint | The private IP network interface in your VNet. |
| Private Link service | A provider-side service exposed privately, often behind a Standard Load Balancer. |

Most app teams first use Private Link through private endpoints for Azure services: Key Vault, Storage, SQL, Cosmos DB, Service Bus, and similar dependencies. They do not need to build a Private Link service just to consume an Azure PaaS resource privately.

## Private DNS

Private DNS is often the part that makes private endpoints feel magical or broken. The app should usually keep using the normal service hostname, such as:

```text
devpolaris-orders-sql.database.windows.net
kv-devpolaris-orders-prod.vault.azure.net
stdevpolarisordersprod.blob.core.windows.net
```

When private endpoint DNS is configured correctly, that normal name resolves to the private endpoint path for clients inside the connected network. If DNS still returns the public address, the app may leave over a public path or hit a resource firewall denial.

For SQL, a useful evidence record looks like this:

```text
Name: devpolaris-orders-sql.database.windows.net
Private link name: devpolaris-orders-sql.privatelink.database.windows.net
Private DNS answer: 10.30.40.7
Private endpoint: pe-orders-sql
```

The gotcha is split behavior. A developer laptop outside the VNet may resolve the same name differently from the app runtime inside the VNet. Always check DNS from the caller that is failing.

## Service Endpoints

Service endpoints are another Azure private access pattern. They extend the VNet identity to supported Azure service public endpoints. The service can then be configured to accept traffic from selected subnets.

The key difference is that service endpoints do not put a private IP for one service instance into your subnet. They let a subnet reach the service over optimized Azure routing and let the service firewall trust that subnet.

That makes service endpoints useful for some simpler subnet-to-service trust designs. Private endpoints are better when you want a specific private IP path to a specific service resource, when you want access from peered or on-premises networks through that private endpoint path, or when you want to reduce public exposure more directly.

| Need | Better fit |
| --- | --- |
| Private IP for one service resource inside the VNet | Private endpoint |
| DNS should resolve the normal service name to a private address | Private endpoint plus private DNS |
| Service should trust selected subnets over service endpoint routing | Service endpoint |
| On-premises should reach the service through private network connectivity | Private endpoint design |

The choice is not a badge of maturity. It is a path decision. Name the caller, target service, DNS behavior, and firewall rule before choosing.

## Resource Firewalls

Many Azure services have their own network access controls. Storage accounts, Key Vaults, and databases can restrict which public networks, subnets, private endpoints, or trusted service paths they accept.

That service gate is separate from NSGs. An NSG may allow the packet to leave the API subnet. DNS may resolve to the private endpoint. The service can still reject the request if its network settings do not accept that path.

This is why `403` can be tricky. A `403` from Key Vault might mean the managed identity lacks permission. It might also mean the vault firewall rejected the network path. The fix depends on which gate denied the request.

For each dependency, keep the evidence split:

```text
Network path:
  DNS answer: private endpoint IP
  Private endpoint: approved
  Service firewall: accepts private endpoint

Authorization:
  Caller: mi-devpolaris-orders-api-prod
  Role: Key Vault Secrets User
  Scope: kv-devpolaris-orders-prod
```

Those two blocks should not be collapsed into "the app has access."

## VNet Peering

VNet peering connects two VNets so resources can communicate over private IP addresses, subject to routes and security controls. Peering is common in hub-and-spoke designs, where application VNets connect to a central hub that owns shared firewall, DNS, gateway, or inspection services.

Peering adds routes for the connected VNet address spaces. It does not merge the VNets into one boundary. Address spaces still must not overlap. NSGs still apply. DNS still needs design. Private endpoints still need to be resolvable from the caller's network.

For a beginner, the question is:

```text
Does the caller's VNet have a route to the target private address, and does DNS return an address reachable through that peering path?
```

If the answer is no, adding an app setting will not repair the network.

## Hybrid Paths

Hybrid connectivity connects Azure to networks outside Azure, usually through VPN, ExpressRoute, or a hub network design. The same private connectivity habits still apply: non-overlapping address spaces, routes, DNS, security rules, and service gates.

Hybrid paths make DNS especially important. An on-premises workload might need to resolve an Azure service name to a private endpoint IP. An Azure workload might need to resolve an on-premises service name through the right resolver path. If the name resolves differently on each side, the route evidence will not match the app symptom.

Keep the first hybrid design small:

| Question | Why it matters |
| --- | --- |
| Which network owns the source? | Determines the route table and DNS resolver. |
| Which private address should it reach? | Determines peering, VPN, or ExpressRoute routing. |
| Which DNS answer should the caller see? | Determines whether traffic uses the private path. |
| Which firewall accepts the path? | Determines whether reachability ends at the service gate. |

The services can be advanced. The habit stays plain.

## Evidence

Good private connectivity evidence proves the path without leaking secrets or changing broad access.

For the orders API and SQL, the evidence can be:

```text
Caller:
  orders-api in snet-orders-api

Target:
  devpolaris-orders-sql.database.windows.net

DNS from caller:
  resolves through privatelink.database.windows.net to 10.30.40.7

Private endpoint:
  pe-orders-sql, Approved, IP 10.30.40.7

Service gate:
  SQL server accepts the private endpoint connection

Authorization:
  checked separately through SQL auth or Microsoft Entra/database roles
```

That record tells you whether the network path works. It does not expose a password, connection string, or broad secret value.

## Putting It All Together

Return to the `403` from the opening problem. The app may have failed because identity was wrong, or because the network path was wrong. Private connectivity gives the team a way to separate those checks:

- Private endpoints place private IPs for specific service resources into the VNet.
- Private Link is the platform capability behind those private connections.
- Private DNS makes normal service hostnames resolve to the intended private path.
- Service endpoints let selected subnets reach supported service public endpoints with subnet trust.
- Resource firewalls decide which network paths the service accepts.
- Peering and hybrid connections extend private reach, but they still need routes and DNS.
- Authorization remains a separate service decision after reachability works.

The useful review sentence is:

```text
orders-api resolves SQL, Key Vault, and Storage names to approved private endpoint IPs from its runtime subnet, the target services accept those private paths, and identity permissions are reviewed separately.
```

That closes the Azure networking module: first shape the VNet, then filter packets, then choose the public entry, then keep service dependencies on private paths.

---

**References**

- [What is Azure Private Link?](https://learn.microsoft.com/en-us/azure/private-link/private-link-overview)
- [What is a private endpoint?](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview)
- [Azure Private Endpoint private DNS zone values](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
- [Azure virtual network service endpoints](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-service-endpoints-overview)

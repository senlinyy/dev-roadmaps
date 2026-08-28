---
title: "What Is a GCP VPC"
description: "Understand how global VPC networks, regional subnets, IP ranges, routes, reserved addresses, and internet or NAT paths shape GCP network design."
overview: "A GCP VPC is a global packet-delivery and isolation domain. This article builds that model from regional subnets, address ranges, routes, firewall decisions, external addresses, Cloud NAT, and Private Google Access."
tags: ["gcp", "vpc", "subnets", "routes", "networking"]
order: 1
id: article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model
aliases:
  - gcp-networking-mental-model
  - network-failure-modes-and-first-checks
  - article-cloud-providers-gcp-networking-connectivity-network-failure-modes-first-checks
  - cloud-providers/gcp/networking-connectivity/gcp-networking-mental-model.md
  - cloud-providers/gcp/networking-connectivity/network-failure-modes-and-first-checks.md
---

## Table of Contents

1. [What Problem Does a GCP VPC Solve?](#what-problem-does-a-gcp-vpc-solve)
2. [How Are Global VPCs and Regional Subnets Organized?](#how-are-global-vpcs-and-regional-subnets-organized)
3. [How Do Primary and Secondary Ranges Work?](#how-do-primary-and-secondary-ranges-work)
4. [How Do Routes and Firewall Decisions Work Together?](#how-do-routes-and-firewall-decisions-work-together)
5. [Which Addresses Are Reserved or Static?](#which-addresses-are-reserved-or-static)
6. [How Do Private Resources Reach the Internet or Google APIs?](#how-do-private-resources-reach-the-internet-or-google-apis)
7. [What Does a Starter Production VPC Look Like?](#what-does-a-starter-production-vpc-look-like)
8. [How Do Commands and Terraform Express the Design?](#how-do-commands-and-terraform-express-the-design)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Start with three machines named `web-1`, `api-1`, and `db-1`. Each machine needs an address. Packets need a path between those addresses, and policy must decide whether a flow remains private, crosses into another network, reaches the internet, or is rejected. A **Google Cloud VPC network** is the software-defined environment in which those packet-delivery decisions are made.

Google owns the physical routers, fiber, and switches. You define the logical network: address ranges, routes, firewall policy, internet paths, hybrid connections, and private service connectivity. The word *virtual* matters because no dedicated hardware router sits in a rack with your VPC name. Routing is implemented as a distributed software-defined system across Google's production network.

Without a logical isolation boundary, workloads from unrelated customers would appear to share one enormous customer network. A VPC separates one customer's addresses and policies from another customer's resources even while both use Google infrastructure. A compact approximation treats it as the customer's logical network boundary on shared Google infrastructure.

Keep these questions in view as you work through the lesson:

1. **What Problem Does a GCP VPC Solve?**
2. **How Are Global VPCs and Regional Subnets Organized?**
3. **How Do Primary and Secondary Ranges Work?**
4. **How Do Routes and Firewall Decisions Work Together?**
5. **Which Addresses Are Reserved or Static?**
6. **How Do Private Resources Reach the Internet or Google APIs?**
7. **What Does a Starter Production VPC Look Like?**
8. **How Do Commands and Terraform Express the Design?**

## What Problem Does a GCP VPC Solve?
<!-- section-summary: Your cloud resources need private addresses and paths to each other before access rules can make sense. -->

```text
VPC
= private addressing
+ routing
+ network policy
+ connections to other networks
```

That model is more useful than calling a VPC one CIDR block. In GCP, the VPC does not fundamentally own a parent CIDR. Regional subnets own address ranges, while the global VPC joins those ranges into one connectivity and policy domain.

### The VPC Network
<!-- section-summary: A VPC network is the global private network container for many Google Cloud resources. -->

A **Virtual Private Cloud network**, or **VPC network**, is a virtual network inside Google's production network. It is "virtual" because you do not buy switches and cables. Google runs the physical network, and you define the private address space, subnets, routes, and firewall policy your cloud resources should use.

The beginner picture is an office floor plan. The floor plan gives every room an address and shows the hallways between rooms before people start moving through the building. The VPC is that floor plan for cloud resources. Subnets are regional address areas. Routes are the hallway directions. Firewall rules are the locked doors and access checks.

This is why a VPC is not just "networking jargon." It gives Google Cloud resources a place to receive internal IP addresses, communicate over private paths, use routes, and receive firewall rule decisions.

A VPC belongs to a Google Cloud project, and a project can contain more than one VPC. The network remains the relevant packet boundary: attached resources use its subnet addresses, applicable routes, and distributed firewall controls.

The VPC is the place where your network intent starts. It does not grant every resource access to every other resource automatically. A packet still needs a route for the destination and a firewall decision that allows the packet for the target interface.

There are three separate ideas to keep apart:

- **Addressing:** the resource has an internal IP address from a subnet.
- **Pathing:** the VPC has a route for the destination IP range.
- **Access:** the firewall policy allows the packet for the target.

Beginners often mix those together. A VM can have the right IP address and still fail to connect because the firewall blocks the packet. A firewall rule can allow TCP `8080` and still fail because the destination IP has no route. A good troubleshooting path checks those layers one by one.

Follow one packet. A web VM at `10.10.0.5` opens TCP port `443` on an API VM at `10.20.0.8`.

| Packet step | What Google Cloud checks | Practical evidence |
|---|---|---|
| Source | The packet leaves with source IP `10.10.0.5` | VM interface and subnet membership |
| Destination | The packet names `10.20.0.8` | DNS answer or configured endpoint |
| Route lookup | A subnet route covers `10.20.0.0/20` | Effective VPC routes |
| Firewall decision | Egress and ingress policy permit the exact flow | Effective rules and firewall evidence |
| Delivery | A process accepts TCP `443` | Guest and application evidence |

That sequence will recur throughout the module: an address identifies an endpoint, a route supplies a possible path, firewall policy decides whether the connection may use it, and the destination application must accept the connection.

## How Are Global VPCs and Regional Subnets Organized?
<!-- section-summary: The VPC network is global, and each subnet is a regional address pool inside that network. -->

A **global VPC network** can contain subnets in several Google Cloud regions. Creating `prod-vpc` does not place that network in `europe-west1` or `us-central1`; the network resource exists globally. The regional subnets inside it provide the actual address pools.

A **subnet**, also called a **subnetwork**, is a regional IP address domain inside that VPC. A subnet in `europe-west1` can supply addresses to resources in `europe-west1-b`, `europe-west1-c`, and `europe-west1-d`; it is regional rather than zonal. Compute placement selects a zone, while subnet placement selects regional network addressing.

![A generated infographic showing one global VPC network containing regional subnet pools and private workload IPs.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/vpc-map.png)
*The VPC network is global. Subnets are regional pools where workloads receive addresses.*

One global production network can contain deliberately non-contiguous regional ranges:

| Subnet | Region | Intended workload |
|---|---|---|
| `subnet-eu` | `europe-west1` | `10.10.0.0/20` |
| `subnet-us` | `us-central1` | `10.20.0.0/20` |
| `subnet-asia` | `asia-southeast1` | `172.20.50.0/24` |

Those ranges do not need to be carved from one contiguous parent block. A coherent enterprise plan can still make aggregation and later connections easier, but the resource model is the global VPC plus the ranges owned by each regional subnet.

### What Changes If You Know AWS Networking?

The key reset is scope. An AWS VPC is regional, and its subnets are tied to Availability Zones. A Google Cloud VPC is global, while its subnets are regional and can serve resources across zones in that region. GCP also does not require one top-level VPC CIDR from which every subnet must be carved. Each regional subnet owns its ranges, and the global VPC provides the shared routing and policy domain.

That difference changes the first design question. In AWS, a multi-region application normally starts with multiple regional VPCs and connections between them. In GCP, one VPC can already contain subnets in several regions. This does not mean one global VPC is always the right organizational boundary; it means region alone does not force another VPC. Choose separate networks for isolation and ownership reasons rather than assuming the AWS regional boundary carries over unchanged.

## How Do Primary and Secondary Ranges Work?
<!-- section-summary: Primary ranges give normal interface addresses, and secondary ranges support alias IP use cases such as GKE Pods and Services. -->

Every IPv4 subnet has a **primary range**. This pool supplies the primary internal addresses for VM interfaces and several other resource types. If `subnet-apps` uses `10.10.0.0/24`, its VM interfaces might receive `10.10.0.2`, `10.10.0.3`, and `10.10.0.4`.

A subnet can also have **secondary ranges**. A secondary range is an extra IP range attached to the subnet for alias IP addresses. Many learners meet secondary ranges through Google Kubernetes Engine, where node VMs use the primary range while Pods and Kubernetes Services use secondary ranges.

![A generated infographic showing primary and secondary subnet ranges with a warning about overlapping office networks.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/subnet-ranges.png)
*Primary and secondary ranges need enough room for workload growth and connected networks.*

A GKE-oriented subnet can separate node, Pod, and Service addresses:

| Range | CIDR | Practical use |
|---|---:|---|
| Primary range | `10.10.0.0/20` | VM and GKE node interfaces |
| `pods` secondary range | `10.100.0.0/16` | GKE Pod alias IPs |
| `services` secondary range | `10.110.0.0/20` | Kubernetes Service addresses |

Secondary ranges let one host interface represent more network identities than the host itself. Keeping nodes, Pods, and Services in different pools also lets each population grow without consuming the same space. This matters because primary ranges can generally be expanded but cannot simply be replaced or shrunk in place, and secondary-range changes have their own constraints. IP space is inexpensive before deployment and disruptive to recover later.

## How Do Routes and Firewall Decisions Work Together?
<!-- section-summary: Routes tell the VPC where packets should go for a destination IP range. -->

A **route** pairs a destination prefix with a next hop. It answers where a packet can go; it does not decide whether the connection should be permitted. A route table can therefore contain internal subnet paths, a learned hybrid prefix, and a broad default path at the same time.

Google Cloud creates **subnet routes** automatically for the primary and secondary ranges of a subnet. After you create `10.10.0.0/20` in Europe and `10.20.0.0/20` in the US, the VPC supplies paths for both ranges without requiring you to add those two routes manually.

The resulting model can be written as:

| Destination range | Route source | Next hop | Reason |
|---|---|---|---|
| `10.10.0.0/20` | Subnet route | European subnet | Internal endpoints in Europe |
| `10.20.0.0/20` | Subnet route | US subnet | Internal endpoints in the US |
| `10.50.0.0/16` | Learned or custom route | VPN path | A connected private network |
| `0.0.0.0/0` | Default route | Default internet gateway | IPv4 destinations with no narrower match |

A destination such as `10.20.0.8` matches the internal subnet route. A public destination that has no more specific route can fall through to `0.0.0.0/0`. That default route commonly uses the special `default-internet-gateway` next hop, but it can be removed or replaced; it is not a mandatory, unchangeable feature of every VPC.

Routing and firewalling form an AND condition. A valid route plus a deny decision still produces no connection. An allow decision plus no valid route also produces no connection. Successful delivery further requires valid source and destination addresses and a service listening at the destination.

![A generated infographic showing subnet routes for private traffic and a default route through Cloud NAT for outbound internet access.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/route-paths.png)
*Subnet routes provide private paths, and the default route supports approved outbound designs such as Cloud NAT.*

Every VPC also has implied firewall behavior that denies unsolicited ingress and allows egress unless a higher-precedence applicable policy changes the decision. The next article examines those firewall rules in detail; for this article, keep the separation clear: the route makes a path possible, and the firewall determines whether a particular flow may use it.

## Which Addresses Are Reserved or Static?
<!-- section-summary: Subnet primary CIDR size is larger than usable workload capacity because Google Cloud reserves addresses in primary ranges. -->

A **CIDR block** is the compact notation for an IP range, such as `10.30.20.0/24`. A `/24` contains 256 total IPv4 addresses, from `10.30.20.0` through `10.30.20.255`.

Google Cloud reserves the first two and last two addresses in each IPv4 subnet primary range. For `10.30.20.0/24`, the reserved addresses are:

| Address | Practical meaning |
|---|---|
| `10.30.20.0` | Network address |
| `10.30.20.1` | Default gateway address |
| `10.30.20.254` | Reserved by Google Cloud |
| `10.30.20.255` | Broadcast address |

That means a `/24` primary range gives 252 usable addresses for normal assignment. Secondary IPv4 ranges are different: Google Cloud lets you use all addresses in secondary ranges for alias IP use cases. The planning habit still applies because tiny secondary ranges can run out during GKE scale-up, blue-green deploys, incident testing, or node replacement.

That platform reservation is different from an address you intentionally reserve. If a rebuilt service must keep internal address `10.10.0.50`, you can reserve that address so automatic allocation does not assign it elsewhere. External addresses can also be reserved.

An **internal IP** is used inside the VPC or connected private networks and is not publicly routed on the internet. An **external IP** is internet-routable. External addresses can be ephemeral, meaning their lifecycle follows the resource, or static, meaning the project keeps the reservation until it is explicitly released. Keep these two meanings distinct: platform-reserved subnet addresses are unavailable by design, while a static reservation is an address you deliberately hold for a resource or stable endpoint.

## How Do Private Resources Reach the Internet or Google APIs?
<!-- section-summary: Public entry and outbound internet access are separate designs, and Cloud NAT gives internal resources an outbound path without public VM IPs. -->

The VPC can include a default route to the default internet gateway. That route has destination `0.0.0.0/0`, which means every IPv4 destination that lacks a more specific route. A VM with an external IP address can use that path for internet traffic, subject to firewall rules and service behavior.

One internet model assigns a VM both an internal address and an external address. That VM can use the public identity for appropriate traffic, but placing a public address on every backend expands the set of internet-addressable resources.

A second model keeps application VMs private while still allowing them to initiate outbound connections for operating-system updates, packages, third-party APIs, or SaaS services. **Public Cloud NAT** translates those outbound flows through shared regional external addresses without adding a public IP to every VM.

Public Cloud NAT recognizes return traffic for connections the private resource initiated, while unsolicited inbound internet connections remain unavailable through NAT. It is also distributed rather than a NAT appliance VM in the packet path. The Cloud Router and NAT gateway resources hold control-plane configuration; packets do not travel through a central Cloud Router box.

Cloud NAT is regional. A global VPC with workloads in `europe-west1` and `us-central1` normally needs a NAT configuration in each region that requires this outbound path. Remember the scope chain: the VPC is global, each subnet is regional, and a Public NAT gateway belongs to one VPC, one region, and one Cloud Router.

Google APIs are a separate case. A VM with only an internal address and no Public NAT might still need Cloud Storage, Secret Manager, Artifact Registry, or another supported Google API. Enabling **Private Google Access** on its subnet gives internal-only workloads a Google-network path to supported APIs without providing general internet reachability.

The design question is therefore narrower than “does this VM need the internet?” Ask whether it needs a public inbound identity, outbound internet initiation, access only to Google APIs, or some combination. External IPs, Public NAT, and Private Google Access answer those different requirements.

## What Does a Starter Production VPC Look Like?
<!-- section-summary: A small production network names the VPC, regional subnets, address ranges, routes, private placement, and outbound policy. -->

Start with a custom-mode network named `prod-vpc`. Custom mode creates no automatic subnet in every region, so each regional address pool exists because the design explicitly requires it.

For example, use primary range `10.10.0.0/20` in `europe-west1` for nodes and VM interfaces, plus secondary ranges `10.100.0.0/16` for Pods and `10.110.0.0/20` for Services. A second region can receive its own non-overlapping subnet. Google creates the associated subnet routes, while explicit firewall policy governs the traffic that may cross those paths.

Enable Private Google Access and VPC Flow Logs where their evidence and API paths are needed. Keep ordinary application instances free of external IP addresses, and add regional Public NAT only for the subnets that need outbound internet initiation.

This shape also gives troubleshooting an order. For an outbound request from `10.10.0.5` to `8.8.8.8:443`, verify the source address, the matching route, egress firewall policy, an external identity supplied by an external IP or Public NAT, and the remote endpoint's response. For internal traffic, verify the source, subnet route, VPC path, firewall decision, and destination listener.

The useful checkpoint is this: **the VPC is the global packet-delivery domain; subnets are regional address pools; primary and secondary ranges serve different endpoint identities; routes choose possible paths; firewall policy permits flows; external IPs or Public NAT provide internet identity; and Private Google Access covers supported Google APIs without granting general internet access.**

## How Do Commands and Terraform Express the Design?
<!-- section-summary: A starter VPC should be reproducible, with custom mode, explicit subnets, optional secondary ranges, and an intentional NAT path. -->

The first command creates a custom-mode VPC. The command changes cloud state, so real teams usually run it through a reviewed infrastructure pipeline:

```bash
gcloud compute networks create prod-vpc \
  --subnet-mode=custom \
  --bgp-routing-mode=global
```

Important fields:

- `--subnet-mode=custom` keeps subnet creation deliberate.
- `--bgp-routing-mode=global` lets dynamic routes learned in one region apply across the VPC after hybrid routing is added.

Expected operation output should finish with `DONE`:

```yaml
operationType: insert
status: DONE
targetLink: projects/PROJECT_ID/global/networks/prod-vpc
```

Now create subnets. The API subnet includes secondary ranges for a future GKE cluster and enables Private Google Access for internal-IP workloads that call supported Google APIs:

```bash
gcloud compute networks subnets create prod-eu \
  --network=prod-vpc \
  --region=europe-west1 \
  --range=10.10.0.0/20 \
  --secondary-range=pods=10.100.0.0/16,services=10.110.0.0/20 \
  --enable-private-ip-google-access \
  --enable-flow-logs
```

Important fields:

- `--range` is the primary range for VM interface addresses.
- `--secondary-range` provides alias IP pools for GKE-style workloads.
- `--enable-private-ip-google-access` supports private VM access to Google APIs with correct DNS and routes.

Cloud NAT provides an outbound path for internal-only resources:

```bash
gcloud compute routers create prod-eu-router \
  --network=prod-vpc \
  --region=europe-west1

gcloud compute routers nats create prod-eu-nat \
  --router=prod-eu-router \
  --region=europe-west1 \
  --nat-all-subnet-ip-ranges \
  --auto-allocate-nat-external-ips \
  --enable-logging
```

Important fields:

- `--nat-all-subnet-ip-ranges` covers primary and secondary ranges in the region.
- `--auto-allocate-nat-external-ips` lets Google Cloud allocate NAT IPs. Stricter environments often reserve named NAT IPs for allowlists and change review.
- The Cloud Router is the control resource for NAT. It does not mean BGP is required for this basic NAT setup.

The same shape in Terraform keeps the network reviewable:

```hcl
resource "google_compute_network" "prod" {
  name                    = "prod-vpc"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"
}

resource "google_compute_subnetwork" "eu" {
  name                     = "prod-eu"
  region                   = "europe-west1"
  network                  = google_compute_network.prod.id
  ip_cidr_range            = "10.10.0.0/20"
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.100.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.110.0.0/20"
  }
}

resource "google_compute_router" "eu" {
  name    = "prod-eu-router"
  region  = google_compute_subnetwork.eu.region
  network = google_compute_network.prod.id
}

resource "google_compute_router_nat" "eu" {
  name   = "prod-eu-nat"
  router = google_compute_router.eu.name
  region = google_compute_router.eu.region

  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
```

Verification should prove the network mode, subnet ranges, and route table before the team writes firewall rules:

```bash
gcloud compute networks describe prod-vpc \
  --format='yaml(name,autoCreateSubnetworks,routingConfig.routingMode)'

gcloud compute networks subnets list \
  --filter='network~prod-vpc' \
  --format='table(name,region,ipCidrRange,privateIpGoogleAccess,secondaryIpRanges)'

gcloud compute routes list \
  --filter='network~prod-vpc' \
  --format='table(name,destRange,nextHopGateway,nextHopVpnTunnel,priority)'
```

Healthy output should show custom subnet mode, global routing, explicit regional subnets, Private Google Access where intended, subnet routes, and a default route for outbound designs that need NAT or external IP paths:

```yaml
name: prod-vpc
autoCreateSubnetworks: false
routingConfig:
  routingMode: GLOBAL
```

```console
NAME     REGION        IP_CIDR_RANGE  PRIVATE_IP_GOOGLE_ACCESS
prod-eu  europe-west1  10.10.0.0/20  True
```

```console
NAME                       DEST_RANGE     NEXT_HOP_GATEWAY          PRIORITY
default-route-0-0-0-0-0    0.0.0.0/0     default-internet-gateway  1000
prod-vpc-prod-eu           10.10.0.0/20                             0
```

## Check Your Answers

:::expand[What Problem Does a GCP VPC Solve?]{kind="recap"}
A GCP VPC gives resources one logically isolated, software-defined domain for addressing, routing, network policy, and connections to other networks. Google runs the physical fabric; you define the packet-delivery intent.
:::

:::expand[How Are Global VPCs and Regional Subnets Organized?]{kind="recap"}
The VPC resource is global. Subnets are regional, can serve resources across zones in their region, and own their own address ranges rather than being carved from one required VPC-wide CIDR.
:::

:::expand[How Do Primary and Secondary Ranges Work?]{kind="recap"}
The primary range supplies normal interface addresses. Secondary ranges provide extra alias-IP pools, commonly separating GKE Pod and Service addresses from node addresses.
:::

:::expand[How Do Routes and Firewall Decisions Work Together?]{kind="recap"}
A route makes a path possible by matching a destination prefix to a next hop. Firewall policy separately decides whether the exact flow may use that path, so both controls must succeed.
:::

:::expand[Which Addresses Are Reserved or Static?]{kind="recap"}
Four addresses in a primary IPv4 subnet range are unavailable for workloads. That platform reservation differs from intentionally reserving a static internal or external address for stable use.
:::

:::expand[How Do Private Resources Reach the Internet or Google APIs?]{kind="recap"}
An external IP gives one resource a public identity, regional Public NAT gives private resources outbound internet initiation, and Private Google Access gives internal-only workloads access to supported Google APIs.
:::

:::expand[What Does a Starter Production VPC Look Like?]{kind="recap"}
Use a custom-mode global VPC, deliberate regional ranges with growth room, Private Google Access where needed, no unnecessary public VM IPs, and regional NAT only for required outbound internet paths.
:::

:::expand[How Do Commands and Terraform Express the Design?]{kind="recap"}
The configuration is a network plus regional subnetwork, Cloud Router, and Cloud NAT resources. Read-only network, subnet, and route checks should confirm the intended state after deployment.
:::

## References

- [VPC networks](https://docs.cloud.google.com/vpc/docs/vpc) - Defines VPC networks, global network scope, regional subnets, default networks, auto mode, and custom mode.
- [Subnets](https://docs.cloud.google.com/vpc/docs/subnets) - Documents primary and secondary ranges, valid subnet ranges, reserved addresses, and subnet range behavior.
- [Routes](https://docs.cloud.google.com/vpc/docs/routes) - Explains subnet routes, default routes, route priorities, destinations, and next hops.
- [Create and manage VPC networks](https://docs.cloud.google.com/vpc/docs/create-modify-vpc-networks) - Shows the official workflow for creating VPC networks and subnets with Google Cloud CLI.
- [Cloud NAT overview](https://docs.cloud.google.com/nat/docs/overview) - Explains outbound NAT for resources without external IP addresses.
- [Private Google Access](https://docs.cloud.google.com/vpc/docs/private-google-access) - Explains private access from internal-IP VMs to Google APIs and services.

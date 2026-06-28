---
title: "What Is a GCP VPC"
description: "Understand how global VPC networks, regional subnets, IP ranges, routes, and default internet paths shape GCP network design."
overview: "A GCP VPC is the private network map for Google Cloud workloads. This article walks through global network scope, regional subnet placement, IP ranges, routing, and a small production app design."
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

1. [The VPC Network](#the-vpc-network)
2. [Global Network, Regional Subnets](#global-network-regional-subnets)
3. [Auto Mode and Custom Mode](#auto-mode-and-custom-mode)
4. [Primary and Secondary Ranges](#primary-and-secondary-ranges)
5. [Reserved Addresses and Private Placement](#reserved-addresses-and-private-placement)
6. [Routes and Internet Paths](#routes-and-internet-paths)
7. [Planning a Small Production Network](#planning-a-small-production-network)
8. [gcloud and Terraform Starter VPC](#gcloud-and-terraform-starter-vpc)
9. [What's Next](#whats-next)

## The VPC Network
<!-- section-summary: A VPC network gives Google Cloud resources a shared private network boundary, routing map, and firewall surface. -->

A **Virtual Private Cloud network**, usually shortened to **VPC network**, is the private network container that Google Cloud uses for Compute Engine VMs and many services built on top of Compute Engine. It gives workloads internal IP addresses, a routing table, firewall rule evaluation, and connection paths to other networks or Google services. The word virtual matters because Google Cloud implements the network inside Google's production network while your team works with software resources.

A small company building a food delivery app gives us a useful running example. The team has a public web tier, an API tier, background workers, and a Cloud SQL database. The web tier needs a public load balancer in front of it. The API tier needs private access from the web tier. The workers need private access to the API and database. The database is meant for controlled private traffic and protected from random internet traffic. A VPC network is the shared network space where those choices can be designed instead of guessed.

A VPC network belongs to a Google Cloud project. A project can have more than one VPC network, so teams often separate production, staging, and shared infrastructure by project and network design. Inside the VPC network, resources communicate by internal IP addresses when routes and firewall rules allow the packet. The route decides the path. The firewall rule decides whether the packet may enter or leave the targeted VM interface.

That last sentence is the first big connection for this module. A VPC gives you the map, and a private packet still needs a route plus an allowed firewall decision. In this article, we focus on the map and route side. The next article handles packet access rules in detail.

## Global Network, Regional Subnets
<!-- section-summary: The VPC network is global, while each subnet is a regional address pool where resources receive IP addresses. -->

A **subnet**, also called a **subnetwork**, is an IP address range inside a VPC network. Google Cloud uses the two words interchangeably. A subnet is where a VM network interface receives its internal IP address. For example, a VM in `us-central1` might receive `10.20.10.7` from a subnet named `subnet-app-us-central1`.

Here is the part that often surprises beginners: a **GCP VPC network is a global resource**, and **subnets are regional resources**. The network object can contain subnets in many regions. A subnet still lives in one region, such as `us-central1` or `europe-west2`, and VMs can attach only to subnets in the same region as the VM zone.

![A generated infographic showing one global VPC network containing regional subnet pools and private workload IPs.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/vpc-map.png)
*The network is the global container, while each region contributes its own subnet pools and workload addresses.*

For the food delivery app, that means the team can keep one production VPC network and place the API in `us-central1` while placing a data export worker in `europe-west2`. The two regional subnets sit inside the same global network. Google Cloud creates subnet routes so resources in those subnets have private routing paths, and firewall rules still decide which packets are allowed.

This global network scope changes day-to-day planning. The team names and reviews one production VPC, then creates regional subnets only where workloads actually run. The network gives a shared policy surface for routes and firewall rules. The subnets give regional placement and address pools.

## Auto Mode and Custom Mode
<!-- section-summary: Auto mode creates regional subnets for quick starts, while custom mode makes production address planning explicit. -->

Google Cloud has two subnet creation modes for VPC networks: **auto mode** and **custom mode**. The mode answers one simple question: will Google Cloud create regional subnets for the network, or will the team create each subnet deliberately?

An **auto mode VPC network** automatically has one subnet in each region. These subnets use predefined IPv4 ranges from `10.128.0.0/9`. When Google Cloud adds a new region, an auto mode network receives a new subnet in that region. This is convenient for quick demos, tutorials, and short experiments because a VM can launch without the engineer designing CIDR blocks first.

The default network that new projects may receive is an auto mode VPC network with pre-populated firewall rules. Many teams disable automatic default network creation through organization policy because production networking usually needs review before resources appear in a project.

A **custom mode VPC network** starts with no automatically created subnets. The team chooses the region, name, and IP range for every subnet. Google Cloud allows converting an auto mode network to custom mode, and that conversion goes one way. A custom mode network has no path back to auto mode.

For the food delivery app, custom mode fits the production path. The team might create only these subnets at first:

| Subnet | Region | Primary range | Intended workloads |
|---|---:|---:|---|
| `subnet-web-us-central1` | `us-central1` | `10.20.10.0/24` | Web VMs behind a load balancer |
| `subnet-api-us-central1` | `us-central1` | `10.20.20.0/24` | API VMs and internal services |
| `subnet-data-us-central1` | `us-central1` | `10.20.30.0/24` | Data jobs and private database clients |
| `subnet-workers-europe-west2` | `europe-west2` | `10.20.40.0/24` | Regional export workers |

This plan leaves space for future regions, avoids accidental overlap with office VPN ranges, and keeps the project from receiving unused subnets in every region. The important habit is simple: address space is a production asset, with the same review value as names, service accounts, and deployment environments.

## Primary and Secondary Ranges
<!-- section-summary: Primary ranges supply normal VM interface addresses, while secondary ranges support alias IP use cases such as GKE Pods and services. -->

Every IPv4 subnet has a **primary IPv4 range**. This range supplies the main internal IPv4 addresses for VM network interfaces. If a VM interface attaches to `subnet-api-us-central1` with primary range `10.20.20.0/24`, the VM receives an address such as `10.20.20.9` from that range.

A subnet can also have **secondary IPv4 ranges**. A secondary range is an additional IP range attached to the subnet for alias IP ranges. An **alias IP range** lets a VM network interface represent extra IP addresses besides its primary address. In practice, many beginners first meet secondary ranges through Google Kubernetes Engine, where Pods and Services commonly use secondary ranges so container IPs have separate pools from node primary addresses.

Here is a practical GKE-flavored version of the same production subnet:

| Range name | CIDR | Common use |
|---|---:|---|
| Primary range | `10.20.20.0/24` | GKE node VM internal IPs or API VM IPs |
| `pods` secondary range | `10.21.0.0/20` | Pod alias IPs |
| `services` secondary range | `10.22.0.0/24` | Kubernetes Service IPs |

![A generated infographic showing primary and secondary subnet ranges with a warning about overlapping office networks.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/subnet-ranges.png)
*Primary ranges, secondary ranges, and connected office ranges all need to fit together before workloads depend on them.*

Primary and secondary ranges must be unique across the VPC network where Google Cloud requires uniqueness. Google Cloud also checks for conflicts with existing subnet ranges and certain connected ranges. This matters during hybrid networking. If the company office uses `10.20.0.0/16` over Cloud VPN and the GCP production VPC also uses `10.20.0.0/16`, private routing turns into an address conflict. The packet destination no longer tells the network which side owns the address.

There is also a lifecycle detail that saves future pain. After a subnet is created, the primary IPv4 range can be expanded, while replacement or shrinking is unavailable. Secondary ranges have their own constraints, especially when resources already use them. Production teams usually allocate ranges with enough room for growth, then document why each range exists.

## Reserved Addresses and Private Placement
<!-- section-summary: Subnet CIDR size and usable workload capacity differ, and private placement needs room for growth and connected networks. -->

A **CIDR block** is a compact way to describe an IP range, such as `10.20.20.0/24`. The `/24` means the first 24 bits identify the network, leaving 256 total IPv4 addresses in the range. A beginner-friendly way to read it is: this subnet has addresses from `10.20.20.0` through `10.20.20.255`.

Usable workload capacity is smaller than the total address count because Google Cloud reserves addresses in each subnet. For IPv4 subnets, the first two addresses and the last two addresses in each primary range and secondary range are reserved. In a `/24`, that means the following addresses are unavailable for normal VM or alias IP assignment:

| Address | Practical meaning |
|---|---|
| `10.20.20.0` | Network address |
| `10.20.20.1` | Default gateway address |
| `10.20.20.254` | Reserved by Google Cloud |
| `10.20.20.255` | Broadcast address |

So a `/24` gives 252 usable addresses out of 256 total. That difference sounds small until a team creates many tiny subnets. Google Cloud allows very small subnet ranges, but tiny ranges run out quickly when managed instance groups, blue-green deployments, GKE nodes, or extra test VMs appear during an incident.

Private placement also means choosing which resources receive private addresses and which resources receive public exposure. The API VMs in the food delivery app can live on internal IPs only and receive traffic from an internal load balancer or a controlled web tier. Workers can live on internal IPs and use Cloud NAT for outbound package downloads. A public entry point can sit at the edge through a load balancer, while the application tiers use private routes inside the VPC.

That private placement plan prepares us for routing. Once a VM has an internal IP, the next question is where a packet goes when the VM sends traffic to another subnet, to the internet, or to a connected network.

## Routes and Internet Paths
<!-- section-summary: Routes choose the next hop for packets, while firewall rules still decide whether those packets may pass. -->

A **route** is a rule that tells the VPC network where to send packets for a destination IP range. Routes have destinations like `10.20.20.0/24` or `0.0.0.0/0`, and they point to a next hop such as a subnet path, default internet gateway, Cloud VPN tunnel, or other supported next hop.

Google Cloud creates **subnet routes** for subnet IP ranges. When the team creates `subnet-api-us-central1` with `10.20.20.0/24`, the VPC network gets a route for that range. That is why a VM in the web subnet can have a private path to an API VM in the API subnet, assuming firewall rules allow the connection.

Google Cloud also adds a system-generated IPv4 **default route** when a VPC network is created. A default route uses destination `0.0.0.0/0`, which is the broadest IPv4 destination. Its next hop is the default internet gateway. Google Cloud uses this route when a packet lacks a more specific route match. This route gives a path toward external IPv4 addresses for VMs with external IPv4 addresses and for public Cloud NAT gateways that translate traffic from internal-only VMs.

Here is the food delivery app again:

![A generated infographic showing subnet routes for private traffic and a default route through Cloud NAT for outbound internet access.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/route-paths.png)
*Routes choose the next hop: private subnet routes keep application traffic inside the VPC, while the default route supports approved outbound paths such as Cloud NAT.*

Routes and firewalls work together. The subnet route may provide a path from the web VM to the API VM, while the firewall rules decide whether TCP traffic to the API port is allowed. The default route may provide a path from an internal VM to external IPv4 addresses through Cloud NAT, while firewall egress rules can still restrict what leaves the VM.

Production routing usually starts simple. Subnet routes handle private communication inside the VPC. The default route handles ordinary outbound internet paths when the workload has the right external IP or NAT setup. Custom static routes, dynamic routes from Cloud Router, VPC Network Peering routes, and Network Connectivity Center routes enter the design when the company connects to other VPCs, offices, data centers, or inspection appliances.

## Planning a Small Production Network
<!-- section-summary: A small production VPC design starts with workload tiers, regions, non-overlapping ranges, default route intent, and firewall boundaries. -->

Let's put the pieces together for the food delivery app. The team wants one production network today, one main region, and a small European worker later. They also know an office VPN might arrive next quarter. That gives enough information to design a starter VPC with room to grow.

The network object can be `food-prod-vpc`, created in custom mode. Custom mode keeps subnet creation explicit. The first three subnets can live in `us-central1`: web, API, and data clients. A fourth subnet in `europe-west2` can support regional workers. The team avoids the company's office range and documents that `10.20.0.0/16` is reserved for production cloud workloads.

The API tier receives internal IP addresses only because traffic arrives from the web tier or internal load balancing. The worker tier also receives internal IPs only and uses Cloud NAT for outbound package downloads or calls to external services. The public entry point lives at a managed load balancer rather than on each application VM.

The route plan stays small. Subnet routes give private paths between subnets in the VPC. The default route remains present because Cloud NAT needs a route toward the default internet gateway for outbound IPv4 translation. If a future VPN sends `172.16.40.0/24` toward an office network, the team can add dynamic routing through Cloud Router and review route conflicts before the tunnel goes live.

The firewall plan belongs in the next article, but the network design already sets it up. Web traffic has a path to the web tier. The web tier has a path to the API tier. The API tier has a path to the database or private service endpoint. Random internet traffic has no intended rule for internal application ports. Good subnet names, service accounts, and tags make those rules easier to read later.

For a beginner, the most useful checkpoint is this: **the VPC network is the global container, the subnet is the regional IP pool, the primary range gives normal interface addresses, secondary ranges support alias IP use cases, routes choose paths, and firewall rules control packet access**.

## gcloud and Terraform Starter VPC
<!-- section-summary: A starter production VPC should be reproducible, with custom mode, explicit subnets, secondary ranges, Private Google Access, and a planned outbound path. -->

Now turn the food delivery network plan into actual infrastructure shape. The first command creates a custom-mode VPC so subnets appear only where the team creates them:

```bash
gcloud compute networks create food-prod-vpc \
  --project=food-prod \
  --subnet-mode=custom \
  --bgp-routing-mode=global
```

The important flags are `--subnet-mode=custom`, which prevents automatic regional subnet creation, and `--bgp-routing-mode=global`, which lets dynamic routes learned in one region apply across the VPC when hybrid routing arrives later. A healthy create returns an operation that finishes with `status: DONE`:

```yaml
name: operation-1749821005123-5f8a
operationType: insert
status: DONE
targetLink: projects/food-prod/global/networks/food-prod-vpc
```

Then the team creates the regional subnets. The API subnet includes secondary ranges for a future GKE cluster, and the subnets enable Private Google Access so internal-IP VMs can reach supported Google APIs through the private path:

```bash
gcloud compute networks subnets create subnet-web-us-central1 \
  --project=food-prod \
  --network=food-prod-vpc \
  --region=us-central1 \
  --range=10.20.10.0/24 \
  --enable-private-ip-google-access

gcloud compute networks subnets create subnet-api-us-central1 \
  --project=food-prod \
  --network=food-prod-vpc \
  --region=us-central1 \
  --range=10.20.20.0/24 \
  --secondary-range=pods=10.21.0.0/20,services=10.22.0.0/24 \
  --enable-private-ip-google-access
```

The important fields are `--range` for normal VM interface addresses, `--secondary-range` for alias IP use cases such as GKE Pods and Services, and `--enable-private-ip-google-access` for Google API reachability from internal-IP workloads. The expected operation output should point at the subnetwork and finish successfully:

```yaml
operationType: insert
status: DONE
targetLink: projects/food-prod/regions/us-central1/subnetworks/subnet-api-us-central1
```

If internal-only VMs need outbound internet access for package updates or external APIs, Cloud NAT gives them an outbound path without assigning external IP addresses to every VM. Cloud NAT uses Cloud Router as its control resource:

```bash
gcloud compute routers create food-prod-router-us-central1 \
  --project=food-prod \
  --network=food-prod-vpc \
  --region=us-central1

gcloud compute routers nats create food-prod-nat-us-central1 \
  --project=food-prod \
  --router=food-prod-router-us-central1 \
  --router-region=us-central1 \
  --nat-all-subnet-ip-ranges \
  --auto-allocate-nat-external-ips
```

`--nat-all-subnet-ip-ranges` means the NAT can cover every subnet range in the region, including primary and secondary ranges. `--auto-allocate-nat-external-ips` lets Google Cloud allocate NAT addresses automatically. In stricter production environments, teams often reserve and name NAT IPs instead so allowlists and change reviews have stable addresses.

The Terraform version keeps the same design in reviewable code:

```hcl
resource "google_compute_network" "food_prod" {
  project                 = var.project_id
  name                    = "food-prod-vpc"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"
}

resource "google_compute_subnetwork" "web_us_central1" {
  project                  = var.project_id
  name                     = "subnet-web-us-central1"
  region                   = "us-central1"
  network                  = google_compute_network.food_prod.id
  ip_cidr_range            = "10.20.10.0/24"
  private_ip_google_access = true
}

resource "google_compute_subnetwork" "api_us_central1" {
  project                  = var.project_id
  name                     = "subnet-api-us-central1"
  region                   = "us-central1"
  network                  = google_compute_network.food_prod.id
  ip_cidr_range            = "10.20.20.0/24"
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.21.0.0/20"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.22.0.0/24"
  }
}

resource "google_compute_router" "us_central1" {
  project = var.project_id
  name    = "food-prod-router-us-central1"
  region  = "us-central1"
  network = google_compute_network.food_prod.id
}

resource "google_compute_router_nat" "us_central1" {
  project                            = var.project_id
  name                               = "food-prod-nat-us-central1"
  region                             = "us-central1"
  router                             = google_compute_router.us_central1.name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}
```

After deployment, verify the network, subnet ranges, and default route before writing firewall rules:

```bash
gcloud compute networks describe food-prod-vpc \
  --project=food-prod \
  --format='yaml(name,autoCreateSubnetworks,routingConfig.routingMode)'

gcloud compute networks subnets list \
  --project=food-prod \
  --filter='network~food-prod-vpc' \
  --format='table(name,region,ipCidrRange,privateIpGoogleAccess,secondaryIpRanges)'

gcloud compute routes list \
  --project=food-prod \
  --filter='network~food-prod-vpc' \
  --format='table(name,destRange,nextHopGateway,nextHopInstance,nextHopIp,nextHopVpnTunnel,priority)'
```

Example healthy output should show custom subnet mode, global routing, explicit subnet ranges, Private Google Access enabled, and a default internet route if the outbound design needs it:

```yaml
name: food-prod-vpc
autoCreateSubnetworks: false
routingConfig:
  routingMode: GLOBAL
```

```console
NAME                    REGION       IP_CIDR_RANGE   PRIVATE_IP_GOOGLE_ACCESS  SECONDARY_IP_RANGES
subnet-web-us-central1  us-central1  10.20.10.0/24   True
subnet-api-us-central1  us-central1  10.20.20.0/24   True                      [{rangeName: pods, ipCidrRange: 10.21.0.0/20}, {rangeName: services, ipCidrRange: 10.22.0.0/24}]
```

```console
NAME                            DEST_RANGE     NEXT_HOP_GATEWAY                  PRIORITY
default-route-0-0-0-0-0         0.0.0.0/0      default-internet-gateway          1000
food-prod-vpc-subnet-api-route  10.20.20.0/24                                    0
food-prod-vpc-subnet-web-route  10.20.10.0/24                                    0
```

If the subnet list shows `False` for Private Google Access, private VMs may fail Google API calls later. If the routes list lacks the expected subnet route, check whether the subnet was created in the intended VPC. If the default route is missing, Cloud NAT cannot send ordinary outbound IPv4 traffic unless another route supplies that path.

This setup still needs firewall rules, load balancer design, DNS, and private service access before the app is production-ready. The value of this first shape is that the address plan, regional placement, API private access, and outbound path are explicit.

## What's Next
<!-- section-summary: The next article uses the VPC map from this article and adds packet access decisions with firewall rules. -->

Now the production VPC has a shape. It has regions, subnet ranges, private placement decisions, and a basic route story. The next question is which packets may use those paths.

The next article follows GCP firewall rules as packet access decisions. It covers direction, priority, allow and deny actions, implied rules, default network rules, stateful return traffic, targets, logging, and a practical web/API/database access scenario.

---

**References**

- [Google Cloud: VPC networks](https://docs.cloud.google.com/vpc/docs/vpc) - Defines VPC networks, global network resources, regional subnets, default networks, auto mode, and custom mode.
- [Google Cloud: Subnets](https://docs.cloud.google.com/vpc/docs/subnets) - Documents primary and secondary subnet ranges, alias IP use, valid ranges, reserved addresses, and subnet range limitations.
- [Google Cloud: Routes](https://docs.cloud.google.com/vpc/docs/routes) - Explains subnet routes, default routes, route destinations, next hops, and route interactions.
- [Google Cloud: Create and manage VPC networks](https://docs.cloud.google.com/vpc/docs/create-modify-vpc-networks) - Shows the operational workflow for creating VPC networks and subnets.
- [Google Cloud: Cloud NAT overview](https://docs.cloud.google.com/nat/docs/overview) - Explains Cloud NAT for outbound internet access from private resources.
- [Terraform Registry: google_compute_network](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network) - Defines the Terraform VPC network resource.
- [Terraform Registry: google_compute_subnetwork](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_subnetwork) - Defines subnet primary ranges, secondary ranges, and Private Google Access.
- [Terraform Registry: google_compute_router_nat](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_router_nat) - Defines Cloud NAT configuration through Terraform.

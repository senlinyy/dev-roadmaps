---
title: "What Is a GCP VPC"
description: "Understand how global VPC networks, regional subnets, IP ranges, routes, reserved addresses, and internet or NAT paths shape GCP network design."
overview: "A GCP VPC gives cloud resources private addresses and controlled network paths. The walkthrough follows a web frontend, API tier, private database clients, and background workers so each networking term has a real job."
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

1. [Why a VPC Exists](#why-a-vpc-exists)
2. [The VPC Network](#the-vpc-network)
3. [Global Network, Regional Subnets](#global-network-regional-subnets)
4. [Primary and Secondary Ranges](#primary-and-secondary-ranges)
5. [Routes](#routes)
6. [Reserved Addresses](#reserved-addresses)
7. [Internet and NAT Paths](#internet-and-nat-paths)
8. [A Starter Production Shape](#a-starter-production-shape)
9. [Commands and Terraform Shape](#commands-and-terraform-shape)
10. [References](#references)

## Why a VPC Exists
<!-- section-summary: Your cloud resources need private addresses and paths to each other before access rules can make sense. -->

Your cloud resources need private addresses and paths to each other. A web frontend needs to call an API tier. The API tier needs to reach private database clients. Background workers need to pull jobs, write files, and call internal services without every machine sitting directly on the public internet.

On a laptop, this is easy to miss. You might run a frontend on `localhost:3000`, an API on `localhost:8080`, and a database in Docker. All of those processes can talk through your local machine. Cloud production spreads those pieces across managed resources, regions, subnets, and service identities. They still need addresses and routes, but the "one laptop" network no longer exists.

That is why the first networking question is not "which firewall rule do I need?" The first question is simpler: where do these resources live, and what private paths should exist between them? A VPC gives the team the shared network map for that answer.

Picture a small learning platform. Users open a public website. A web frontend sends requests to an API. The API talks to a private PostgreSQL database and a cache. A background worker creates reports and thumbnails. Those pieces need a private network shape before the team can discuss firewall rules, load balancers, NAT, private service access, or hybrid links.

That is the job of a GCP VPC. It gives the team a private network container, regional address pools, routes, and a shared policy surface. After the map exists, firewall rules decide which packets may use the map.

## The VPC Network
<!-- section-summary: A VPC network is the global private network container for many Google Cloud resources. -->

A **Virtual Private Cloud network**, or **VPC network**, is a virtual network inside Google's production network. It is "virtual" because you do not buy switches and cables. Google runs the physical network, and you define the private address space, subnets, routes, and firewall policy your cloud resources should use.

The beginner picture is an office floor plan. The floor plan gives every room an address and shows the hallways between rooms before people start moving through the building. The VPC is that floor plan for cloud resources. Subnets are regional address areas. Routes are the hallway directions. Firewall rules are the locked doors and access checks.

This is why a VPC is not just "networking jargon." It gives Google Cloud resources a place to receive internal IP addresses, communicate over private paths, use routes, and receive firewall rule decisions.

A VPC network belongs to a Google Cloud project. One project can contain multiple VPC networks, so teams often separate production, staging, and shared infrastructure by project and network design. In the learning platform example, a production project might contain `learn-prod-vpc`, while a sandbox project contains a smaller test network.

The VPC is the place where your network intent starts. It does not grant every resource access to every other resource automatically. A packet still needs a route for the destination and a firewall decision that allows the packet for the target interface.

There are three separate ideas to keep apart:

- **Addressing:** the resource has an internal IP address from a subnet.
- **Pathing:** the VPC has a route for the destination IP range.
- **Access:** the firewall policy allows the packet for the target.

Beginners often mix those together. A VM can have the right IP address and still fail to connect because the firewall blocks the packet. A firewall rule can allow TCP `8080` and still fail because the destination IP has no route. A good troubleshooting path checks those layers one by one.

Follow one request inside the learning platform. A web VM in `web-us-central1` has internal IP `10.30.10.12`. The API VM in `api-us-central1` has internal IP `10.30.20.8`. The web service opens TCP `8080` to `10.30.20.8`.

| Packet step | What Google Cloud checks | Practical evidence |
|---|---|---|
| Source | The packet leaves the web VM with source IP `10.30.10.12` | VM network interface, subnet membership, and application log source |
| Destination | The packet is addressed to `10.30.20.8` | DNS answer or configured API endpoint |
| Route lookup | The VPC route table has a subnet route for `10.30.20.0/24` | `gcloud compute routes list` shows the API subnet route |
| Firewall decision | The API VM target needs an ingress allow for source `10.30.10.0/24` or the web workload identity on TCP `8080` | Firewall rule list and firewall logs show allow or deny |
| Delivery | If the route and firewall decision allow the flow, the API receives the request with the web VM's internal source address | API access logs show `10.30.10.12` as the caller |

This same VPC can also contain `workers-europe-west2` in another region. The global VPC scope means the network, routes, and firewall policy can describe paths across regional subnets without creating a separate VPC per region. The subnet still controls where the IP address comes from. The VPC gives those regional pools one shared private network surface.

If you know AWS, a GCP VPC covers the same broad job as an AWS VPC: a private network boundary with subnets, routes, and firewall controls around cloud resources. The important GCP difference is scope. A GCP VPC network is global, while its subnets are regional.

## Global Network, Regional Subnets
<!-- section-summary: The VPC network is global, and each subnet is a regional address pool inside that network. -->

A **global VPC network** can contain subnets in many Google Cloud regions. The network object itself is not tied to one region or zone. Routes and firewall rules also live at the VPC level, so the network gives the team one shared policy surface.

A **subnet**, also called a **subnetwork**, is a regional IP address range inside the VPC. A VM interface receives its internal IP address from a subnet in the same region as the VM's zone. For example, an API VM in `us-central1-a` can attach to a `us-central1` subnet and receive an address like `10.30.20.8`.

![A generated infographic showing one global VPC network containing regional subnet pools and private workload IPs.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/vpc-map.png)
*The VPC network is global. Subnets are regional pools where workloads receive addresses.*

For the learning platform, the team can keep one production VPC and create subnets only where workloads run:

| Subnet | Region | Intended workload |
|---|---|---|
| `web-us-central1` | `us-central1` | Web frontend instances behind the public entry point |
| `api-us-central1` | `us-central1` | API tier and internal application services |
| `data-us-central1` | `us-central1` | Database clients and private service consumers |
| `workers-europe-west2` | `europe-west2` | Regional report workers |

This shape is different from AWS, where the VPC is regional and subnets are tied to Availability Zones. In GCP, the VPC can hold subnets across regions. The subnet still controls regional placement and address assignment.

## Primary and Secondary Ranges
<!-- section-summary: Primary ranges give normal interface addresses, and secondary ranges support alias IP use cases such as GKE Pods and Services. -->

Every IPv4 subnet has a **primary range**. This range supplies the main internal IPv4 addresses for VM network interfaces. If `api-us-central1` uses `10.30.20.0/24`, the API VM interface might receive `10.30.20.8` from that primary range.

A subnet can also have **secondary ranges**. A secondary range is an extra IP range attached to the subnet for alias IP addresses. Many learners meet secondary ranges through Google Kubernetes Engine, where node VMs use the primary range while Pods and Kubernetes Services use secondary ranges.

![A generated infographic showing primary and secondary subnet ranges with a warning about overlapping office networks.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/subnet-ranges.png)
*Primary and secondary ranges need enough room for workload growth and connected networks.*

A practical API subnet might use this address plan:

| Range | CIDR | Practical use |
|---|---:|---|
| Primary range | `10.30.20.0/24` | API VM interfaces or GKE node interfaces |
| `pods` secondary range | `10.31.0.0/20` | GKE Pod alias IPs |
| `services` secondary range | `10.32.0.0/24` | Kubernetes Service IPs |

Address planning matters because overlapping ranges create confusing routing. If your office VPN uses `10.30.0.0/16` and your GCP VPC also uses `10.30.0.0/16`, a destination IP no longer clearly says which side owns the address. Production teams usually reserve a cloud CIDR plan, compare it with office and partner ranges, and document the reason for each subnet.

## Routes
<!-- section-summary: Routes tell the VPC where packets should go for a destination IP range. -->

A **route** tells the VPC network where to send packets for a destination IP range. The destination might be a subnet range such as `10.30.20.0/24`, a default internet range such as `0.0.0.0/0`, an on-premises range learned from Cloud Router, or another supported destination.

Google Cloud creates **subnet routes** for subnet ranges. After the team creates `api-us-central1` with `10.30.20.0/24`, the VPC has a route for that range. That route gives a web VM a private path toward an API VM, as long as firewall rules allow the traffic.

Here is a small route table for the learning platform after the team adds a data-center connection:

| Destination range | Route source | Next hop | Reason |
|---|---|---|---|
| `10.30.20.0/24` | Subnet route | API subnet in the VPC | Private path to API instances |
| `172.20.0.0/16` | Dynamic route learned from Cloud Router | HA VPN tunnel to the data center | Private path to the records system |
| `0.0.0.0/0` | Default route | Default internet gateway, often used with Cloud NAT for private VMs | General outbound IPv4 path with no narrower route match |

A route decision uses the destination IP. If the web VM sends to `10.30.20.8`, the `10.30.20.0/24` subnet route wins because it is the most specific match. If a worker sends to `172.20.40.10`, the learned hybrid route for `172.20.0.0/16` wins over the default route. If the same worker sends to `203.0.113.50` and no narrower route exists, the default route is the match. For two routes with the same destination range, priority and route type decide which path wins, so teams should avoid accidental duplicate intent.

Routes answer the path question. Firewall rules answer the access question. A route can say the web subnet has a path to the API subnet, while a firewall rule still blocks TCP `8080` until the team allows it.

![A generated infographic showing subnet routes for private traffic and a default route through Cloud NAT for outbound internet access.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-gcp-networking-mental-model/route-paths.png)
*Subnet routes provide private paths, and the default route supports approved outbound designs such as Cloud NAT.*

For an AWS reader, GCP routes play the same kind of role as route tables in an AWS VPC. The main design habit carries over: write down the destination range, next hop, and reason for the route. GCP still evaluates routes inside the global VPC network, while each subnet remains regional.

## Reserved Addresses
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

Reserved addresses also remind you to plan private placement. The web tier may need only private VM addresses behind a load balancer. The API tier can stay private. Workers can stay private and use NAT for outbound calls. The public entry point should be a managed frontend instead of a public IP on every application VM.

## Internet and NAT Paths
<!-- section-summary: Public entry and outbound internet access are separate designs, and Cloud NAT gives internal resources an outbound path without public VM IPs. -->

The VPC can include a default route to the default internet gateway. That route has destination `0.0.0.0/0`, which means every IPv4 destination that lacks a more specific route. A VM with an external IP address can use that path for internet traffic, subject to firewall rules and service behavior.

Many production workloads should not receive external IP addresses. A private API VM or worker might still need outbound internet access for package mirrors, external APIs, or vendor endpoints. **Cloud NAT** gives internal-IP resources an outbound IPv4 path without assigning each VM its own public IP address.

Separate public entry from outbound internet access. A public entry point lets users reach your application from the internet. Outbound access lets your private workload call something outside the VPC. Mixing those two ideas often leads to private workers receiving public IPs they do not need.

For the learning platform, users should enter through a load balancer and DNS name. The report worker should stay private and use Cloud NAT only for approved outbound calls, such as a vendor API or package mirror. That way the worker can start outbound connections while internet clients cannot open new inbound connections to the worker.

Cloud NAT is for outbound connections initiated by your resources. It does not accept inbound internet connections to private VMs. For inbound user traffic, use a public entry point such as an external Application Load Balancer, DNS, certificates, and backend routing.

For AWS readers, this maps closely to the difference between an internet gateway for public subnet paths and a NAT Gateway for private subnet outbound access. The GCP shape uses VPC routes, Cloud Router as the NAT control resource, and Cloud NAT as the managed translation service.

## A Starter Production Shape
<!-- section-summary: A small production network names the VPC, regional subnets, address ranges, routes, private placement, and outbound policy. -->

The learning platform can use one custom-mode production VPC named `learn-prod-vpc`. Custom mode means subnets appear only after the team creates them, so each regional address pool has a reason.

The web subnet receives frontend instances behind a public load balancer. The API subnet receives private API instances. The data subnet receives workloads that connect to private database and managed-service endpoints. The worker subnet supports report jobs in a second region. Subnet routes connect those ranges inside the VPC, while firewall rules in the next article decide the actual packet access.

This shape is small enough to understand and strict enough to grow. It names the network, the region, the subnet purpose, and the private range before the first workload launches. That prevents a common beginner problem: creating resources first, then discovering that every service landed in a default network with unclear address ranges and inherited rules.

The design also gives troubleshooting a map. If the API cannot reach the database, the team checks the API subnet, data path, route, firewall rule, and private service configuration. If workers cannot reach a vendor API, the team checks Cloud NAT and egress policy. The VPC layout turns vague network failure into a set of layers to inspect.

The outbound plan stays explicit. Private workers use Cloud NAT for approved internet calls. Private Google Access can be enabled on subnets where internal-IP VMs need Google APIs. Future hybrid connectivity can add Cloud Router and VPN or Interconnect routes after the team confirms CIDR ranges do not overlap.

The useful beginner checkpoint is this: **the VPC is the global network container, subnets are regional address pools, primary ranges give normal interface IPs, secondary ranges support alias IPs, routes choose paths, reserved addresses reduce usable capacity, and NAT handles private outbound internet access**.

## Commands and Terraform Shape
<!-- section-summary: A starter VPC should be reproducible, with custom mode, explicit subnets, optional secondary ranges, and an intentional NAT path. -->

The first command creates a custom-mode VPC. The command changes cloud state, so real teams usually run it through a reviewed infrastructure pipeline:

```bash
gcloud compute networks create learn-prod-vpc \
  --project=learn-prod \
  --subnet-mode=custom \
  --bgp-routing-mode=global
```

Important fields:

- `--subnet-mode=custom` keeps subnet creation deliberate.
- `--bgp-routing-mode=global` lets dynamic routes learned in one region apply across the VPC after hybrid routing is added.
- `--project=learn-prod` makes the project ownership explicit.

Expected operation output should finish with `DONE`:

```yaml
operationType: insert
status: DONE
targetLink: projects/learn-prod/global/networks/learn-prod-vpc
```

Now create subnets. The API subnet includes secondary ranges for a future GKE cluster and enables Private Google Access for internal-IP workloads that call supported Google APIs:

```bash
gcloud compute networks subnets create web-us-central1 \
  --project=learn-prod \
  --network=learn-prod-vpc \
  --region=us-central1 \
  --range=10.30.10.0/24 \
  --enable-private-ip-google-access

gcloud compute networks subnets create api-us-central1 \
  --project=learn-prod \
  --network=learn-prod-vpc \
  --region=us-central1 \
  --range=10.30.20.0/24 \
  --secondary-range=pods=10.31.0.0/20,services=10.32.0.0/24 \
  --enable-private-ip-google-access
```

Important fields:

- `--range` is the primary range for VM interface addresses.
- `--secondary-range` provides alias IP pools for GKE-style workloads.
- `--enable-private-ip-google-access` supports private VM access to Google APIs with correct DNS and routes.

Cloud NAT provides an outbound path for internal-only resources:

```bash
gcloud compute routers create learn-prod-router-us-central1 \
  --project=learn-prod \
  --network=learn-prod-vpc \
  --region=us-central1

gcloud compute routers nats create learn-prod-nat-us-central1 \
  --project=learn-prod \
  --router=learn-prod-router-us-central1 \
  --router-region=us-central1 \
  --nat-all-subnet-ip-ranges \
  --auto-allocate-nat-external-ips
```

Important fields:

- `--nat-all-subnet-ip-ranges` covers primary and secondary ranges in the region.
- `--auto-allocate-nat-external-ips` lets Google Cloud allocate NAT IPs. Stricter environments often reserve named NAT IPs for allowlists and change review.
- The Cloud Router is the control resource for NAT. It does not mean BGP is required for this basic NAT setup.

The same shape in Terraform keeps the network reviewable:

```hcl
resource "google_compute_network" "learn_prod" {
  project                 = var.project_id
  name                    = "learn-prod-vpc"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"
}

resource "google_compute_subnetwork" "api_us_central1" {
  project                  = var.project_id
  name                     = "api-us-central1"
  region                   = "us-central1"
  network                  = google_compute_network.learn_prod.id
  ip_cidr_range            = "10.30.20.0/24"
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.31.0.0/20"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.32.0.0/24"
  }
}
```

Verification should prove the network mode, subnet ranges, and route table before the team writes firewall rules:

```bash
gcloud compute networks describe learn-prod-vpc \
  --project=learn-prod \
  --format='yaml(name,autoCreateSubnetworks,routingConfig.routingMode)'

gcloud compute networks subnets list \
  --project=learn-prod \
  --filter='network~learn-prod-vpc' \
  --format='table(name,region,ipCidrRange,privateIpGoogleAccess,secondaryIpRanges)'

gcloud compute routes list \
  --project=learn-prod \
  --filter='network~learn-prod-vpc' \
  --format='table(name,destRange,nextHopGateway,nextHopVpnTunnel,priority)'
```

Healthy output should show custom subnet mode, global routing, explicit regional subnets, Private Google Access where intended, subnet routes, and a default route for outbound designs that need NAT or external IP paths:

```yaml
name: learn-prod-vpc
autoCreateSubnetworks: false
routingConfig:
  routingMode: GLOBAL
```

```console
NAME             REGION       IP_CIDR_RANGE   PRIVATE_IP_GOOGLE_ACCESS
web-us-central1  us-central1  10.30.10.0/24   True
api-us-central1  us-central1  10.30.20.0/24   True
```

```console
NAME                              DEST_RANGE     NEXT_HOP_GATEWAY          PRIORITY
default-route-0-0-0-0-0           0.0.0.0/0      default-internet-gateway  1000
learn-prod-vpc-api-us-central1    10.30.20.0/24                            0
learn-prod-vpc-web-us-central1    10.30.10.0/24                            0
```

## References

- [VPC networks](https://docs.cloud.google.com/vpc/docs/vpc) - Defines VPC networks, global network scope, regional subnets, default networks, auto mode, and custom mode.
- [Subnets](https://docs.cloud.google.com/vpc/docs/subnets) - Documents primary and secondary ranges, valid subnet ranges, reserved addresses, and subnet range behavior.
- [Routes](https://docs.cloud.google.com/vpc/docs/routes) - Explains subnet routes, default routes, route priorities, destinations, and next hops.
- [Create and manage VPC networks](https://docs.cloud.google.com/vpc/docs/create-modify-vpc-networks) - Shows the official workflow for creating VPC networks and subnets with Google Cloud CLI.
- [Cloud NAT overview](https://docs.cloud.google.com/nat/docs/overview) - Explains outbound NAT for resources without external IP addresses.
- [Private Google Access](https://docs.cloud.google.com/vpc/docs/private-google-access) - Explains private access from internal-IP VMs to Google APIs and services.

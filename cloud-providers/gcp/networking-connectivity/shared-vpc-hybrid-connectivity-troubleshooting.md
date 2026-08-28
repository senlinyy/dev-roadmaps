---
title: "Shared VPC, Hybrid Connectivity, and Troubleshooting"
description: "Understand Shared VPC host and service projects, subnet delegation, Cloud VPN, Cloud Interconnect, Cloud Router, BGP, and a practical packet-by-packet troubleshooting ladder."
overview: "Shared VPC separates workload ownership from network ownership. Hybrid transport and BGP extend that shared network beyond Google Cloud, and troubleshooting proves each ownership, naming, route, transport, policy, and application layer."
tags: ["gcp", "shared-vpc", "hybrid-connectivity", "troubleshooting"]
order: 6
id: article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting
aliases:
  - shared-vpc-hybrid-connectivity-and-troubleshooting
  - shared-vpc-hybrid-connectivity-troubleshooting
  - cloud-providers/gcp/networking-connectivity/shared-vpc-hybrid-connectivity-and-troubleshooting.md
---

## Table of Contents

1. [What Problem Does Shared VPC Solve?](#what-problem-does-shared-vpc-solve)
2. [How Do Host and Service Projects Divide Ownership?](#how-do-host-and-service-projects-divide-ownership)
3. [How Do Subnet Delegation and Network User Work?](#how-do-subnet-delegation-and-network-user-work)
4. [Why Do Firewalls, Routes, and DNS Follow the Shared Network?](#why-do-firewalls-routes-and-dns-follow-the-shared-network)
5. [How Do VPN and Interconnect Carry Hybrid Traffic?](#how-do-vpn-and-interconnect-carry-hybrid-traffic)
6. [How Do Cloud Router and BGP Exchange Reachability?](#how-do-cloud-router-and-bgp-exchange-reachability)
7. [How Do Commands and Terraform Express the Design?](#how-do-commands-and-terraform-express-the-design)
8. [How Should Troubleshooting Follow the Packet?](#how-should-troubleshooting-follow-the-packet)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

One team owns networks, many teams own apps. That is the normal shape in a growing company. The platform team owns IP ranges, subnets, routes, DNS, firewall policy, VPNs, and Interconnect. Product teams own application projects, deploy pipelines, service accounts, logs, and release schedules.

Imagine payments, orders, and analytics teams, each with its own project. Giving each project a separate VPC also creates three copies of firewall, DNS, NAT, hybrid links, routes, and IP planning. Shared VPC takes the other approach: application teams keep workload projects while a central network team owns one network.

**Shared VPC** is the Google Cloud feature for that shape. A central host project owns the VPC network and subnets. Attached service projects run application resources that consume selected shared subnets. The application team deploys resources in its own project, while the network team keeps control of the shared network.

After shared ownership is clear, hybrid connectivity adds another path. Some traffic may need to reach a data center, a partner network, or another cloud. Google Cloud usually builds those private paths with Cloud VPN or Cloud Interconnect, while Cloud Router exchanges routes through BGP.

Keep these questions in view as you work through the lesson:

1. **What Problem Does Shared VPC Solve?**
2. **How Do Host and Service Projects Divide Ownership?**
3. **How Do Subnet Delegation and Network User Work?**
4. **Why Do Firewalls, Routes, and DNS Follow the Shared Network?**
5. **How Do VPN and Interconnect Carry Hybrid Traffic?**
6. **How Do Cloud Router and BGP Exchange Reachability?**
7. **How Do Commands and Terraform Express the Design?**
8. **How Should Troubleshooting Follow the Packet?**

## What Problem Does Shared VPC Solve?
<!-- section-summary: One team owns networks, many teams own apps, and Shared VPC keeps those jobs separated. -->

The central distinction is that a Google Cloud project is an administrative boundary while a VPC is a network boundary. They do not need to have the same owner. That separation links Shared VPC ownership, hybrid reachability, and the troubleshooting ladder used later.

## How Do Host and Service Projects Divide Ownership?
<!-- section-summary: A host project owns the Shared VPC networks and central network resources. -->

A **host project** is a Google Cloud project that contains Shared VPC networks. The host project owns the VPC network, subnets, routes, firewall rules, Cloud NAT gateways, Cloud VPN gateways, Interconnect VLAN attachments, Cloud Routers, and many private DNS zones.

In this shared network, the host project can be `network-host`. It owns `prod-vpc`, subnet `apps-europe`, subnet `database-europe`, the central firewall policy, and the hybrid links to the data center.

![A generated infographic showing a host project owning the network while service projects run applications through delegated shared subnets.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting/shared-vpc-ownership.png)
*The host project owns the network. Service projects run applications that use delegated shared subnets.*

This ownership gives the network team one place to design address ranges, review firewall rules, manage routes, and operate hybrid links. It also keeps application teams from needing broad network administration roles in production.

During deployment, the host project is where network prerequisites are prepared before an app rollout can attach to the shared network. The network team creates the subnet, decides whether Private Google Access is enabled, grants subnet use to the right service-project identity, and verifies firewall policy for the expected source and destination. The orders team can then deploy its API in `orders-prod` and select the approved host-project subnet.


A network-team-only change might be advertising a new `10.20.0.0/16` subnet over Cloud Router to the data center. That change affects return routing from on-premises systems and should stay with the team that owns BGP policy. The orders team should not need permission to edit Cloud Router advertisements just to deploy a new API revision.

### What Does a Service Project Own?
<!-- section-summary: A service project runs application resources that use selected subnets from the host project. -->

A **service project** is attached to a host project so eligible resources can use shared subnets. The workload still belongs to the service project for IAM, billing, deployment, logs, and application ownership. Its network interface uses an IP address from a subnet owned by the host project.

For example, the orders API can run in `orders-prod`. Its VM, GKE node, or supported load balancer component can attach to `apps-europe` from `network-host`. The orders team still owns the API deployment and service account. The host project still owns the subnet and network policy.

A typical deployment story has two project views at the same time. In the service project, the orders pipeline builds the container image, deploys the service, uses `orders-api@orders-prod.iam.gserviceaccount.com`, writes logs to the service project, and charges compute usage to the service project billing setup. In the host project, the workload's network interface consumes an IP address from `projects/network-host/regions/europe-west1/subnetworks/apps-europe`.

That means an incident ticket should name both sides. The app owner checks revision logs, IAM for the runtime service account, application metrics, and recent deploys in `orders-prod`. The network owner checks subnet capacity, route selection, firewall policy, DNS binding, and hybrid route exchange in `network-host`. The resource lives in one project while its packets use a subnet owned by another project.

A project has one Shared VPC role at a time. It can be a host project or a service project. A service project attaches to one host project. Existing resources do not magically move to the shared network after project attachment, so migrations usually create new resources that select the shared subnet.

## How Do Subnet Delegation and Network User Work?
<!-- section-summary: Subnet delegation gives a service-project team permission to use selected shared subnets. -->

**Subnet delegation** means the host-project network team allows a service-project identity to attach resources to selected shared subnets. The goal is narrow access. The orders team may use `apps-europe`, while the analytics team may use `database-europe`.

Delegation can happen at host-project scope or subnet scope. Project-level delegation is convenient for trusted platform automation because it grants access to all shared subnets in the host project. Subnet-level delegation is safer for application teams because it grants access only to the subnet they need.

For this shared network, the orders deployment service account should use the app subnet and no analytics subnet. That keeps an orders API rollout from accidentally creating resources in the wrong network segment.

The principal that receives `roles/compute.networkUser` should be the identity that attaches resources to the shared subnet. In many teams, that is a CI/CD service account such as `orders-deploy@orders-prod.iam.gserviceaccount.com`. For managed platforms, it may be a Google-managed service agent or a platform automation identity. Human users usually receive this role only through a tightly reviewed operations group.

| Delegation style | Where the role is granted | Good fit | Risk |
|---|---|---|---|
| Host-project level | Host project IAM policy | Central platform automation that can use any approved shared subnet | One identity can consume every shared subnet in the host project |
| Subnet level | Individual subnet IAM policy | Application team or deployer that needs one subnet | More bindings to manage, with tighter blast radius |

A missing delegation failure usually names the exact permission and subnet:

```console
ERROR: (gcloud.compute.instances.create) Could not fetch resource:
 - Required 'compute.subnetworks.use' permission for
   'projects/network-host/regions/europe-west1/subnetworks/apps-europe'
```

That message points to host-project subnet IAM, not the service project's application roles. Adding Compute Instance Admin in `orders-prod` will not fix it. Grant `roles/compute.networkUser` on the specific subnet to the deployer or service agent that is attaching the network interface.

Narrow subnet delegation is safer because an application rollout can only consume the network segment it was approved to use. If the orders API only receives `apps-europe`, a bad variable cannot place it in `database-europe` or a future restricted subnet without a separate host-project IAM change.

### Why Is Network User Weaker Than Network Admin?
<!-- section-summary: Compute Network User lets a service-project identity use a shared subnet without owning the network. -->

The common IAM role for subnet delegation is **Compute Network User**, shown as `roles/compute.networkUser`. This role lets a principal use a VPC network or subnet for eligible resources. It does not grant full control over routes, firewall rules, VPNs, or other central network resources.

The service project still needs normal application roles inside the service project. A CI/CD service account may need Cloud Run Admin, GKE permissions, Compute Instance Admin, or load balancer-related roles in `orders-prod`. Shared VPC adds host-project network permission alongside those application permissions.

Typical ownership:

| Actor | Typical location | What they manage |
|---|---|---|
| Shared VPC Admin | Organization, folder, or host project | Enables host projects and attaches service projects |
| Network Admin | Host project | VPCs, subnets, routes, Cloud Router, NAT, VPN, Interconnect |
| Security Admin | Host project or folder | Firewall rules and firewall policies |
| Service Project Admin | Service project plus delegated subnets | Application resources that consume approved subnets |

This is the practical value of Shared VPC. The orders team can ship an API version without permission to add a broad firewall allow from the corporate network. The network team can update a route or DNS zone without owning the orders application project.

## Why Do Firewalls, Routes, and DNS Follow the Shared Network?
<!-- section-summary: In Shared VPC, much of the packet path evidence lives in the host project, even for workloads running from service projects. -->

In a Shared VPC design, central network controls usually live in the host project. **Firewall rules and firewall policies** decide which traffic may enter or leave workloads. **Routes** decide where packets go for subnets, private service access, VPNs, Interconnect, peering, and custom next hops. **Cloud DNS private zones** decide how internal names resolve for resources using the shared network.

The orders API may run in `orders-prod`, but its interface uses a subnet from `network-host`. If it cannot reach `database.corp.example.com` in a data center, the useful evidence may be a private DNS zone in the host project, a dynamic route learned by Cloud Router, and a firewall policy owned by the platform team.

![A generated infographic showing hybrid route evidence through VPN or Interconnect, Cloud Router, advertised ranges, and an on-premises system.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting/hybrid-route-evidence.png)
*Hybrid evidence needs both transport state and route exchange: a tunnel can be up while the needed prefix is missing.*

DNS deserves early attention. A private zone might be attached to the shared VPC, or the organization might use cross-project binding. If the service project resolves a public record while the host project has the private zone, the application can call the wrong address even if routes and firewalls are correct.

Routes need the same precision. Useful route evidence includes destination prefix, next hop, route type, priority, and network. A broad static route can change traffic behavior. A missing dynamic route can make a healthy VPN tunnel useless for the destination the app needs.

Firewalls need exact packet facts. Source project, source IP, service account or tag, destination IP, protocol, port, direction, and timestamp all matter. Hierarchical firewall policies may apply above the host project, so the team should check policy layers as well as local VPC firewall rules.

## How Do VPN and Interconnect Carry Hybrid Traffic?
<!-- section-summary: VPN and Interconnect provide private transport, while Cloud Router exchanges dynamic routes with external networks. -->

**Cloud VPN** connects a Google Cloud VPC to another network through IPsec VPN tunnels. HA VPN is the usual modern production choice because it supports redundant interfaces and higher availability designs. It is a common fit for early migrations, lower-bandwidth private connectivity, backup paths, and encrypted tunnels over the public internet.

**Cloud Interconnect** provides dedicated connectivity between external networks and Google's network. Dedicated Interconnect uses physical connections at supported colocation facilities, while Partner Interconnect uses a supported service provider. Interconnect is common when a company needs higher throughput or a private transport model different from encrypted VPN tunnels.

The physical or provider connection is not itself the VPC attachment. A **VLAN attachment** associates one VPC and Cloud Router with the Interconnect and supplies the VLAN and BGP parameters. Read the chain as VPC → Cloud Router → VLAN attachment → Interconnect → customer router. The attachment determines which VPC can exchange traffic across that connection.

HA VPN and Interconnect solve the transport problem differently. HA VPN encrypts packets through IPsec and uses a gateway with two interfaces. A redundant topology needs independent tunnels and peer paths; the supported two-interface design is what can qualify for the `99.99%` availability SLA, while one tunnel remains one failure path. Interconnect uses a physical or provider-backed transport and a VLAN attachment rather than an IPsec tunnel.

Hybrid design therefore has two questions before routing is considered. First, what transport carries a packet between Google and the external network? Second, what redundancy survives a component or path failure? One IPsec tunnel may establish connectivity but still leaves one tunnel, peer device, or external path as a failure point. A production HA VPN design uses both gateway interfaces, multiple tunnels, and independent peer-side paths so loss of one path can leave another available. The external router and operational monitoring must participate in that redundancy; creating two Google-side objects does not by itself prove two independent end-to-end paths.

Interconnect changes the transport, not the need for route exchange or redundancy. Dedicated Interconnect uses physical connections at supported colocation facilities. Partner Interconnect reaches Google through a supported provider. A VLAN attachment then binds the VPC and Cloud Router to a particular logical circuit. A team must verify the physical or provider connection, VLAN attachment, BGP session, learned routes, advertised routes, and external return path as separate layers.

## How Do Cloud Router and BGP Exchange Reachability?

**Cloud Router** is Google Cloud's managed BGP speaker. BGP, Border Gateway Protocol, exchanges reachable prefixes between networks. Cloud Router works with HA VPN tunnels and Interconnect VLAN attachments so Google Cloud can learn external routes and advertise VPC subnet ranges back.

Despite its name, Cloud Router is not a data-plane appliance through which application packets travel. Its BGP tasks belong to the control plane: they learn and advertise prefixes and feed dynamic routes into the VPC. The packet data plane reads the resulting route and goes through the selected VPN tunnel or VLAN attachment without traversing a Cloud Router box.

This produces two independent health questions. The transport or **data path** asks whether packets can cross the VPN or Interconnect attachment. The **control path** asks whether the BGP peers are established and exchanging the required prefixes. A tunnel can be up while BGP is down, or BGP can be established while firewall policy rejects the data flow.

This separation explains several common observations. An established tunnel with an idle BGP peer means encrypted transport exists without dynamic route exchange. An established BGP peer with no required prefix means the speakers are talking but not advertising the destination the application needs. Correct learned and advertised prefixes with a timeout can move attention toward firewall policy, the external path, or the destination listener. A successful TCP connection followed by an application `403` moves the investigation above basic packet reachability.

The pieces fit together like this:

| Component | What it carries | Common use | Evidence to check |
|---|---|---|---|
| HA VPN | Encrypted IPsec tunnels over the internet | Early hybrid connectivity, backup paths, lower-bandwidth private links | Tunnel status, peer IP, BGP session status |
| Cloud Interconnect | Dedicated or provider-backed connectivity to Google's network | Higher throughput, predictable private transport, larger migrations | VLAN attachment state, Interconnect state, BGP session status |
| Cloud Router | BGP route exchange for VPN and Interconnect | Learning external prefixes and advertising VPC ranges | Learned routes, advertised routes, BGP peer state |

Cloud Router creates dynamic VPC routes from prefixes learned over BGP. A session marked `ESTABLISHED` proves that the routing conversation exists; it does not prove the needed prefix is part of that conversation. Inspect the exact learned and advertised ranges.

The VPC's dynamic routing mode controls where learned routes can apply. **Regional** mode creates learned dynamic routes only in the relevant region. **Global** mode makes the best learned paths available across VPC regions. In a globally distributed Shared VPC with centralized hybrid links, that distinction can explain why one region reaches on-premises while another cannot.

For this shared network, the on-premises database lives at `172.16.20.10` in a data center. The network team creates HA VPN tunnels or Interconnect VLAN attachments from `prod-vpc` to the data center. Cloud Router learns `172.16.0.0/12` from the external router and advertises `10.20.0.0/16` back. The orders API sends packets to `172.16.20.10`, the VPC route table selects the learned route, and firewall rules on both sides must allow the flow.

The BGP exchange has two directions. The data-center router advertises `172.16.0.0/12`, so Google Cloud learns where an on-premises database lives. Cloud Router advertises the GCP subnet such as `10.20.0.0/16`, so the data center knows how to return packets. If only the learned route exists, the application can send the first packet while the response has no path back. If only the advertised route exists, on-premises knows the cloud subnet while Google Cloud has no route toward the database.

That yields a critical equation: connectivity equals a forward path plus a return path. A healthy tunnel proves neither. Always ask which route Google chooses for the destination and which route the external router chooses back toward the source.

During a real incident, the useful question is specific: "Does Cloud Router show `172.16.0.0/12` as learned from the BGP peer, and does it advertise `10.20.0.0/16` back?" Tunnel state alone is too shallow because an encrypted tunnel can be established while BGP route exchange is missing the exact prefix the application needs.


## How Do Commands and Terraform Express the Design?
<!-- section-summary: Shared VPC setup enables the host project, attaches service projects, and grants subnet access. -->

Shared VPC setup has three basic operations: enable the host project, attach the service project, and grant subnet access to the deployment identity.

```bash
gcloud compute shared-vpc enable network-host

gcloud compute shared-vpc associated-projects add orders-prod \
  --host-project=network-host

gcloud compute networks subnets add-iam-policy-binding apps-europe \
  --project=network-host \
  --region=europe-west1 \
  --member="serviceAccount:orders-deploy@orders-prod.iam.gserviceaccount.com" \
  --role="roles/compute.networkUser"
```

Important fields:

- `shared-vpc enable` marks the host project as the network owner.
- `associated-projects add` attaches the service project to the host project.
- `add-iam-policy-binding` grants the deployment identity subnet-level use of `apps-europe`.
- `roles/compute.networkUser` lets the identity attach eligible resources to the subnet without controlling the whole network.

Verification should prove the host attachment and subnet IAM binding:

```bash
gcloud compute shared-vpc get-host-project orders-prod

gcloud compute shared-vpc list-associated-resources network-host \
  --format='table(id,type)'

gcloud compute networks subnets get-iam-policy apps-europe \
  --project=network-host \
  --region=europe-west1 \
  --flatten='bindings[].members' \
  --filter='bindings.role=roles/compute.networkUser' \
  --format='table(bindings.role,bindings.members)'
```

Healthy output:

```console
network-host
```

```console
ID               TYPE
orders-prod  PROJECT
```

```console
ROLE                       MEMBERS
roles/compute.networkUser  serviceAccount:orders-deploy@orders-prod.iam.gserviceaccount.com
```

The same setup in Terraform keeps ownership reviewable:

```hcl
resource "google_compute_shared_vpc_host_project" "host" {
  project = var.host_project_id
}

resource "google_compute_shared_vpc_service_project" "orders" {
  host_project    = google_compute_shared_vpc_host_project.host.project
  service_project = var.orders_project_id
}

resource "google_compute_subnetwork_iam_member" "orders_network_user" {
  project    = var.host_project_id
  region     = "europe-west1"
  subnetwork = google_compute_subnetwork.apps_europe.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:orders-deploy@${var.orders_project_id}.iam.gserviceaccount.com"
}
```

A minimal hybrid shape adds Cloud Router and HA VPN next to the Shared VPC. Production HA VPN usually repeats this pattern for the second interface and tunnel, so the example shows one peer clearly and keeps the route-exchange fields visible:

```hcl
resource "google_compute_router" "hybrid" {
  project = var.host_project_id
  name    = "hybrid-router"
  region  = "europe-west1"
  network = google_compute_network.prod.id

  bgp {
    asn               = 64514
    advertise_mode    = "CUSTOM"
    advertised_groups = ["ALL_SUBNETS"]
  }
}

resource "google_compute_ha_vpn_gateway" "vpn" {
  project = var.host_project_id
  name    = "corp-vpn"
  region  = "europe-west1"
  network = google_compute_network.prod.id
}

resource "google_compute_external_vpn_gateway" "onprem" {
  project         = var.host_project_id
  name            = "corp-dc"
  redundancy_type = "TWO_IPS_REDUNDANCY"

  interface {
    id         = 0
    ip_address = "198.51.100.10"
  }

  interface {
    id         = 1
    ip_address = "198.51.100.11"
  }
}

resource "google_compute_vpn_tunnel" "tunnel_a" {
  project                         = var.host_project_id
  name                            = "corp-vpn-a"
  region                          = "europe-west1"
  vpn_gateway                     = google_compute_ha_vpn_gateway.vpn.id
  vpn_gateway_interface           = 0
  peer_external_gateway           = google_compute_external_vpn_gateway.onprem.id
  peer_external_gateway_interface = 0
  shared_secret                   = var.vpn_shared_secret
  router                          = google_compute_router.hybrid.id
}

resource "google_compute_router_interface" "interface_a" {
  project    = var.host_project_id
  name       = "corp-if-a"
  region     = "europe-west1"
  router     = google_compute_router.hybrid.name
  ip_range   = "169.254.10.1/30"
  vpn_tunnel = google_compute_vpn_tunnel.tunnel_a.name
}

resource "google_compute_router_peer" "peer_a" {
  project                   = var.host_project_id
  name                      = "corp-peer-a"
  region                    = "europe-west1"
  router                    = google_compute_router.hybrid.name
  interface                 = google_compute_router_interface.interface_a.name
  peer_ip_address           = "169.254.10.2"
  peer_asn                  = 65020
  advertised_route_priority = 100
}

resource "google_compute_interconnect_attachment" "onprem" {
  project = var.host_project_id
  name    = "onprem-europe"
  region  = "europe-west1"
  router  = google_compute_router.hybrid.id
  type    = "DEDICATED"

  interconnect = var.interconnect_uri
}
```

Important fields:

- `google_compute_router` owns the BGP session settings for the host-project VPC.
- `advertised_groups = ["ALL_SUBNETS"]` advertises VPC subnet ranges such as `10.20.0.0/16`; stricter environments may advertise custom ranges instead.
- `google_compute_ha_vpn_gateway` is the Google Cloud side of the HA VPN transport.
- `google_compute_external_vpn_gateway` records the data-center VPN gateway public IPs.
- `google_compute_router_interface` and `google_compute_router_peer` create the BGP session that learns and advertises prefixes over the tunnel.
- `google_compute_interconnect_attachment` is the VLAN attachment that connects this VPC and Cloud Router to an existing Interconnect.

Hybrid verification checks transport and route exchange. A VPN tunnel or Interconnect attachment can be healthy while the required prefix is missing, so Cloud Router status is the high-value command:

```bash
gcloud compute vpn-tunnels list \
  --project=network-host \
  --filter='region:(europe-west1)' \
  --format='table(name,region,status,peerIp,router)'

gcloud compute interconnects attachments list \
  --project=network-host \
  --filter='region:(europe-west1)' \
  --format='table(name,region,interconnect,state,router)'

gcloud compute routers get-status hybrid-router \
  --project=network-host \
  --region=europe-west1 \
  --format=yaml
```

Healthy output should show established transport and learned plus advertised routes:

```console
NAME              REGION       STATUS       PEER_IP        ROUTER
corp-vpn-1     europe-west1  ESTABLISHED  198.51.100.10  hybrid-router
```

```yaml
bestRoutesForRouter:
- destRange: 172.16.0.0/12
  nextHopVpnTunnel: https://www.googleapis.com/compute/v1/projects/network-host/regions/europe-west1/vpnTunnels/corp-vpn-1
bgpPeerStatus:
- name: corp-peer-a
  status: UP
  numLearnedRoutes: 12
advertisedRoutes:
- destRange: 10.20.0.0/16
  description: apps-europe
```

If the tunnel is established and the route is missing, investigate BGP advertisement, route filters, peer configuration,  route exchange before changing application code.

## How Should Troubleshooting Follow the Packet?
<!-- section-summary: Troubleshooting speed comes from moving through endpoint facts, DNS, routes, firewalls, hybrid state, and service evidence. -->

A troubleshooting ladder turns “the network is broken” into one falsifiable flow such as `10.20.5.4 → 172.16.20.10 TCP:5432`. The tools vary by workload, but the evidence order stays stable.

**Step 1: ownership and attachment.** Identify the service project, host project, actual VPC, and subnet used by the source interface. Attaching a project to a host does not migrate existing resources; the workload must really use the shared subnet. A creation-time `compute.subnetworks.use` error belongs here.

**Step 2: DNS.** Resolve the application hostname from the runtime's network context. If `database.corp.example.com` returns NXDOMAIN or a public address instead of `172.16.20.10`, routing analysis is already aimed at the wrong destination. Verify private-zone authorization or cross-project binding to the Shared VPC.

**Step 3: forward route.** Determine which destination prefix wins in the host VPC. A learned `172.16.0.0/12` route should beat `0.0.0.0/0`. If it is absent, inspect the BGP peer, advertisements, routing mode, and conflicts.

**Step 4: tunnel or attachment state.** For VPN, confirm the tunnel is established. For Interconnect, confirm the VLAN attachment is operational. Healthy transport does not prove route exchange.

**Step 5: BGP.** Confirm the peer is `ESTABLISHED`, then inspect the actual learned and advertised prefixes. A healthy session that lacks `172.16.0.0/12` still cannot route the database flow.

**Step 6: return route.** Inspect the external router's decision for the source address. The request can arrive successfully and still time out when on-premises has no route back to `10.20.0.0/16`.

**Step 7: firewall policy.** Check the exact source, destination, protocol, port, direction, selectors, and priority on the Google side and on-premises side. Shared VPC centralizes the cloud policy, but it cannot override an external firewall.

**Step 8: destination.** Verify that the database or other service is running, listening on the expected port and interface, and allowed by the host operating-system firewall. Correct DNS, routing, BGP, and VPC policy cannot make a stopped process accept a connection.

**Step 9: application authorization.** Treat an HTTP `403` or database authentication failure as evidence that the network probably delivered the request. Investigate IAM, tokens, database credentials, or application policy instead of randomly changing routes.

Connectivity Tests can simulate much of the Google Cloud configuration path for supported endpoints, including IP addresses, VMs, GKE resources, Cloud Run revisions or jobs, and several managed services. It cannot prove that the destination application is listening or that an external firewall permits the final hop, so keep the last two ladder steps separate.

Run the test for the same source, destination IP, protocol, and port as the failed application flow. A generic test to a nearby VM can succeed while the real destination prefix or port follows a different policy. Save the test result with the effective route and firewall decision it reports. If the simulated Google Cloud path succeeds, that is evidence to investigate the external network, destination host, or application layer next; it is not proof that the complete end-to-end connection succeeded.

Change one layer only after the evidence identifies it. Adding a broad route while also opening firewall policy and changing DNS destroys the ability to learn which term was wrong and can create a lasting security exception. A safer response records the failed checkpoint, makes the narrow correction, repeats the exact flow, and then removes any temporary diagnostic rule. The ladder is useful because it turns troubleshooting into controlled comparison rather than configuration guessing.

Compact reference:

| Check | Evidence to collect | Common finding |
|---|---|---|
| Ownership | Host attachment, source interface, shared subnet | Resource is not using the intended Shared VPC |
| DNS | Runtime resolver answer and private zone attachment | Hostname resolves to old IP or wrong endpoint |
| Forward route | Selected next hop, prefix, priority, route type | Missing remote prefix or wrong default path |
| Transport and BGP | Tunnel or VLAN state plus learned prefixes | Transport up while the needed prefix is missing |
| Return route | External route toward the source prefix | Requests leave, but responses have no path back |
| Firewalls | Matching allow or deny policy on both sides | Higher-priority deny or wrong selector |
| Connectivity Tests | Simulated path and reachability result | Drop at route or firewall step |
| Destination and auth | Listener state, host firewall, application response | Refusal, `401`, or `403` narrows the final layer |

The final operating shape is practical. The network team owns `network-host`, the shared VPC, subnets, firewall policy, private DNS zones, Cloud Router, VPN or Interconnect. The application teams own service projects, workloads, service accounts, deploy pipelines, and application logs. Incidents move faster after both sides share one named flow and climb the ladder together.

Central ownership follows from packet reality. A subnet used by a service project still belongs to the host VPC; it is not copied into the service project. Routes, firewall rules, private DNS, and hybrid attachments therefore remain host-network concerns even when application resources and billing live elsewhere. The application team needs permission to use the delegated subnet, but it should not need broad permission to redesign the shared network.

The useful handoff is evidence, not the sentence "networking looks fine." The application team can provide the source interface and IP, destination name and resolved IP, protocol and port, timestamp, service account, and application response. The network team can provide the winning forward route, tunnel or attachment state, BGP peer and exact prefixes, return-path evidence, matching policy, and Connectivity Tests result. Together those facts identify the first failed layer and prevent simultaneous, uncoordinated changes to DNS, routes, and firewall rules.

The model to remember is compact: Shared VPC separates application ownership from network ownership; delegation authorizes subnet use without transferring administration; hybrid transport carries packets; Cloud Router exchanges reachability; BGP must advertise both directions; and successful connectivity requires forward route, transport, return route, firewall permission, a listening destination, and valid application authorization. Troubleshooting is the act of proving those terms in order for one exact flow.

## Check Your Answers

:::expand[What Problem Does Shared VPC Solve?]{kind="recap"}
Shared VPC lets a central team own one network while application teams keep separate projects and workloads. It separates the administrative project boundary from the network boundary.
:::

:::expand[How Do Host and Service Projects Divide Ownership?]{kind="recap"}
The host project owns the actual VPC, subnets, routes, firewall policy, DNS relationships, and hybrid resources. Service projects own their application resources, which attach to host-owned subnets.
:::

:::expand[How Do Subnet Delegation and Network User Work?]{kind="recap"}
`roles/compute.networkUser` lets a principal consume a network or selected subnet without administering it. Workload-creation permission in the service project remains a separate requirement.
:::

:::expand[Why Do Firewalls, Routes, and DNS Follow the Shared Network?]{kind="recap"}
Packets use the host project's actual VPC, so its routing and firewall configuration determine movement, and private DNS visibility follows the network authorized for the zone rather than the workload's project alone.
:::

:::expand[How Do VPN and Interconnect Carry Hybrid Traffic?]{kind="recap"}
HA VPN transports encrypted packets through redundant IPsec tunnels. Interconnect uses physical or provider connectivity, and a VLAN attachment associates a VPC and Cloud Router with that transport.
:::

:::expand[How Do Cloud Router and BGP Exchange Reachability?]{kind="recap"}
Cloud Router exchanges prefixes in the control plane; it does not forward application packets. A healthy BGP session must still advertise the needed forward and return prefixes in the relevant routing mode.
:::

:::expand[How Do Commands and Terraform Express the Design?]{kind="recap"}
Enable the host, attach service projects, grant Network User at the intended scope, then model the shared network, Cloud Router, VPN tunnels or VLAN attachments, interfaces, and BGP peers as separate resources.
:::

:::expand[How Should Troubleshooting Follow the Packet?]{kind="recap"}
For one source, destination, protocol, and port, verify ownership, DNS, forward route, transport, BGP prefixes, return route, firewall policy, destination listener, and application authorization in order.
:::

## References

- [Shared VPC](https://docs.cloud.google.com/vpc/docs/shared-vpc) - Defines host projects, service projects, subnet sharing, IAM delegation, centralized network control, DNS, and load balancing notes.
- [Provision Shared VPC](https://docs.cloud.google.com/vpc/docs/provisioning-shared-vpc) - Shows the official setup workflow for enabling a host project, attaching service projects, and granting subnet access.
- [Cloud Router overview](https://docs.cloud.google.com/network-connectivity/docs/router/concepts/overview) - Explains Cloud Router and BGP route exchange for VPN and Interconnect.
- [View Cloud Router details](https://docs.cloud.google.com/network-connectivity/docs/router/how-to/viewing-router-details) - Documents `gcloud compute routers get-status` for BGP session state, learned routes, and advertised routes.
- [Cloud Interconnect overview](https://docs.cloud.google.com/network-connectivity/docs/interconnect/concepts/overview) - Describes Dedicated Interconnect, Partner Interconnect, capacity, and route-related considerations.
- [Connectivity Tests overview](https://docs.cloud.google.com/network-intelligence-center/docs/connectivity-tests/concepts/overview) - Documents path simulation and live data plane analysis for supported scenarios.

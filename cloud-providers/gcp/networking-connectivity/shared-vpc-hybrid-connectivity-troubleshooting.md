---
title: "Shared VPC, Hybrid Connectivity, and Troubleshooting"
description: "Understand Shared VPC host and service projects, subnet delegation, Cloud VPN, Cloud Interconnect, Cloud Router, Network Connectivity Center, and a practical GCP troubleshooting ladder."
overview: "Shared VPC lets a platform team own the network while application teams deploy in separate projects. Hybrid connectivity extends that network to data centers, partners, and other clouds, and troubleshooting follows DNS, routes, firewalls, hybrid state, and service evidence."
tags: ["gcp", "shared-vpc", "hybrid-connectivity", "troubleshooting"]
order: 6
id: article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting
aliases:
  - shared-vpc-hybrid-connectivity-and-troubleshooting
  - shared-vpc-hybrid-connectivity-troubleshooting
  - cloud-providers/gcp/networking-connectivity/shared-vpc-hybrid-connectivity-and-troubleshooting.md
---

## Table of Contents

1. [Shared Ownership Problem](#shared-ownership-problem)
2. [Host Project](#host-project)
3. [Service Project](#service-project)
4. [Subnet Delegation](#subnet-delegation)
5. [Network User](#network-user)
6. [Central Firewalls, Routes, and DNS](#central-firewalls-routes-and-dns)
7. [VPN, Interconnect, and Cloud Router](#vpn-interconnect-and-cloud-router)
8. [Commands and Terraform Shape](#commands-and-terraform-shape)
9. [Troubleshooting Ladder](#troubleshooting-ladder)
10. [References](#references)

## Shared Ownership Problem
<!-- section-summary: One team owns networks, many teams own apps, and Shared VPC keeps those jobs separated. -->

One team owns networks, many teams own apps. That is the normal shape in a growing company. The platform team owns IP ranges, subnets, routes, DNS, firewall policy, VPNs, and Interconnect. Product teams own application projects, deploy pipelines, service accounts, logs, and release schedules.

The learning platform now has several teams. The course team runs the public API. The analytics team runs batch jobs. The identity team owns internal admin services. All of them need approved private network paths, and none of them should receive broad permission to edit every production route or firewall rule.

**Shared VPC** is the Google Cloud feature for that shape. A central host project owns the VPC network and subnets. Attached service projects run application resources that consume selected shared subnets. The application team deploys resources in its own project, while the network team keeps control of the shared network.

After shared ownership is clear, hybrid connectivity adds another path. Some traffic may need to reach a data center, a partner network, or another cloud. Google Cloud usually builds those private paths with Cloud VPN, Cloud Interconnect, Cloud Router, and sometimes Network Connectivity Center.

For AWS readers, Shared VPC is a familiar idea if you have used AWS VPC sharing. Hybrid anchors also map naturally: Cloud VPN is close to Site-to-Site VPN, Cloud Interconnect is close to Direct Connect, Cloud Router handles BGP route exchange, and Network Connectivity Center overlaps with some Transit Gateway and cloud WAN organizing ideas. Route 53 Resolver ideas are useful for DNS paths that cross network boundaries, although the Google Cloud DNS mechanics differ.

## Host Project
<!-- section-summary: A host project owns the Shared VPC networks and central network resources. -->

A **host project** is a Google Cloud project that contains Shared VPC networks. The host project owns the VPC network, subnets, routes, firewall rules, Cloud NAT gateways, Cloud VPN gateways, Interconnect VLAN attachments, Cloud Routers, and many private DNS zones.

In the learning platform, the host project can be `net-learn-prod`. It owns `learn-shared-vpc`, subnet `apps-us-central1`, subnet `analytics-us-central1`, the central firewall policy, and the hybrid links to the data center.

![A generated infographic showing a host project owning the network while service projects run applications through delegated shared subnets.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting/shared-vpc-ownership.png)
*The host project owns the network. Service projects run applications that use delegated shared subnets.*

This ownership gives the network team one place to design address ranges, review firewall rules, manage routes, and operate hybrid links. It also keeps application teams from needing broad network administration roles in production.

During deployment, the host project is where network prerequisites are prepared before an app rollout can attach to the shared network. The network team creates the subnet, decides whether Private Google Access is enabled, grants subnet use to the right service-project identity, and verifies firewall policy for the expected source and destination. The course team can then deploy its API in `app-course-prod` and select the approved host-project subnet.

During incident response, the host project is also where many packet-path facts live. If the course API cannot reach `records.internal.example.com`, the app team may own the logs and release history in `app-course-prod`, while the network team checks the private DNS zone, Cloud Router learned routes, firewall policy, VPN tunnel state, and VPC Flow Logs in `net-learn-prod`.

A network-team-only change might be advertising a new `10.40.10.0/24` subnet over Cloud Router to the data center. That change affects return routing from on-premises systems and should stay with the team that owns BGP policy. The course team should not need permission to edit Cloud Router advertisements just to deploy a new API revision.

## Service Project
<!-- section-summary: A service project runs application resources that use selected subnets from the host project. -->

A **service project** is attached to a host project so eligible resources can use shared subnets. The workload still belongs to the service project for IAM, billing, deployment, logs, and application ownership. Its network interface uses an IP address from a subnet owned by the host project.

For example, the course API can run in `app-course-prod`. Its VM, GKE node, or supported load balancer component can attach to `apps-us-central1` from `net-learn-prod`. The course team still owns the API deployment and service account. The host project still owns the subnet and network policy.

A typical deployment story has two project views at the same time. In the service project, the course pipeline builds the container image, deploys the service, uses `course-api@app-course-prod.iam.gserviceaccount.com`, writes logs to the service project, and charges compute usage to the service project billing setup. In the host project, the workload's network interface consumes an IP address from `projects/net-learn-prod/regions/us-central1/subnetworks/apps-us-central1`.

That means an incident ticket should name both sides. The app owner checks revision logs, IAM for the runtime service account, application metrics, and recent deploys in `app-course-prod`. The network owner checks subnet capacity, route selection, firewall policy, DNS binding, and hybrid route exchange in `net-learn-prod`. The resource lives in one project while its packets use a subnet owned by another project.

A project has one Shared VPC role at a time. It can be a host project or a service project. A service project attaches to one host project. Existing resources do not magically move to the shared network after project attachment, so migrations usually create new resources that select the shared subnet.

## Subnet Delegation
<!-- section-summary: Subnet delegation gives a service-project team permission to use selected shared subnets. -->

**Subnet delegation** means the host-project network team allows a service-project identity to attach resources to selected shared subnets. The goal is narrow access. The course team may use `apps-us-central1`, while the analytics team may use `analytics-us-central1`.

Delegation can happen at host-project scope or subnet scope. Project-level delegation is convenient for trusted platform automation because it grants access to all shared subnets in the host project. Subnet-level delegation is safer for application teams because it grants access only to the subnet they need.

For the learning platform, the course deployment service account should use the app subnet and no analytics subnet. That keeps a course API rollout from accidentally creating resources in the wrong network segment.

The principal that receives `roles/compute.networkUser` should be the identity that attaches resources to the shared subnet. In many teams, that is a CI/CD service account such as `course-deploy@app-course-prod.iam.gserviceaccount.com`. For managed platforms, it may be a Google-managed service agent or a platform automation identity. Human users usually receive this role only through a tightly reviewed operations group.

| Delegation style | Where the role is granted | Good fit | Risk |
|---|---|---|---|
| Host-project level | Host project IAM policy | Central platform automation that can use any approved shared subnet | One identity can consume every shared subnet in the host project |
| Subnet level | Individual subnet IAM policy | Application team or deployer that needs one subnet | More bindings to manage, with tighter blast radius |

A missing delegation failure usually names the exact permission and subnet:

```console
ERROR: (gcloud.compute.instances.create) Could not fetch resource:
 - Required 'compute.subnetworks.use' permission for
   'projects/net-learn-prod/regions/us-central1/subnetworks/apps-us-central1'
```

That message points to host-project subnet IAM, not the service project's application roles. Adding Compute Instance Admin in `app-course-prod` will not fix it. Grant `roles/compute.networkUser` on the specific subnet to the deployer or service agent that is attaching the network interface.

Narrow subnet delegation is safer because an application rollout can only consume the network segment it was approved to use. If the course API only receives `apps-us-central1`, a bad variable cannot place it in `analytics-us-central1` or a future restricted subnet without a separate host-project IAM change.

## Network User
<!-- section-summary: Compute Network User lets a service-project identity use a shared subnet without owning the network. -->

The common IAM role for subnet delegation is **Compute Network User**, shown as `roles/compute.networkUser`. This role lets a principal use a VPC network or subnet for eligible resources. It does not grant full control over routes, firewall rules, VPNs, or other central network resources.

The service project still needs normal application roles inside the service project. A CI/CD service account may need Cloud Run Admin, GKE permissions, Compute Instance Admin, or load balancer-related roles in `app-course-prod`. Shared VPC adds host-project network permission alongside those application permissions.

Typical ownership:

| Actor | Typical location | What they manage |
|---|---|---|
| Shared VPC Admin | Organization, folder, or host project | Enables host projects and attaches service projects |
| Network Admin | Host project | VPCs, subnets, routes, Cloud Router, NAT, VPN, Interconnect |
| Security Admin | Host project or folder | Firewall rules and firewall policies |
| Service Project Admin | Service project plus delegated subnets | Application resources that consume approved subnets |

This is the practical value of Shared VPC. The course team can ship an API version without permission to add a broad firewall allow from the corporate network. The network team can update a route or DNS zone without owning the course application project.

## Central Firewalls, Routes, and DNS
<!-- section-summary: In Shared VPC, much of the packet path evidence lives in the host project, even for workloads running from service projects. -->

In a Shared VPC design, central network controls usually live in the host project. **Firewall rules and firewall policies** decide which traffic may enter or leave workloads. **Routes** decide where packets go for subnets, private service access, VPNs, Interconnect, peering, and custom next hops. **Cloud DNS private zones** decide how internal names resolve for resources using the shared network.

The course API may run in `app-course-prod`, but its interface uses a subnet from `net-learn-prod`. If it cannot reach `records.internal.example.com` in a data center, the useful evidence may be a private DNS zone in the host project, a dynamic route learned by Cloud Router, and a firewall policy owned by the platform team.

![A generated infographic showing hybrid route evidence through VPN or Interconnect, Cloud Router, advertised ranges, and an on-premises system.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting/hybrid-route-evidence.png)
*Hybrid evidence needs both transport state and route exchange: a tunnel can be up while the needed prefix is missing.*

DNS deserves early attention. A private zone might be attached to the shared VPC, or the organization might use cross-project binding. If the service project resolves a public record while the host project has the private zone, the application can call the wrong address even if routes and firewalls are correct.

Routes need the same precision. Useful route evidence includes destination prefix, next hop, route type, priority, and network. A broad static route can change traffic behavior. A missing dynamic route can make a healthy VPN tunnel useless for the destination the app needs.

Firewalls need exact packet facts. Source project, source IP, service account or tag, destination IP, protocol, port, direction, and timestamp all matter. Hierarchical firewall policies may apply above the host project, so the team should check policy layers as well as local VPC firewall rules.

## VPN, Interconnect, and Cloud Router
<!-- section-summary: VPN and Interconnect provide private transport, while Cloud Router exchanges dynamic routes with external networks. -->

**Cloud VPN** connects a Google Cloud VPC to another network through IPsec VPN tunnels. HA VPN is the usual modern production choice because it supports redundant interfaces and higher availability designs. It is a common fit for early migrations, lower-bandwidth private connectivity, backup paths, and encrypted tunnels over the public internet.

**Cloud Interconnect** provides dedicated connectivity between external networks and Google's network. Dedicated Interconnect uses physical connections at supported colocation facilities. Partner Interconnect uses a supported service provider. Cross-Cloud Interconnect connects Google Cloud to another cloud provider. Interconnect is common for companies that need higher throughput, predictable paths, or private transport that avoids the public internet.

**Cloud Router** is Google Cloud's managed BGP speaker. BGP, Border Gateway Protocol, exchanges reachable prefixes between networks. Cloud Router works with HA VPN tunnels and Interconnect VLAN attachments so Google Cloud can learn external routes and advertise VPC subnet ranges back.

The pieces fit together like this:

| Component | What it carries | Common use | Evidence to check |
|---|---|---|---|
| HA VPN | Encrypted IPsec tunnels over the internet | Early hybrid connectivity, backup paths, lower-bandwidth private links | Tunnel status, peer IP, BGP session status |
| Cloud Interconnect | Dedicated or provider-backed connectivity to Google's network | Higher throughput, predictable private transport, larger migrations | VLAN attachment state, Interconnect state, BGP session status |
| Cloud Router | BGP route exchange for VPN and Interconnect | Learning external prefixes and advertising VPC ranges | Learned routes, advertised routes, BGP peer state |

For the learning platform, the records system lives at `172.20.40.10` in a data center. The network team creates HA VPN tunnels or Interconnect VLAN attachments from `learn-shared-vpc` to the data center. Cloud Router learns `172.20.0.0/16` from the external router and advertises `10.40.10.0/24` back. The course API sends packets to `172.20.40.10`, the VPC route table selects the learned route, and firewall rules on both sides must allow the flow.

The BGP exchange has two directions. The data-center router advertises `172.20.0.0/16`, so Google Cloud learns where the records system lives. Cloud Router advertises `10.40.10.0/24`, so the data center knows how to return packets to the app subnet. If only the learned route exists, the course API can send the first packet toward the data center, while the response may have no route back. If only the advertised route exists, the data center knows the app subnet, while Google Cloud may have no path to `172.20.40.10`.

During a real incident, the useful question is specific: "Does Cloud Router show `172.20.0.0/16` as learned from the BGP peer, and does it advertise `10.40.10.0/24` back?" Tunnel state alone is too shallow because an encrypted tunnel can be established while BGP route exchange is missing the exact prefix the application needs.

Network Connectivity Center can organize larger designs with hubs and spokes. It helps organizations with many VPCs, VPN tunnels, Interconnect attachments, router appliances, and external sites. During incidents, NCC can add another place where route exchange state needs review.

## Commands and Terraform Shape
<!-- section-summary: Shared VPC setup enables the host project, attaches service projects, and grants subnet access. -->

Shared VPC setup has three basic operations: enable the host project, attach the service project, and grant subnet access to the deployment identity.

```bash
gcloud compute shared-vpc enable net-learn-prod

gcloud compute shared-vpc associated-projects add app-course-prod \
  --host-project=net-learn-prod

gcloud compute networks subnets add-iam-policy-binding apps-us-central1 \
  --project=net-learn-prod \
  --region=us-central1 \
  --member="serviceAccount:course-deploy@app-course-prod.iam.gserviceaccount.com" \
  --role="roles/compute.networkUser"
```

Important fields:

- `shared-vpc enable` marks the host project as the network owner.
- `associated-projects add` attaches the service project to the host project.
- `add-iam-policy-binding` grants the deployment identity subnet-level use of `apps-us-central1`.
- `roles/compute.networkUser` lets the identity attach eligible resources to the subnet without controlling the whole network.

Verification should prove the host attachment and subnet IAM binding:

```bash
gcloud compute shared-vpc get-host-project app-course-prod

gcloud compute shared-vpc list-associated-resources net-learn-prod \
  --format='table(id,type)'

gcloud compute networks subnets get-iam-policy apps-us-central1 \
  --project=net-learn-prod \
  --region=us-central1 \
  --flatten='bindings[].members' \
  --filter='bindings.role=roles/compute.networkUser' \
  --format='table(bindings.role,bindings.members)'
```

Healthy output:

```console
net-learn-prod
```

```console
ID               TYPE
app-course-prod  PROJECT
```

```console
ROLE                       MEMBERS
roles/compute.networkUser  serviceAccount:course-deploy@app-course-prod.iam.gserviceaccount.com
```

The same setup in Terraform keeps ownership reviewable:

```hcl
resource "google_compute_shared_vpc_host_project" "host" {
  project = var.host_project_id
}

resource "google_compute_shared_vpc_service_project" "course" {
  host_project    = google_compute_shared_vpc_host_project.host.project
  service_project = var.course_project_id
}

resource "google_compute_subnetwork_iam_member" "course_network_user" {
  project    = var.host_project_id
  region     = "us-central1"
  subnetwork = google_compute_subnetwork.apps_us_central1.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:course-deploy@${var.course_project_id}.iam.gserviceaccount.com"
}
```

A minimal hybrid shape adds Cloud Router and HA VPN next to the Shared VPC. Production HA VPN usually repeats this pattern for the second interface and tunnel, so the example shows one peer clearly and keeps the route-exchange fields visible:

```hcl
resource "google_compute_router" "learn_router_us_central1" {
  project = var.host_project_id
  name    = "learn-router-us-central1"
  region  = "us-central1"
  network = google_compute_network.learn_shared.id

  bgp {
    asn               = 64514
    advertise_mode    = "CUSTOM"
    advertised_groups = ["ALL_SUBNETS"]
  }
}

resource "google_compute_ha_vpn_gateway" "learn_havpn" {
  project = var.host_project_id
  name    = "learn-havpn-us-central1"
  region  = "us-central1"
  network = google_compute_network.learn_shared.id
}

resource "google_compute_external_vpn_gateway" "records_dc" {
  project         = var.host_project_id
  name            = "records-dc"
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

resource "google_compute_vpn_tunnel" "records_tunnel_a" {
  project                         = var.host_project_id
  name                            = "records-vpn-a"
  region                          = "us-central1"
  vpn_gateway                     = google_compute_ha_vpn_gateway.learn_havpn.id
  vpn_gateway_interface           = 0
  peer_external_gateway           = google_compute_external_vpn_gateway.records_dc.id
  peer_external_gateway_interface = 0
  shared_secret                   = var.records_vpn_shared_secret
  router                          = google_compute_router.learn_router_us_central1.id
}

resource "google_compute_router_interface" "records_if_a" {
  project    = var.host_project_id
  name       = "records-if-a"
  region     = "us-central1"
  router     = google_compute_router.learn_router_us_central1.name
  ip_range   = "169.254.10.1/30"
  vpn_tunnel = google_compute_vpn_tunnel.records_tunnel_a.name
}

resource "google_compute_router_peer" "records_peer_a" {
  project                   = var.host_project_id
  name                      = "records-peer-a"
  region                    = "us-central1"
  router                    = google_compute_router.learn_router_us_central1.name
  interface                 = google_compute_router_interface.records_if_a.name
  peer_ip_address           = "169.254.10.2"
  peer_asn                  = 65020
  advertised_route_priority = 100
}
```

Important fields:

- `google_compute_router` owns the BGP session settings for the host-project VPC.
- `advertised_groups = ["ALL_SUBNETS"]` advertises VPC subnet ranges such as `10.40.10.0/24`; stricter environments may advertise custom ranges instead.
- `google_compute_ha_vpn_gateway` is the Google Cloud side of the HA VPN transport.
- `google_compute_external_vpn_gateway` records the data-center VPN gateway public IPs.
- `google_compute_router_interface` and `google_compute_router_peer` create the BGP session that learns and advertises prefixes over the tunnel.

Hybrid verification checks transport and route exchange. A VPN tunnel or Interconnect attachment can be healthy while the required prefix is missing, so Cloud Router status is the high-value command:

```bash
gcloud compute vpn-tunnels list \
  --project=net-learn-prod \
  --filter='region:(us-central1)' \
  --format='table(name,region,status,peerIp,router)'

gcloud compute interconnects attachments list \
  --project=net-learn-prod \
  --filter='region:(us-central1)' \
  --format='table(name,region,interconnect,state,router)'

gcloud compute routers get-status learn-router-us-central1 \
  --project=net-learn-prod \
  --region=us-central1 \
  --format=yaml
```

Healthy output should show established transport and learned plus advertised routes:

```console
NAME              REGION       STATUS       PEER_IP        ROUTER
records-vpn-1     us-central1  ESTABLISHED  198.51.100.10  learn-router-us-central1
```

```yaml
bestRoutesForRouter:
- destRange: 172.20.0.0/16
  nextHopVpnTunnel: https://www.googleapis.com/compute/v1/projects/net-learn-prod/regions/us-central1/vpnTunnels/records-vpn-1
bgpPeerStatus:
- name: records-peer-a
  status: UP
  numLearnedRoutes: 12
advertisedRoutes:
- destRange: 10.40.10.0/24
  description: apps-us-central1
```

If the tunnel is established and the route is missing, investigate BGP advertisement, route filters, peer configuration, or NCC route exchange before changing application code.

## Troubleshooting Ladder
<!-- section-summary: Troubleshooting speed comes from moving through endpoint facts, DNS, routes, firewalls, hybrid state, and service evidence. -->

A troubleshooting ladder turns "the network is broken" into evidence. The exact tools vary by workload, but the order stays useful for Shared VPC and hybrid paths.

**Step 1: Flow facts.** Capture source project, source resource, source IP, destination hostname, destination IP, protocol, port, timestamp, and the last known working point. For the course API, that might be `app-course-prod`, source IP `10.40.10.18`, destination `records.internal.example.com`, resolved IP `172.20.40.10`, TCP `443`, failing since a deploy window.

**Step 2: DNS evidence.** Resolve the hostname from the runtime path or the closest equivalent. A laptop DNS answer may differ from a VM, GKE Pod, or Cloud Run revision. Check private zone attachment, cross-project binding, and whether the name should resolve to a PSC endpoint, internal load balancer, or hybrid address.

**Step 3: Route evidence.** Check the selected route in the host-project VPC. Include destination prefix, next hop, priority, and route type. For hybrid paths, check Cloud Router or NCC to confirm that Google Cloud learned the external prefix and advertised the return prefix.

**Step 4: Firewall evidence.** Check VPC firewall rules, hierarchical firewall policies, target service accounts, target tags, source ranges, destination ranges, protocol, port, and priority. For hybrid traffic, external firewalls and partner controls join the same check.

**Step 5: Hybrid state.** Check VPN tunnel status, Interconnect attachment state, Cloud Router BGP peer status, learned routes, advertised routes, and route filters. A green transport status proves the link is up, while route evidence proves the destination can use it.

**Step 6: Connectivity Tests.** Use Connectivity Tests for supported endpoints to simulate the Google Cloud forwarding path. It can point at route, firewall, policy, or endpoint issues before the team changes application code.

**Step 7: Flow logs and service logs.** VPC Flow Logs, Flow Analyzer, load balancer logs, Cloud Run logs, GKE logs, database logs, and application logs show runtime behavior. Flow logs can show packets leaving the source subnet. Service logs can show whether the destination received and handled the request.

![A generated infographic showing a troubleshooting ladder from endpoint facts through DNS, routes, firewalls, hybrid state, and service logs.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-shared-vpc-hybrid-connectivity-troubleshooting/troubleshooting-ladder.png)
*The troubleshooting ladder keeps DNS, routing, firewall policy, hybrid advertisements, and service logs in separate checks.*

Compact reference:

| Check | Evidence to collect | Common finding |
|---|---|---|
| Flow facts | Source, destination, port, protocol, timestamp | Teams are testing different destinations |
| DNS | Runtime resolver answer and private zone attachment | Hostname resolves to old IP or wrong endpoint |
| Routes | Selected next hop, prefix, priority, route type | Missing remote prefix or wrong static route |
| Firewalls | Matching allow or deny rule in both directions | Higher-priority deny or wrong target service account |
| Hybrid state | Tunnel, VLAN attachment, BGP learned and advertised routes | Transport up while prefix is missing |
| Connectivity Tests | Simulated path and reachability result | Drop at route or firewall step |
| Flow evidence | VPC Flow Logs and Flow Analyzer results | Packets leave source with no return traffic |
| Service evidence | Load balancer, Cloud Run, GKE, Cloud SQL, app logs | Backend unhealthy or app rejects request |

The final operating shape is practical. The network team owns `net-learn-prod`, the shared VPC, subnets, firewall policy, private DNS zones, Cloud Router, VPN or Interconnect, and NCC where used. The application teams own service projects, workloads, service accounts, deploy pipelines, and application logs. Incidents move faster after both sides share one named flow and climb the ladder together.

## References

- [Shared VPC](https://docs.cloud.google.com/vpc/docs/shared-vpc) - Defines host projects, service projects, subnet sharing, IAM delegation, centralized network control, DNS, and load balancing notes.
- [Provision Shared VPC](https://docs.cloud.google.com/vpc/docs/provisioning-shared-vpc) - Shows the official setup workflow for enabling a host project, attaching service projects, and granting subnet access.
- [Choosing a Network Connectivity product](https://docs.cloud.google.com/network-connectivity/docs/how-to/choose-product) - Compares Cloud VPN, Cloud Interconnect, Cloud Router, and related connectivity choices.
- [Cloud Router overview](https://docs.cloud.google.com/network-connectivity/docs/router/concepts/overview) - Explains Cloud Router and BGP route exchange for VPN and Interconnect.
- [View Cloud Router details](https://docs.cloud.google.com/network-connectivity/docs/router/how-to/viewing-router-details) - Documents `gcloud compute routers get-status` for BGP session state, learned routes, and advertised routes.
- [Cloud Interconnect overview](https://docs.cloud.google.com/network-connectivity/docs/interconnect/concepts/overview) - Describes Dedicated Interconnect, Partner Interconnect, Cross-Cloud Interconnect, capacity, and route-related considerations.
- [Network Connectivity Center overview](https://docs.cloud.google.com/network-connectivity/docs/network-connectivity-center/concepts/overview) - Explains NCC hubs, spokes, route exchange, and larger connectivity designs.
- [Connectivity Tests overview](https://docs.cloud.google.com/network-intelligence-center/docs/connectivity-tests/concepts/overview) - Documents path simulation and live data plane analysis for supported scenarios.
- [VPC Flow Logs](https://docs.cloud.google.com/vpc/docs/flow-logs) - Explains sampled flow logs, supported resources, Shared VPC logging location, and troubleshooting use cases.
- [Flow Analyzer overview](https://docs.cloud.google.com/network-intelligence-center/docs/flow-analyzer/overview) - Describes flow-log analysis, filtering, and traffic aggregation.

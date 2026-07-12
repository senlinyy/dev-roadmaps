---
title: "Private Access to Managed Services"
description: "Compare Private Google Access, Private Services Access, and Private Service Connect for private access to Google APIs, Cloud SQL, and producer services."
overview: "Private access in Google Cloud has separate shapes for Google APIs, managed service producer networks, and local private endpoints. The walkthrough keeps DNS, routes, IAM, and service setup separate so each failure has evidence."
tags: ["gcp", "private-access", "cloud-sql", "private-service-connect"]
order: 5
id: article-cloud-providers-gcp-networking-connectivity-private-access-managed-services
aliases:
  - private-access
  - private-access-to-managed-services
  - cloud-providers/gcp/networking-connectivity/private-access.md
  - cloud-providers/gcp/networking-connectivity/private-access-to-managed-services.md
---

## Table of Contents

1. [Why Private Access Exists](#why-private-access-exists)
2. [The Private Access Split](#the-private-access-split)
3. [Private Google Access](#private-google-access)
4. [Private Services Access](#private-services-access)
5. [Private Service Connect](#private-service-connect)
6. [DNS, Routes, IAM, and Service Setup](#dns-routes-iam-and-service-setup)
7. [Commands and Terraform Shapes](#commands-and-terraform-shapes)
8. [Verification Runbook](#verification-runbook)
9. [Choosing the Right Pattern](#choosing-the-right-pattern)
10. [References](#references)

## Why Private Access Exists
<!-- section-summary: A private workload often needs managed services without relying on public internet paths. -->

A private workload often needs managed services without relying on public internet paths. A VM, GKE Pod, or Cloud Run service may run with only private addresses, while the application still needs Google APIs, a managed database, a cache, or a service published by another team.

Use a learning platform again. A report worker in subnet `apps-us-central1` has no external IP address. It needs to read files from Cloud Storage, fetch a Secret Manager value, connect to a Cloud SQL PostgreSQL instance through private IP, and call a fraud-scoring service published by the data platform team.

The beginner trap is assuming "private" means one switch. It does not. Reading Secret Manager, connecting to Cloud SQL private IP, and calling a producer service through a local endpoint are three different jobs. They may all avoid a public VM IP address, yet they use different routing, DNS, IAM, and service setup.

Think of the worker as sitting inside a private office. It still needs three kinds of private calls: a call to Google API front desks, a call to a managed database room, and a call to another team's published service desk. The office being private is only the starting point; each destination still needs the correct door.

Those needs sound similar because they all use the word private. In Google Cloud, they use different features. Treating them as one feature creates bad debugging: a Secret Manager IAM error, a Cloud SQL private IP route problem, and a Private Service Connect DNS issue can all show up as "the private call failed."

## The Private Access Split
<!-- section-summary: The right private access pattern follows the destination type. -->

The first decision is the destination type. Google APIs, VPC-hosted managed services, and producer services use different private access patterns.

A simple picture helps: "private access" is not one door. It is three different doors for three different destinations. One door leads to Google APIs such as Cloud Storage and Secret Manager. One door leads to managed services that live behind private IPs, such as Cloud SQL. One door leads to a private endpoint for a service published by another team or another Google API path.

The names sound similar, so beginners often try to debug them as one thing. That creates confusion. A VM failing to read Secret Manager may have a healthy network path and a missing IAM role. A Cloud SQL timeout may involve Private Services Access and producer routes. A PSC endpoint with the wrong DNS record can send the app to the wrong IP before IAM is even relevant.

| Workload need | GCP pattern | What it gives you |
|---|---|---|
| A private VM calls Cloud Storage, Secret Manager, Pub/Sub, or Artifact Registry APIs | **Private Google Access** | Subnet-level access from internal-IP VMs to Google APIs and services |
| An app connects to Cloud SQL, Filestore, Memorystore, or another producer-network managed service through private IP | **Private Services Access** | A private connection between your VPC and a service producer VPC |
| An app uses a local private endpoint for Google APIs or a producer service | **Private Service Connect** | A consumer-side private endpoint that forwards to a supported API or published service |

Keep these patterns separate during operations. Private Google Access is a subnet and Google API reachability feature. Private Services Access is a peering-style producer network connection. Private Service Connect is an endpoint and service publishing pattern. The next sections define them in that order.

For AWS readers, the anchors are useful after the GCP split is clear. Private Google Access overlaps with the idea of private access to AWS service APIs through gateway or interface endpoints. Private Services Access often appears in managed database private-IP designs and service-managed network paths. Private Service Connect is the closest GCP anchor to PrivateLink-style endpoint access, especially for producers that publish one service to consumers.

## Private Google Access
<!-- section-summary: Private Google Access lets internal-IP VMs in an enabled subnet reach Google APIs and services. -->

**Private Google Access** is a subnet setting. It lets VM instances with only internal IP addresses reach supported Google APIs and services. It is most relevant for VMs with no external IP address that still need API endpoints such as `storage.googleapis.com` or `secretmanager.googleapis.com`.

In the learning platform, `report-worker-1` has no external IP address. The application needs to read exported course files from Cloud Storage and access one Secret Manager secret. Private Google Access gives the VM a supported network path to those Google APIs from its subnet.

![A generated infographic showing an internal VM using a subnet Private Google Access setting to reach Google API hostnames while IAM still controls the API action.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-private-access-managed-services/private-google-access.png)
*Private Google Access provides API reachability from an enabled subnet, while IAM still controls each API action.*

Private Google Access has three practical pieces:

| Piece | What to check |
|---|---|
| Subnet setting | The VM's subnet has Private Google Access enabled |
| DNS and route behavior | API names resolve to the intended Google API VIP path |
| IAM and service policy | The VM service account has permission for the API action |

Network reachability and API authorization stay separate. If the worker reaches Secret Manager and receives `PERMISSION_DENIED`, the private network path may be healthy while IAM or a service perimeter blocks the action. If the worker cannot reach the API endpoint at all, check the subnet setting, DNS, route, and egress firewall policy.

This VM example teaches the cleanest version of the pattern. Cloud Run and GKE can also need private access to Google APIs, and each path includes its own egress choices first. A Cloud Run service may need Direct VPC egress or a Serverless VPC Access connector before the team checks Private Google Access, DNS, and IAM. A GKE Pod may use node subnet settings, Pod ranges, Workload Identity, and DNS. Write down the client shape first: VM, Cloud Run, or GKE. Then inspect the matching egress path and API access controls.

## Private Services Access
<!-- section-summary: Private Services Access creates a private connection to a service producer VPC, which supports managed service private IPs such as Cloud SQL. -->

**Private Services Access**, often shortened to PSA, creates a private connection between your VPC network and a VPC network owned by a Google or third-party service producer. It uses VPC Network Peering underneath. Your workloads use internal IP addresses to reach managed services that live in the producer network.

Cloud SQL private IP is the common beginner example. The report worker connects to `learn-postgres-prod` through a private address. Cloud SQL runs in a Google-managed producer network, and PSA connects the application VPC to that producer network so the private address is reachable.

![A generated infographic showing an allocated producer range, private services connection, and database private address.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-private-access-managed-services/private-services-access.png)
*Private Services Access reserves address space for managed service producer networks before services receive private IPs.*

PSA requires an **allocated IP range**. This is private address space reserved in your VPC for the service producer. The range must avoid overlap with your subnets, future subnets, peered networks, VPN routes, Interconnect routes, and any route exchange through Network Connectivity Center.

The setup order is important. Enable the Service Networking API, reserve the allocated range, create the private services connection, and then create or update the managed service to use private IP. For Cloud SQL, enabling or changing private IP settings can affect the instance, so teams plan the change through a maintenance window if needed.

PSA is not transitive peering. If another VPC is peered to your application VPC, it does not automatically inherit access through your private services connection. That is one reason service-level endpoint patterns such as Private Service Connect are attractive for many consumer networks that need access without broad route sharing.

## Private Service Connect
<!-- section-summary: Private Service Connect gives a consumer VPC a local private endpoint for supported APIs or producer services. -->

**Private Service Connect**, or PSC, lets a consumer access a service privately through an endpoint in the consumer VPC. The consumer gets a local internal IP address. Google Cloud forwards traffic from that endpoint to a supported Google API, a Google managed service, or a producer service published through a service attachment.

For Google APIs, PSC can provide an internal endpoint for API access. The network team can create a private endpoint address and pair it with DNS so applications call the expected API names through the endpoint.

For producer services, PSC gives service-level connectivity. Imagine the data platform team publishes `fraud-score.internal.example.com` from a separate producer project. The learning platform should call that one service without receiving route visibility into the whole data platform VPC. PSC lets the producer publish a service attachment and the consumer create an endpoint in the consumer VPC.

![A generated infographic showing a consumer VPC private endpoint, DNS record, and producer service path for Private Service Connect.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-private-access-managed-services/private-service-connect.png)
*Private Service Connect gives the consumer a local private endpoint while the producer exposes a service rather than a whole network.*

PSC still needs surrounding configuration. The consumer project needs permissions to create internal addresses and forwarding rules. DNS should point the application hostname at the endpoint. Egress firewall policy must allow traffic to the endpoint address. The producer service must be healthy and accept the consumer connection according to its publishing policy.

## DNS, Routes, IAM, and Service Setup
<!-- section-summary: Private access designs need separate checks for DNS, routes, firewall, IAM, and service configuration. -->

**DNS** decides which IP address the application tries to reach. Private Google Access may use normal `googleapis.com` names, `private.googleapis.com`, or `restricted.googleapis.com` depending on the environment. PSC usually needs DNS records that point the service name at the endpoint IP. Cloud SQL private IP may use direct private addresses, connection names, or connector behavior depending on the client.

**Routes** decide the next hop for the destination IP. Private Google Access needs a valid path to the Google API VIPs. Private Services Access adds peering routes for the producer range. PSC uses the endpoint address inside the consumer VPC.

**Firewall rules** decide whether the source workload can send packets to the destination. A private VM may need egress to Google API VIPs, a Cloud SQL private address, or a PSC endpoint address. In a restricted environment, broad implied egress may be replaced with narrow allow rules.

**IAM** decides whether the caller may perform a Google API action. Private Google Access does not grant permission to read a bucket or secret. PSC to Google APIs also leaves API permissions intact. Service accounts, roles, service perimeters, and resource policies remain part of the request.

**Service setup** decides whether the managed service accepts the connection. Cloud SQL needs private IP configured on the selected network, database users or IAM database authentication, SSL settings where required, and connection limits. A producer PSC service needs a healthy backend and accepted consumer connection.

Keeping these layers separate makes incidents faster. A route can be correct while IAM blocks Secret Manager. DNS can point to the wrong endpoint while Cloud SQL is healthy. A producer service can reject the consumer while the PSC forwarding rule exists.

A practical incident review can walk through failed requests like this:

| Failed request | Symptom | What the symptom says |
|---|---|---|
| Report worker calls Secret Manager | `Permission 'secretmanager.versions.access' denied` | DNS, route, and firewall were good enough to reach the API control plane; IAM or service perimeter policy blocked the action |
| API connects to Cloud SQL private IP | TCP timeout to `10.80.4.7:5432` | The client had a destination address, so check Private Services Access peering routes, egress firewall, database private IP setup, and database-side limits |
| Worker calls a PSC endpoint for Google APIs | `secretmanager.googleapis.com` resolves to a public IP or an old private IP | DNS is sending the client away from the intended PSC endpoint before route or IAM checks can help |

Here is the same review as a layer map:

| Layer | Secret Manager failure | Cloud SQL failure | PSC to Google APIs failure |
|---|---|---|---|
| DNS | `secretmanager.googleapis.com` should resolve to the intended private or PSC path | Client may use a direct private IP, a Cloud SQL connector, or a configured private address | Default API names or `SERVICE-ENDPOINT.p.googleapis.com` names must resolve to the PSC endpoint IP |
| Route | Source subnet needs a path to the Google API VIP or PSC endpoint | VPC needs the Private Services Access peering route to the producer range | Source VPC needs a local route to the endpoint address |
| Firewall | Egress TCP `443` must be allowed | Egress TCP `5432` from API to database private IP must be allowed | Egress TCP `443` to the endpoint IP must be allowed |
| IAM | Caller needs `secretmanager.versions.access` through a role such as Secret Manager Secret Accessor | Database auth uses database users, IAM database auth, or connector identity depending on the client | Caller still needs permission for the Google API action |
| Service setup | Secret Manager API and the target secret version must exist | Cloud SQL needs private IP on the selected network and a healthy instance | PSC forwarding rule, endpoint DNS, API enablement, and supported API bundle must line up |

The important habit is to name the first failing layer with evidence. A `403` from Secret Manager is an authorization failure after network reachability. A Cloud SQL timeout is usually lower in the stack. A DNS answer that points away from the endpoint should be fixed before the team changes firewall rules.

## Commands and Terraform Shapes
<!-- section-summary: Each private access pattern has a different setup shape and verification target. -->

The examples use host project `net-learn-prod`, VPC `learn-shared-vpc`, subnet `apps-us-central1`, and workload project `app-learn-prod`. The exact names can change, but the resource relationships stay the same.

For **Private Google Access**, enable the subnet setting and verify it:

```bash
gcloud compute networks subnets update apps-us-central1 \
  --project=net-learn-prod \
  --region=us-central1 \
  --enable-private-ip-google-access

gcloud compute networks subnets describe apps-us-central1 \
  --project=net-learn-prod \
  --region=us-central1 \
  --format='yaml(name,privateIpGoogleAccess,ipCidrRange)'
```

Important fields:

- `--enable-private-ip-google-access` enables API reachability for internal-IP VMs in that subnet.
- The describe command should be used as evidence before changing application code.
- The source VM still needs IAM permission for each API action.

Healthy output:

```yaml
name: apps-us-central1
privateIpGoogleAccess: true
ipCidrRange: 10.40.10.0/24
```

Terraform shape:

```hcl
resource "google_compute_subnetwork" "apps_us_central1" {
  project                  = var.host_project_id
  name                     = "apps-us-central1"
  region                   = "us-central1"
  ip_cidr_range            = "10.40.10.0/24"
  network                  = google_compute_network.learn_shared.id
  private_ip_google_access = true
}
```

For **Private Services Access**, reserve a producer range and connect it to Service Networking:

```bash
gcloud services enable servicenetworking.googleapis.com \
  --project=net-learn-prod

gcloud compute addresses create google-managed-services-learn \
  --project=net-learn-prod \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=16 \
  --description="Peering range for Google managed services" \
  --network=learn-shared-vpc

gcloud services vpc-peerings connect \
  --project=net-learn-prod \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-learn \
  --network=learn-shared-vpc

gcloud services vpc-peerings list \
  --project=net-learn-prod \
  --network=learn-shared-vpc
```

Important fields:

- `--purpose=VPC_PEERING` marks the range for producer peering.
- `--prefix-length=16` reserves enough room for managed service producer addresses in this example.
- `--service=servicenetworking.googleapis.com` creates the private services connection.

Healthy output:

```console
NETWORK           PEERING                          RESERVED_PEERING_RANGES       STATE
learn-shared-vpc  servicenetworking-googleapis-com  google-managed-services-learn  ACTIVE
```

Terraform shape:

```hcl
resource "google_compute_global_address" "private_services_range" {
  project       = var.host_project_id
  name          = "google-managed-services-learn"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.learn_shared.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.learn_shared.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services_range.name]
}
```

Cloud SQL private IP then points at that network:

```hcl
resource "google_sql_database_instance" "learn_postgres" {
  project          = var.app_project_id
  name             = "learn-postgres-prod"
  region           = "us-central1"
  database_version = "POSTGRES_16"

  settings {
    tier = "db-custom-2-8192"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.learn_shared.id
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}
```

For **Private Service Connect to Google APIs**, create a private endpoint address and forwarding rule:

```bash
gcloud compute addresses create psc-googleapis \
  --project=net-learn-prod \
  --global \
  --purpose=PRIVATE_SERVICE_CONNECT \
  --addresses=10.40.30.25 \
  --network=learn-shared-vpc

gcloud compute forwarding-rules create psc-googleapis \
  --project=net-learn-prod \
  --global \
  --network=learn-shared-vpc \
  --address=psc-googleapis \
  --target-google-apis-bundle=all-apis

gcloud compute forwarding-rules describe psc-googleapis \
  --project=net-learn-prod \
  --global \
  --format='yaml(name,IPAddress,target,network)'
```

Important fields:

- `--purpose=PRIVATE_SERVICE_CONNECT` reserves the address for PSC.
- `--target-google-apis-bundle=all-apis` forwards the endpoint to supported Google APIs.
- DNS must point the intended API names or service names at the endpoint pattern your design uses.

Healthy output:

```yaml
IPAddress: 10.40.30.25
name: psc-googleapis
network: https://www.googleapis.com/compute/v1/projects/net-learn-prod/global/networks/learn-shared-vpc
target: all-apis
```

The endpoint is only half of PSC to Google APIs. The client also needs DNS that resolves the API hostname to the endpoint IP. For clients that keep using default Google API names such as `secretmanager.googleapis.com`, create a private `googleapis.com` zone and point the zone apex at the endpoint. The wildcard CNAME then sends service hostnames to that same endpoint address:

```bash
gcloud dns managed-zones create googleapis-private \
  --project=net-learn-prod \
  --description="Private DNS for PSC to Google APIs" \
  --dns-name=googleapis.com. \
  --visibility=private \
  --networks=learn-shared-vpc

gcloud dns record-sets transaction start \
  --project=net-learn-prod \
  --zone=googleapis-private

gcloud dns record-sets transaction add 10.40.30.25 \
  --project=net-learn-prod \
  --zone=googleapis-private \
  --name=googleapis.com. \
  --type=A \
  --ttl=300

gcloud dns record-sets transaction add googleapis.com. \
  --project=net-learn-prod \
  --zone=googleapis-private \
  --name="*.googleapis.com." \
  --type=CNAME \
  --ttl=300

gcloud dns record-sets transaction execute \
  --project=net-learn-prod \
  --zone=googleapis-private
```

Important fields:

- `--dns-name=googleapis.com.` creates a private zone for the default API domain.
- The `A` record points the zone name at the PSC endpoint IP `10.40.30.25`.
- The wildcard `CNAME` sends names such as `secretmanager.googleapis.com` to the zone apex.
- The zone must attach to the VPC where the source workloads resolve names.

Terraform shape:

```hcl
resource "google_dns_managed_zone" "googleapis_private" {
  project     = var.host_project_id
  name        = "googleapis-private"
  dns_name    = "googleapis.com."
  visibility  = "private"
  description = "Private DNS for PSC to Google APIs"

  private_visibility_config {
    networks {
      network_url = google_compute_network.learn_shared.id
    }
  }
}

resource "google_dns_record_set" "googleapis_apex" {
  project      = var.host_project_id
  managed_zone = google_dns_managed_zone.googleapis_private.name
  name         = "googleapis.com."
  type         = "A"
  ttl          = 300
  rrdatas      = ["10.40.30.25"]
}

resource "google_dns_record_set" "googleapis_wildcard" {
  project      = var.host_project_id
  managed_zone = google_dns_managed_zone.googleapis_private.name
  name         = "*.googleapis.com."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["googleapis.com."]
}
```

After DNS is in place, the verification target is simple: from a VM or workload path that uses the shared VPC resolver, `secretmanager.googleapis.com` should answer with `10.40.30.25`. Then a Secret Manager API call should either succeed or return an IAM/service error, not a public-routing surprise.

## Verification Runbook
<!-- section-summary: Private access debugging checks source, DNS, routes, firewall, IAM, and service-specific setup in order. -->

For Private Google Access, verify the subnet setting and then inspect API errors:

The runbook should follow the destination type first. A Secret Manager failure uses the subnet and Google API path before the IAM check. A Cloud SQL private IP failure uses the private services connection, route, firewall, and database settings. A PSC endpoint failure uses endpoint DNS and the forwarding rule. Jumping straight to IAM or firewall for every private failure wastes time because each pattern has a different first layer.

The goal is to collect one clear fact at each layer before changing anything. A DNS answer, route list, subnet setting, firewall log, IAM policy check, and service health check are all stronger than guessing from an application timeout.

```bash
gcloud compute networks subnets describe apps-us-central1 \
  --project=net-learn-prod \
  --region=us-central1 \
  --format='yaml(name,privateIpGoogleAccess,ipCidrRange)'

dig storage.googleapis.com A

gcloud storage buckets list \
  --project=app-learn-prod \
  --format='table(name,location)'

gcloud logging read \
  'protoPayload.serviceName="secretmanager.googleapis.com"
   severity>=ERROR' \
  --project=app-learn-prod \
  --limit=20 \
  --format='table(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.status.message)'
```

Example output:

```yaml
name: apps-us-central1
privateIpGoogleAccess: true
ipCidrRange: 10.40.10.0/24
```

```console
;; ANSWER SECTION:
storage.googleapis.com. 300 IN A 199.36.153.8
storage.googleapis.com. 300 IN A 199.36.153.9
storage.googleapis.com. 300 IN A 199.36.153.10
storage.googleapis.com. 300 IN A 199.36.153.11
```

```console
NAME                    LOCATION
learn-export-prod-us    US
learn-reporting-prod    US
```

```console
TIMESTAMP              PRINCIPAL_EMAIL                                         STATUS_MESSAGE
2026-06-14T09:12:41Z   report-worker@app-learn-prod.iam.gserviceaccount.com    Permission 'secretmanager.versions.access' denied
```

Interpret the checks in order. `privateIpGoogleAccess: true` proves the subnet setting is enabled for internal-IP VMs. The DNS answer should match the Google API VIP path your design uses. The successful Cloud Storage list proves the VM can reach a Google API and pass IAM for that API action. The Secret Manager denial points at IAM or service perimeter review, because the request reached the API control plane and received an authorization decision.

For Private Services Access, verify the allocated range, peering connection, Cloud SQL private address, and database settings:

```bash
gcloud compute addresses list \
  --project=net-learn-prod \
  --global \
  --filter='purpose=VPC_PEERING' \
  --format='table(name,address,prefixLength,status)'

gcloud services vpc-peerings list \
  --project=net-learn-prod \
  --network=learn-shared-vpc

gcloud sql instances describe learn-postgres-prod \
  --project=app-learn-prod \
  --format='yaml(name,region,ipAddresses,settings.ipConfiguration)'
```

Healthy output should show a reserved range, active peering, and a private database address:

```console
NAME                            ADDRESS     PREFIX_LENGTH  STATUS
google-managed-services-learn   10.80.0.0   16             RESERVED
```

```yaml
name: learn-postgres-prod
region: us-central1
ipAddresses:
- ipAddress: 10.80.4.7
  type: PRIVATE
settings:
  ipConfiguration:
    ipv4Enabled: false
    privateNetwork: projects/net-learn-prod/global/networks/learn-shared-vpc
```

For Private Service Connect, verify the endpoint, DNS answer, and egress firewall:

```bash
gcloud compute forwarding-rules list \
  --project=net-learn-prod \
  --global \
  --filter='target:(all-apis OR vpc-sc)' \
  --format='table(name,IPAddress,target,network)'

gcloud compute forwarding-rules describe psc-googleapis \
  --project=net-learn-prod \
  --global \
  --format=yaml

dig secretmanager.googleapis.com A

gcloud compute firewall-rules list \
  --project=net-learn-prod \
  --filter='network~learn-shared-vpc AND direction=EGRESS' \
  --format='table(name,priority,disabled,allowed[].map().firewall_rule().list(),denied[].map().firewall_rule().list(),destinationRanges.list(),targetServiceAccounts.list())'
```

Healthy output:

```console
NAME            IP_ADDRESS    TARGET    NETWORK
psc-googleapis  10.40.30.25   all-apis  learn-shared-vpc
```

```console
;; ANSWER SECTION:
secretmanager.googleapis.com. 300 IN CNAME googleapis.com.
googleapis.com.               300 IN A     10.40.30.25
```

```console
NAME                         PRIORITY  DISABLED  ALLOW    DENY  DESTINATION_RANGES  TARGET_SERVICE_ACCOUNTS
allow-apps-to-psc-googleapis 710       False     tcp:443        10.40.30.25/32      report-worker@app-learn-prod.iam.gserviceaccount.com
deny-apps-egress-all         65000     False              all   0.0.0.0/0           report-worker@app-learn-prod.iam.gserviceaccount.com
```

If DNS resolves to an old public address while the PSC endpoint exists, fix DNS before changing routes. If DNS resolves to the endpoint and traffic times out, check egress firewall policy and endpoint state next.

## Choosing the Right Pattern
<!-- section-summary: The destination type tells you which private access pattern to inspect first. -->

The destination gives the first clue. If a private VM needs `storage.googleapis.com` or `secretmanager.googleapis.com`, inspect Private Google Access, DNS for Google APIs, egress firewall policy, and IAM. If the app needs Cloud SQL private IP, inspect Private Services Access, allocated producer ranges, peering state, database private IP, and database authentication. If the consumer needs a local endpoint for Google APIs or one producer service, inspect Private Service Connect, endpoint state, DNS, egress firewall, and producer acceptance.

| Question | Usually points toward | Reason |
|---|---|---|
| Does an internal-IP VM need Google APIs? | Private Google Access | The destination is a Google API endpoint |
| Does the app need Cloud SQL private IP? | Private Services Access | Cloud SQL private IP uses a service producer network pattern |
| Does the consumer need an internal endpoint for Google APIs? | Private Service Connect | PSC can provide consumer-side private API endpoints |
| Does another team publish one private service? | Private Service Connect | PSC exposes a service without broad VPC route sharing |
| Do overlapping CIDR ranges make peering painful? | Private Service Connect or redesign | Endpoint-based access reduces broad routing pressure |

One environment can use all three patterns. The report worker can use Private Google Access for Secret Manager, Private Services Access for Cloud SQL private IP, and Private Service Connect for the fraud-scoring service. The safe operating habit is to write down which destination uses which pattern and then test the matching evidence.

## References

- [Private access options for services](https://docs.cloud.google.com/vpc/docs/private-access-options) - Compares private connectivity options for Google APIs, VPC-hosted services, serverless workloads, and producer services.
- [Private Google Access](https://docs.cloud.google.com/vpc/docs/private-google-access) - Explains subnet-level access from internal-IP VMs to Google APIs and services.
- [Configure Private Google Access](https://docs.cloud.google.com/vpc/docs/configure-private-google-access) - Shows subnet update commands, verification commands, DNS options, and Terraform subnetwork settings.
- [Private services access](https://docs.cloud.google.com/vpc/docs/private-services-access) - Defines private services access, service producer networks, VPC Network Peering, and supported services.
- [Configure private services access](https://docs.cloud.google.com/vpc/docs/configure-private-services-access) - Documents allocated ranges, private connections, permissions, and setup prerequisites.
- [Private Service Connect](https://docs.cloud.google.com/vpc/docs/private-service-connect) - Describes PSC endpoints, backends, producer services, and service-oriented private access.
- [Access Google APIs through endpoints](https://docs.cloud.google.com/vpc/docs/configure-private-service-connect-apis) - Documents PSC endpoints for Google APIs, DNS requirements, API enablement, and endpoint prerequisites.
- [Cloud SQL private IP](https://docs.cloud.google.com/sql/docs/postgres/private-ip) - Explains Cloud SQL private IP, private services access, VPC peering behavior, and private IP considerations.

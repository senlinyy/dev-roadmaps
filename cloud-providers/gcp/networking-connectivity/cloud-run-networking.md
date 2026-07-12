---
title: "Cloud Run Networking"
description: "Understand Cloud Run ingress, IAM invocation, egress, Direct VPC egress, Serverless VPC Access connectors, DNS, firewall evidence, and startup debugging."
overview: "Cloud Run networking has an inbound side for callers and an outbound side for dependencies. The example follows a learning API that receives traffic through a load balancer and reaches private services through a deliberate egress path."
tags: ["gcp", "cloud-run", "ingress", "egress", "vpc"]
order: 4
id: article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress
aliases:
  - cloud-run-networking-and-private-egress
  - cloud-providers/gcp/networking-connectivity/cloud-run-networking-and-private-egress.md
---

## Table of Contents

1. [Two Sides of Cloud Run Networking](#two-sides-of-cloud-run-networking)
2. [Ingress](#ingress)
3. [IAM Invocation](#iam-invocation)
4. [Egress](#egress)
5. [Direct VPC Egress](#direct-vpc-egress)
6. [Serverless VPC Access](#serverless-vpc-access)
7. [DNS and Firewall Evidence](#dns-and-firewall-evidence)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Two Sides of Cloud Run Networking
<!-- section-summary: Cloud Run already runs the service, and networking decides who can call it and where it can call out. -->

Cloud Run already gives your container a managed compute service. It can run a web API, scale instances, serve requests, record logs, and create revisions for each deploy. Networking answers two different questions around that running service.

The first question is inbound: who can call the Cloud Run service, and through which network path? The second question is outbound: where can the container send traffic during calls to a private cache, database endpoint, Google API, or public payment provider?

For the learning platform, public users call `https://learn.example.com/api/courses` through an external Application Load Balancer. The Cloud Run service is `learn-api`. It should reject random direct internet calls to the generated `run.app` URL, and it should reach a private cache at `10.60.3.15:6379` through the VPC.

These three controls stay separate:

| Question | Cloud Run control | Example decision |
|---|---|---|
| Which network paths can reach the service? | **Ingress** | Public traffic arrives through the load balancer |
| Which identities can invoke it? | **IAM invocation** | Anonymous users or selected callers need an intentional policy |
| How does the container reach dependencies? | **Egress** | Private cache calls use VPC egress |

![A generated infographic showing Cloud Run inbound ingress and IAM invocation as two separate request gates.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/ingress-iam-gates.png)
*Inbound access has a network gate and an identity gate, and outbound dependency calls have a separate path.*

## Ingress
<!-- section-summary: Ingress controls which network paths Cloud Run accepts before IAM finishes the request decision. -->

**Ingress** is the inbound network filter for a Cloud Run service. It decides which network paths can reach the service endpoint. Cloud Run supports settings for broad public reachability, internal reachability, and external load balancer reachability combined with internal paths.

Think of ingress as the service's network doorway. It answers a different question from application login. Application login asks whether the user is allowed to use a feature. Cloud Run ingress asks whether this network path may even reach the service endpoint. A request can fail at the doorway before the app code sees it.

For the learning API, the intended doorway is the external Application Load Balancer. That keeps `https://learn.example.com/api/courses` as the public path and reduces accidental reliance on the generated `run.app` URL. The generated URL still exists for the service resource, but ingress controls whether direct public callers can use it.

The setting you choose should match the supported entry path. If users should enter through `learn.example.com` and the external Application Load Balancer, `internal-and-cloud-load-balancing` is a common production choice. It lets external load balancer traffic reach the service while rejecting direct public calls to the generated `run.app` URL.

A deployment can set the ingress value:

```bash
gcloud run deploy learn-api \
  --project=learn-prod \
  --image=us-docker.pkg.dev/learn-prod/apps/learn-api:2026-06-14 \
  --region=us-central1 \
  --ingress=internal-and-cloud-load-balancing
```

Important fields:

- `--ingress=internal-and-cloud-load-balancing` keeps the external Application Load Balancer as the public path.
- `--region=us-central1` must match the region used by the Cloud Run service and serverless NEG.
- The generated service URL can still appear in output, but direct public access depends on ingress and IAM settings.

Example deploy output:

```yaml
Service [learn-api] revision [learn-api-00042-web] has been deployed and is serving 100 percent of traffic.
URL: https://learn-api-abc123-uc.a.run.app
```

Ingress is network reachability. It does not replace caller identity. The next check is IAM invocation.

## IAM Invocation
<!-- section-summary: IAM invocation decides which identities may call the service after the network path reaches Cloud Run. -->

**IAM invocation** is the identity gate for Cloud Run requests. Cloud Run services are secured by IAM by default. A caller needs permission to invoke the service unless the service intentionally allows unauthenticated invocation.

This is separate from ingress. A request can reach the service through an allowed network path and still receive a `403` if the caller lacks permission. Another service can allow unauthenticated invocation and still restrict direct internet access through the ingress setting.

For the learning API, the team needs to write down where user authentication happens. If the public API uses application sessions or an API gateway layer, the Cloud Run service may allow unauthenticated invocation from the load balancer path while relying on application-level auth for users. If only internal automation should call the service, the callers should have identities with `roles/run.invoker`.

Useful review combinations:

| Ingress setting | IAM posture | Practical meaning |
|---|---|---|
| All | Unauthenticated allowed | Direct public service URL can invoke the service |
| All | Authenticated callers only | Public network path exists, and caller identity is still checked |
| Internal and Cloud Load Balancing | Unauthenticated allowed | Public users enter through load balancer, direct public service URL is blocked by ingress |
| Internal and Cloud Load Balancing | Authenticated callers only | Load balancer path exists, and Cloud Run still requires an accepted caller identity |
| Internal | Authenticated callers only | Internal callers need both internal reachability and IAM permission |

The important production statement should be explicit: "The service uses `internal-and-cloud-load-balancing` ingress, direct public `run.app` access is blocked, and invocation is intentionally unauthenticated because user auth happens in the application." Another service may use the same ingress setting and require IAM invocation for every caller.

Verification should describe both controls:

```bash
gcloud run services describe learn-api \
  --project=learn-prod \
  --region=us-central1 \
  --format="yaml(metadata.annotations['run.googleapis.com/ingress'],status.url)"

gcloud run services get-iam-policy learn-api \
  --project=learn-prod \
  --region=us-central1
```

Healthy output should match the service design:

```yaml
metadata:
  annotations:
    run.googleapis.com/ingress: internal-and-cloud-load-balancing
status:
  url: https://learn-api-abc123-uc.a.run.app
```

The IAM policy then tells you who can invoke the service. A public service that still uses the Cloud Run Invoker IAM check might show `allUsers` on `roles/run.invoker`:

```yaml
bindings:
- members:
  - allUsers
  role: roles/run.invoker
etag: BwYJ9example=
version: 1
```

`allUsers` means any internet caller can pass the IAM invocation gate after the network path reaches Cloud Run. That can be valid for a public API if user authentication happens inside the application or at the load balancer layer. The team should still write that decision down because it is a deliberate public access grant.

An internal caller policy should name the calling service account instead:

```yaml
bindings:
- members:
  - serviceAccount:course-worker@app-course-prod.iam.gserviceaccount.com
  role: roles/run.invoker
etag: BwYJ8example=
version: 1
```

`roles/run.invoker` grants the permission to invoke the receiving Cloud Run service. It does not grant permission to deploy revisions, edit environment variables, change ingress, or read secrets. For service-to-service calls, the caller also needs to send an identity token for the receiving service URL or audience, otherwise the request reaches Cloud Run and fails authorization.

The error shape helps separate network blocks from IAM blocks. A direct public request to a service with `internal-and-cloud-load-balancing` ingress should fail before application handling, often as `HTTP/2 404`. A request that reaches Cloud Run but lacks an accepted identity usually returns `HTTP/2 403` with an authentication or permission message. A timeout to a private dependency points at egress, DNS, route, firewall, or service health instead of Cloud Run invocation.

## Egress
<!-- section-summary: Egress controls outbound traffic from the Cloud Run container to dependencies. -->

**Egress** is outbound traffic from the Cloud Run container. Your code starts these connections as it calls another service. The destination might be a private cache, a private database endpoint, a Google API, a public SaaS API, or an internal load balancer.

Egress has its own design because inbound success proves only that users can reach your service. A healthy request to `/healthz` through the load balancer does not prove that the container can reach Redis, Cloud SQL, or Secret Manager. Dependency calls need separate DNS, route, firewall, IAM, and service evidence.

Cloud Run has two main VPC egress paths:

| Egress path | Plain meaning | Typical use |
|---|---|---|
| Direct VPC egress | Cloud Run sends outbound traffic directly into a VPC subnet | New services that need private VPC destinations |
| Serverless VPC Access connector | Cloud Run sends outbound traffic through a connector resource | Existing services and connector-based designs |

The egress routing mode also matters. `private-ranges-only` sends private destination ranges through the VPC and keeps other traffic on Cloud Run's normal internet path. `all-traffic` sends all outbound traffic through the VPC, which often pairs with Cloud NAT for public internet calls that need a stable outbound path.

## Direct VPC Egress
<!-- section-summary: Direct VPC egress sends Cloud Run outbound traffic into a VPC without a connector resource. -->

**Direct VPC egress** lets Cloud Run send outbound traffic to a VPC network without a Serverless VPC Access connector. Google Cloud recommends Direct VPC egress for many Cloud Run VPC egress designs because it has simpler setup, lower latency, higher throughput, no connector VM charges, and revision-level network tags.

For the learning API, Direct VPC egress is useful for service calls to the private cache at `10.60.3.15:6379` or an internal API behind an internal load balancer. The service chooses a VPC network, subnet, optional network tags, and an egress mode.

```bash
gcloud run deploy learn-api \
  --project=learn-prod \
  --image=us-docker.pkg.dev/learn-prod/apps/learn-api:2026-06-14 \
  --region=us-central1 \
  --network=learn-prod-vpc \
  --subnet=run-egress-us-central1 \
  --network-tags=learn-api \
  --vpc-egress=private-ranges-only
```

Important fields:

- `--network` and `--subnet` choose where outbound VPC traffic enters the network.
- `--network-tags=learn-api` gives firewall rules a precise target for this Cloud Run revision.
- `--vpc-egress=private-ranges-only` sends private ranges through the VPC while leaving ordinary public API calls on the default path.
- The selected subnet needs enough free IP space for Cloud Run scale and revision behavior.

Subnet size is not a cosmetic detail. Direct VPC egress allocates ephemeral IP addresses from the subnet, and Cloud Run can reserve addresses during scale-up and revision replacement. Do not write firewall policy for one individual Cloud Run IP. Use the subnet range, network tags, service identity, and destination rules that describe the workload path.

In Shared VPC or centrally owned networks, the deploy can fail before the application starts if the Cloud Run service agent or deployment identity cannot use the chosen network or subnet. Keep that permission check separate from application IAM. A service can have Secret Manager access and still fail deployment because the network project rejected the subnet attachment.

Startup also deserves its own check. If the app tries to connect to a private dependency during startup, a DNS or firewall problem can make the revision look unhealthy before it serves traffic. Use a startup probe or a clear dependency log so the failure says `cache.internal.example.com:6379 timed out` instead of only saying the container failed to start.

Example output:

```yaml
Service [learn-api] revision [learn-api-00043-vpc] has been deployed and is serving 100 percent of traffic.
Traffic:
  learn-api-00043-vpc: 100%
```

![A generated infographic showing Cloud Run egress choices for public APIs, private VPC targets, Direct VPC egress, and connector paths.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/egress-route-choice.png)
*Outbound design follows the destination: public APIs, private VPC targets, and centrally routed traffic can use different paths.*

Direct VPC egress affects outbound connections. Inbound calls to Cloud Run still use ingress settings, service URLs, load balancer paths, and IAM invocation.

## Serverless VPC Access
<!-- section-summary: Serverless VPC Access connectors provide another VPC egress path and still appear in many existing systems. -->

A **Serverless VPC Access connector** is a managed connector resource that lets serverless products send outbound traffic to a VPC network. Many production services use connectors because they were built before Direct VPC egress was available or because the organization already has connector capacity, monitoring, and firewall rules.

The connector path adds a separate resource to operate. It has its own scaling behavior, IP range, capacity, and firewall boundary. With connectors, firewall rules usually allow traffic from connector ranges or connector instances. With Direct VPC egress, firewall rules can use Cloud Run revision network tags.

Create and inspect the connector before wiring a service to it:

```bash
gcloud compute networks vpc-access connectors create learn-api-connector \
  --project=learn-prod \
  --region=us-central1 \
  --network=learn-prod-vpc \
  --range=10.60.12.0/28 \
  --min-instances=2 \
  --max-instances=6 \
  --machine-type=e2-micro

gcloud compute networks vpc-access connectors describe learn-api-connector \
  --project=learn-prod \
  --region=us-central1 \
  --format="yaml(name,state,network,ipCidrRange,minInstances,maxInstances,machineType)"
```

Healthy evidence:

```yaml
name: learn-api-connector
state: READY
network: learn-prod-vpc
ipCidrRange: 10.60.12.0/28
minInstances: 2
maxInstances: 6
machineType: e2-micro
```

The IP range is connector capacity and firewall evidence, not an application subnet for Cloud Run instances. A `/28` gives the connector a small dedicated range, so it should be reserved away from VM subnets, GKE secondary ranges, Private Services Access ranges, and hybrid networks. If connector throughput or connection count grows, the team reviews connector sizing and scale settings instead of only changing the Cloud Run container.

Firewall targeting differs from Direct VPC egress. With Direct VPC egress, the Cloud Run revision can carry a network tag such as `learn-api`, and egress rules can target that tag. With a connector, VPC resources usually see traffic from the connector range or connector instances, so allow rules often use source range `10.60.12.0/28`, connector-created tags where the organization relies on them, or destination VM targets. The firewall review should name which pattern the environment uses.

Connector-style deployment looks like this:

```bash
gcloud run deploy learn-api \
  --project=learn-prod \
  --image=us-docker.pkg.dev/learn-prod/apps/learn-api:2026-06-14 \
  --region=us-central1 \
  --vpc-connector=learn-api-connector \
  --vpc-egress=private-ranges-only
```

Important fields:

- `--vpc-connector` selects the connector resource that carries outbound traffic.
- `--vpc-egress` still decides whether private ranges or all outbound traffic use the connector.
- Existing firewall rules may target the connector range rather than a Cloud Run network tag.

For AWS readers, the broad idea is close to Lambda VPC configuration or App Runner VPC connectors: the managed runtime needs an explicit path into private networking. The differences matter in details. GCP separates Cloud Run ingress, IAM invocation, Direct VPC egress, connector egress, and firewall targeting. AWS security groups, private subnets, and IAM authorization follow their own service-specific rules.

## DNS and Firewall Evidence
<!-- section-summary: DNS answers, egress mode, firewall targets, and logs prove whether outbound Cloud Run traffic follows the intended path. -->

DNS decides which IP address the container tries to reach. The egress mode then decides whether traffic to that IP range uses the VPC. If `cache.internal.example.com` resolves to `10.60.3.15`, `private-ranges-only` sends the connection through the VPC. If `api.payment.example` resolves to a public IP, `private-ranges-only` keeps it on the normal Cloud Run outbound path.

Google APIs need careful DNS design. Names such as `storage.googleapis.com` resolve through public Google API names by default. If the service needs private access to Google APIs through a VPC path, the team must pair the egress setting with Private Google Access and DNS that maps the API names to the documented private or restricted Google API VIPs.

Firewall rules decide whether the VPC path allows the packet. With Direct VPC egress, a rule can use the Cloud Run revision tag:

```bash
gcloud compute firewall-rules create allow-learn-api-to-cache \
  --project=learn-prod \
  --network=learn-prod-vpc \
  --direction=EGRESS \
  --priority=900 \
  --allow=tcp:6379 \
  --destination-ranges=10.60.3.15/32 \
  --target-tags=learn-api
```

Important fields:

- `--direction=EGRESS` applies to packets leaving the tagged revision through VPC egress.
- `--destination-ranges=10.60.3.15/32` names the private cache endpoint in this example.
- `--target-tags=learn-api` must match the Cloud Run network tag set on the revision.

Cloud Run Direct VPC egress has an evidence caveat that trips people up. Firewall Rules Logging is not supported for Direct VPC egress, and VPC Flow Logs do not identify the exact Cloud Run revision name. Keep the firewall rule as configuration evidence, then combine it with revision settings, subnet capacity, DNS results, Connectivity Tests, Flow Analyzer or VPC Flow Logs where available, and dependency logs from the application.

Useful debug evidence includes:

| Evidence | Why it matters |
|---|---|
| Cloud Run revision settings | Confirms ingress, network, subnet, tags, and egress mode |
| Subnet capacity | Catches address exhaustion during scale-up |
| DNS lookup from a similar runtime path | Shows whether the target name resolves to private or public ranges |
| Firewall rule target | Shows whether the revision tag, connector range, or subnet path is allowed |
| Connectivity Tests or Flow Analyzer | Helps prove the network path without relying on unsupported Direct VPC firewall logs |
| Cloud Run request logs | Separates inbound delivery from application errors |
| Startup logs for dependencies | Shows which private dependency failed and the failure time |
| VPC Flow Logs where enabled | Gives packet-level evidence for VPC egress traffic, although not the exact Cloud Run revision name |

![A generated infographic separating Cloud Run 403 IAM failures, blocked ingress, private IP timeouts, and DNS answer checks.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/cloud-run-debug-sides.png)
*A `403`, a blocked direct URL, and a private dependency timeout point to different sides of Cloud Run networking.*

Application logs should include dependency names, hostnames, ports, timeout length, and sanitized error codes. They should avoid secrets, tokens, passwords, and full connection strings. A message such as `cache dependency check failed for cache.internal.example.com:6379 after 3000ms` gives the network team a useful starting point.

## Putting It Together
<!-- section-summary: A production Cloud Run service states ingress, invocation, egress, DNS, firewall, and evidence decisions clearly. -->

The learning API now has a clear network statement. Public users call `https://learn.example.com`. DNS points that name to the external Application Load Balancer. The load balancer handles HTTPS, URL map routing, and the serverless NEG handoff. Cloud Run ingress uses `internal-and-cloud-load-balancing`, so the supported public path is the load balancer path.

The invocation policy is written down separately. If unauthenticated invocation is allowed, the team states where user authentication happens. If IAM invocation is required, the callers and `roles/run.invoker` bindings are part of the release review.

Outbound traffic uses Direct VPC egress through `learn-prod-vpc` and subnet `run-egress-us-central1`. The revision tag `learn-api` lets the firewall allow TCP `6379` to the private cache endpoint. The service uses `private-ranges-only` because private dependencies should use the VPC, while ordinary public API calls can use the default Cloud Run outbound path. If a vendor requires a static outbound IP, the team can evaluate `all-traffic` with Cloud NAT.

The final review table gives on-call engineers concrete checks:

| Area | Decision |
|---|---|
| Public entry | `learn.example.com` through external Application Load Balancer |
| Direct service URL | Blocked from direct public access by Cloud Run ingress |
| Invocation | Authenticated or unauthenticated policy documented |
| VPC egress | Direct VPC egress through `learn-prod-vpc/run-egress-us-central1` |
| Routing mode | `private-ranges-only` for private dependencies |
| Firewall | Egress allowed from revision tag `learn-api` to required private ranges and ports |
| DNS | Internal names resolve to private ranges; Google API private access has matching DNS if used |
| Evidence | DNS, certificate, load balancer logs, Cloud Run logs, revision settings, firewall rule configuration, Connectivity Tests or Flow Analyzer, dependency checks |

## References

- [Restrict network ingress for Cloud Run services](https://docs.cloud.google.com/run/docs/securing/ingress) - Documents Cloud Run ingress paths and ingress settings.
- [Cloud Run authentication overview](https://docs.cloud.google.com/run/docs/authenticating/overview) - Explains IAM-secured invocation, Cloud Run Invoker access, and unauthenticated access options.
- [Direct VPC with a VPC network](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc) - Documents Direct VPC egress, network and subnet selection, revision-level tags, and routing settings.
- [Connect to a VPC network](https://docs.cloud.google.com/run/docs/configuring/connecting-vpc) - Compares Direct VPC egress and Serverless VPC Access connectors.
- [Private networking and Cloud Run](https://docs.cloud.google.com/run/docs/securing/private-networking) - Explains private request paths and VPC routing patterns for Cloud Run.
- [Best practices for Cloud Run networking](https://docs.cloud.google.com/run/docs/configuring/networking-best-practices) - Covers egress routing, Cloud NAT, Private Google Access, DNS, and connection practices.
- [Private Google Access](https://docs.cloud.google.com/vpc/docs/private-google-access) - Explains private access from internal-IP resources to Google APIs and services.

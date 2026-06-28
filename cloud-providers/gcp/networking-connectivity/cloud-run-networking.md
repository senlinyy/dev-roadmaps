---
title: "Cloud Run Networking"
description: "Understand Cloud Run ingress, IAM invocation, Direct VPC egress, Serverless VPC Access connectors, routing modes, DNS behavior, firewall targeting, and startup debugging."
overview: "Cloud Run networking has two separate sides: inbound requests to the service and outbound requests from the container. This article follows the checkout API as it accepts traffic through the load balancer and reaches private dependencies through a deliberate egress path."
tags: ["gcp", "cloud-run", "ingress", "egress", "vpc"]
order: 4
id: article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress
aliases:
  - cloud-run-networking-and-private-egress
  - cloud-providers/gcp/networking-connectivity/cloud-run-networking-and-private-egress.md
---

## Table of Contents

1. [Ingress, Egress, and IAM](#ingress-egress-and-iam)
2. [Public and Authenticated Invocation](#public-and-authenticated-invocation)
3. [Cloud Run Ingress Settings](#cloud-run-ingress-settings)
4. [Direct VPC Egress](#direct-vpc-egress)
5. [Serverless VPC Access Connectors](#serverless-vpc-access-connectors)
6. [Routing Modes and DNS Behavior](#routing-modes-and-dns-behavior)
7. [Firewall Targeting and Debug Evidence](#firewall-targeting-and-debug-evidence)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Ingress, Egress, and IAM
<!-- section-summary: Cloud Run networking has an inbound side, an outbound side, and an IAM gate for invocation. -->

In the previous article, the checkout API received a stable public entry path: `checkout.devpolaris.com` pointed to an external Application Load Balancer, the load balancer used HTTPS, the URL map selected a backend service, and the backend service reached Cloud Run through a serverless NEG. That explains how the public request arrives at the service boundary.

Now we zoom in on the Cloud Run service itself. A Cloud Run service has two network directions, and they answer different questions.

**Ingress** is the inbound side. It controls which network paths can reach the service endpoint. For example, a service might accept requests from the public internet, accept requests only from internal sources, or accept public internet requests only when they arrive through an external Application Load Balancer.

**Egress** is the outbound side. It controls how traffic leaves the container when your code calls another system. For example, the checkout API might call a public payment provider over the internet, a private Memorystore instance through a VPC, or a Google API through private Google access patterns.

**IAM invocation** is the identity gate. Cloud Run services are secured by Identity and Access Management by default. A caller needs permission to invoke the service unless the service allows unauthenticated access. This applies even after the network path is allowed, so a request can pass the ingress setting and still fail IAM.

These three pieces are easiest to read separately:

| Question | Cloud Run control | Example |
|---|---|---|
| Which network paths may reach the service? | **Ingress setting** | Only the external load balancer and internal sources |
| Which identities may call the service? | **IAM / Cloud Run Invoker** | Only the load balancer identity, a scheduler job, or another service |
| How does the service reach dependencies? | **Egress configuration** | Direct VPC egress to a private database subnet |

![A generated infographic showing Cloud Run inbound ingress and IAM invocation as two separate request gates.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/ingress-iam-gates.png)
*Inbound access has a network gate and an identity gate, so a request can reach Cloud Run and still fail authorization.*

For the checkout API, the desired design might be: public users enter through `checkout.devpolaris.com`, direct calls to the generated `run.app` URL fail, authenticated internal jobs can invoke the service, and outbound database calls travel through the VPC. That design uses ingress, IAM, and egress together, but each piece still has its own job. Invocation comes first because public and private access are often confused with authentication.

## Public and Authenticated Invocation
<!-- section-summary: Network reachability and IAM permission are separate gates on Cloud Run requests. -->

A **Cloud Run invocation** is a request that reaches a Cloud Run service endpoint. Cloud Run services require authentication by default. In practical terms, that means the caller needs an identity token and the right permission, commonly the Cloud Run Invoker role, unless the service is configured to allow unauthenticated access.

This is separate from whether the endpoint is reachable on the network. A service can be reachable from the internet and still require IAM. A service can be restricted to load balancer ingress and still allow unauthenticated requests after the load balancer path reaches it. The first choice is network path. The second choice is caller identity.

For a public marketing site, unauthenticated invocation might make sense. The whole point is anonymous users reading pages. For an internal admin API, authenticated invocation is usually required. For the checkout API, teams often put the public identity check at an API gateway, an application session layer, or an Identity-Aware Proxy-supported load balancer path, while the Cloud Run service itself is still protected from random direct calls by ingress settings.

Here are the common combinations:

| Ingress path | IAM setting | What users experience |
|---|---|---|
| All | Allows unauthenticated | Anyone on the internet can call the service URL |
| All | Requires authentication | Internet clients can reach the endpoint, but only authorized callers invoke it successfully |
| Internal and Cloud Load Balancing | Allows unauthenticated | Public users can call through the external load balancer, while direct `run.app` internet calls fail |
| Internal and Cloud Load Balancing | Requires authentication | Public load balancer path exists, and the request still needs an accepted identity at Cloud Run |
| Internal | Requires authentication | Internal callers need both an internal path and IAM permission |

The key production habit is to write down both answers. "This service is private" is too vague for an incident review. A clearer statement is: "The service uses `internal-and-cloud-load-balancing` ingress, direct `run.app` internet requests are blocked, and unauthenticated Cloud Run invocation is disabled."

With invocation separated from reachability, the ingress settings make much more sense. The ingress setting is where the service says which network doors are allowed to reach it.

## Cloud Run Ingress Settings
<!-- section-summary: Ingress settings decide which network entry paths Cloud Run accepts before IAM finishes the access decision. -->

Cloud Run exposes a service through endpoint paths such as the default `run.app` URL, configured domain mappings, and load balancer paths. The **ingress setting** is the service-level network filter applied to those paths.

Cloud Run has three main ingress settings:

| Setting | Plain meaning | Good fit |
|---|---|---|
| **All** | Requests from the internet can reach the service endpoint | Public services that intentionally expose the generated URL or direct domain mapping |
| **Internal** | Only internal sources accepted by Cloud Run can reach the service | Worker APIs, internal automation, and services called from internal Google Cloud paths |
| **Internal and Cloud Load Balancing** | Internal sources plus external Application Load Balancer traffic can reach the service | Public services that should enter through the load balancer instead of the raw service URL |

For our checkout API, `internal-and-cloud-load-balancing` is the usual production fit. Internet traffic arrives through the external Application Load Balancer at `checkout.devpolaris.com`. Direct internet traffic to `https://checkout-api-abc123-uc.a.run.app` is rejected by the Cloud Run ingress gate. Internal jobs can still call the service when they use a path Cloud Run treats as internal and IAM allows the request.

This is the setting that lines up with the previous article's public entry path. The load balancer remains the public contract, and the generated service URL stops acting like an alternate customer endpoint.

A `gcloud` deployment might include the ingress setting like this:

```bash
gcloud run deploy checkout-api \
  --image=us-docker.pkg.dev/devpolaris-prod/apps/checkout-api:2026-06-14 \
  --region=us-central1 \
  --ingress=internal-and-cloud-load-balancing
```

The important flag is `--ingress=internal-and-cloud-load-balancing`. It keeps the generated service URL from acting as a second internet entry path while still allowing the external Application Load Balancer path. A healthy deploy output should name the service URL and finish ready:

```yaml
Service [checkout-api] revision [checkout-api-00042-kvp] has been deployed and is serving 100 percent of traffic.
URL: https://checkout-api-abc123-uc.a.run.app
```

For infrastructure as code, the same intent appears in the Cloud Run service configuration. The exact resource syntax depends on the provider version your repo uses, but the important value is the ingress annotation or field that maps to `internal-and-cloud-load-balancing`.

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: checkout-api
  annotations:
    run.googleapis.com/ingress: internal-and-cloud-load-balancing
spec:
  template:
    spec:
      containers:
        - image: us-docker.pkg.dev/devpolaris-prod/apps/checkout-api:2026-06-14
```

Ingress controls who can reach the service from the outside. The checkout container also has to call other systems. That is the egress side.

## Direct VPC Egress
<!-- section-summary: Direct VPC egress lets Cloud Run send outbound traffic to a VPC without a Serverless VPC Access connector. -->

**Direct VPC egress** lets a Cloud Run service send outbound traffic to a VPC network without using a Serverless VPC Access connector. Google Cloud currently recommends Direct VPC egress for Cloud Run VPC egress because it has simpler setup, lower latency, higher throughput, no extra connector VM charges, and revision-level network tags.

The phrase "outbound traffic" matters. Direct VPC egress handles connections started by the Cloud Run service. Inbound requests from a VPC to Cloud Run still use Cloud Run ingress, service URLs, internal load balancers, Private Service Connect patterns, and IAM.

For the checkout API, Direct VPC egress is useful when the service needs to call a dependency with a private address. Common examples include a private Memorystore cache, a private Compute Engine service, a self-managed database on a VM, or an internal load balancer in the same VPC environment.

The service chooses a VPC network, a subnet, optional network tags, and an egress routing mode. Cloud Run revisions use IP addresses from the selected subnet for VPC egress. That means subnet sizing matters for services with high scale or rapid scale-up. A tiny subnet can run out of usable addresses while the application code looks perfectly healthy.

Here is the shape of a Direct VPC egress deployment:

```bash
gcloud run deploy checkout-api \
  --image=us-docker.pkg.dev/devpolaris-prod/apps/checkout-api:2026-06-14 \
  --region=us-central1 \
  --network=prod-apps \
  --subnet=run-egress-us-central1 \
  --network-tags=checkout-api \
  --vpc-egress=private-ranges-only
```

The `--network` and `--subnet` values choose where egress traffic enters the VPC. The `--network-tags` value gives firewall rules something specific to target. The `--vpc-egress` value decides which destination traffic uses the VPC path.

```yaml
Service [checkout-api] revision [checkout-api-00043-vpc] has been deployed and is serving 100 percent of traffic.
Traffic:
  checkout-api-00043-vpc: 100%
```

![A generated infographic showing Cloud Run egress choices for public APIs, private VPC targets, Direct VPC egress, and connector paths.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/egress-route-choice.png)
*Outbound design starts with the destination: public API calls, private IP calls, and centrally routed traffic can use different egress paths.*

This setup gives the checkout API a VPC-aware outbound path while keeping the inbound story unchanged. Users still enter through the load balancer. The service still uses Cloud Run ingress settings and IAM for invocation. Direct VPC egress only affects packets that leave the service.

There is an older alternate path that many existing systems still use, so it deserves its own section. Understanding that path helps during migrations because many production services were built before Direct VPC egress was the default recommendation.

## Serverless VPC Access Connectors
<!-- section-summary: Serverless VPC Access connectors also provide VPC egress, but they add connector resources and different firewall boundaries. -->

A **Serverless VPC Access connector** is a managed connector resource that lets serverless products send outbound traffic to a VPC network. Before Direct VPC egress, connectors were the common path for Cloud Run services that needed private VPC access.

Connectors still appear in production for good reasons. A service may have been built before Direct VPC egress was available. A team may prefer connectors because they use fewer IP addresses in some cases. A shared connector may already have firewall rules, monitoring, and capacity controls around it.

The tradeoff is operational. Google Cloud's comparison shows Direct VPC egress has lower latency, higher throughput, no additional VM charges, and finer-grained network tags. Connectors have their own scaling behavior and firewall targeting model. With a connector, firewall rules usually target connector instances or connector ranges. With Direct VPC egress, firewall rules can target the Cloud Run revision tags directly.

Here is the connector-style deployment shape:

```bash
gcloud run deploy checkout-api \
  --image=us-docker.pkg.dev/devpolaris-prod/apps/checkout-api:2026-06-14 \
  --region=us-central1 \
  --vpc-connector=checkout-connector \
  --vpc-egress=private-ranges-only
```

`--vpc-connector` points at the connector resource that will carry outbound traffic. The same `--vpc-egress` choice still matters, because it decides whether only private ranges or all destinations use the connector path.

For new Cloud Run services, teams should usually evaluate Direct VPC egress first. For existing services, a migration should compare latency, throughput, subnet IP capacity, firewall rules, tags, cost, and rollback steps. The best migration plan proves the new path with a canary revision before moving all traffic.

Both egress methods still leave one major design choice: which destinations should route through the VPC. The answer depends on private dependencies, public SaaS calls, Google API access, and whether the organization requires centralized outbound inspection.

## Routing Modes and DNS Behavior
<!-- section-summary: Private-ranges-only and all-traffic decide which destinations use VPC egress, and DNS decides which IP range a name points to. -->

Cloud Run VPC egress has two routing modes.

**Private ranges only** routes traffic for private IP address ranges through the VPC. This is the default style for many services because calls to internal addresses use the VPC, while ordinary public internet calls keep using Cloud Run's normal outbound path. Private ranges include familiar RFC 1918 ranges such as `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`.

**All traffic** routes every outbound connection through the VPC. This is useful when the team needs central egress inspection, a static outbound IP through Cloud NAT, or a consistent path for public internet dependencies. When all traffic goes through the VPC and the service still needs public internet access, Cloud NAT or another allowed egress path is usually part of the design.

The routing choice interacts with DNS. DNS answers names with IP addresses, and the egress mode then decides how traffic to that IP range leaves the service. If `redis.internal.devpolaris.com` resolves to `10.20.3.15`, private-ranges-only sends that connection through the VPC. If `api.stripe.com` resolves to a public IP, private-ranges-only keeps it on the default outbound path, while all-traffic sends it through the VPC.

Google APIs need extra care because they use public names such as `storage.googleapis.com`. A service that uses private-ranges-only and needs private access to Google APIs has to combine the egress setting with Private Google Access and DNS configuration that maps the Google API name to the documented private address ranges. Without the DNS piece, the name can still resolve to public addresses, and the traffic will follow the routing mode for those addresses.

Here is a practical review table for the checkout API:

| Destination | DNS answer | Egress mode | Expected path |
|---|---|---|---|
| `redis.internal.devpolaris.com` | `10.20.3.15` | `private-ranges-only` | VPC subnet |
| `storage.googleapis.com` with Private Google Access DNS | Private Google API range | `private-ranges-only` | VPC subnet |
| `api.payment.example` | Public IP | `private-ranges-only` | Default Cloud Run internet path |
| `api.payment.example` | Public IP | `all-traffic` | VPC subnet, then Cloud NAT or approved egress |

This is why DNS belongs in network debugging. The application might only show `ECONNREFUSED` or `timeout`. The platform evidence needs the resolved IP, the egress mode, the route, and the firewall decision.

That leads to the last operational piece: firewall targeting and startup evidence. The routing mode can be correct while a firewall rule, missing tag, exhausted subnet, or DNS answer still breaks the application.

## Firewall Targeting and Debug Evidence
<!-- section-summary: Revision tags, logs, subnet capacity, and startup checks tell teams whether Cloud Run networking is configured correctly. -->

VPC firewall rules decide which traffic is allowed inside the VPC. With Direct VPC egress, Cloud Run can apply **network tags** at the revision level. A network tag is a label that firewall rules can match. This lets a firewall rule allow `checkout-api` to reach a private cache while blocking another service that uses the same subnet.

For example, the checkout API might need TCP port 6379 to a Memorystore-like private endpoint range. A firewall rule can allow only sources with the `checkout-api` network tag. The shape looks like this:

```bash
gcloud compute firewall-rules create allow-checkout-to-cache \
  --network=prod-apps \
  --direction=EGRESS \
  --action=ALLOW \
  --rules=tcp:6379 \
  --destination-ranges=10.20.3.0/24 \
  --target-tags=checkout-api
```

This rule is an egress rule, so it applies to packets leaving resources with the `checkout-api` network tag. The important fields are destination range, port, direction, and target tag. A matching describe output should show the same target tag that Cloud Run applied to the revision:

```yaml
allowed:
- IPProtocol: tcp
  ports:
  - '6379'
direction: EGRESS
destinationRanges:
- 10.20.3.0/24
name: allow-checkout-to-cache
targetTags:
- checkout-api
```

Revision-level tags matter during rollouts. If a new revision deploys without the expected tag, the service may start, accept inbound traffic, and then fail only when it calls the private dependency. That failure can look like an application bug until someone checks the Cloud Run Networking tab or revision YAML.

Good startup and debug evidence usually includes these checks:

| Evidence | Why it matters |
|---|---|
| Cloud Run revision networking settings | Confirms ingress, VPC network, subnet, tags, and egress mode |
| Subnet free IP capacity | Catches scale-up failures caused by address exhaustion |
| Firewall rule target and logs | Proves whether the revision tag is allowed to reach the destination |
| DNS lookup from a similar environment | Shows whether the target name resolves to private or public ranges |
| Application startup logs | Shows whether dependency checks fail before the service is ready |
| Cloud Run request logs | Separates inbound delivery problems from outbound dependency problems |
| VPC Flow Logs or firewall logs where enabled | Gives packet-level evidence for accepted or denied egress |

![A generated infographic separating Cloud Run 403 IAM failures, blocked ingress, private IP timeouts, and DNS answer checks.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/cloud-run-debug-sides.png)
*A `403`, a blocked direct URL, and a private dependency timeout point to different sides of the Cloud Run networking story.*

For a container that checks its database or cache during startup, useful logs include the target hostname, the resolved family if your runtime exposes it safely, the connection timeout, and the dependency name. Secrets, tokens, and full connection strings should stay out of logs. A message such as `cache dependency check failed for redis.internal.devpolaris.com:6379 after 3000ms` gives the network team enough to start without exposing credentials.

The most common debugging mistake is mixing inbound and outbound evidence. A successful request to `checkout.devpolaris.com/healthz` proves the load balancer and Cloud Run ingress path. Database reachability needs its own egress evidence. A successful `redis` connection from startup proves egress, DNS, route, and firewall for that dependency. User invocation needs its own ingress evidence. The two evidence trails need separate review.

## Putting It All Together
<!-- section-summary: A production Cloud Run service states its ingress, IAM, egress route, DNS expectations, and debug evidence clearly. -->

Let's bring the checkout API together.

For inbound traffic, public users call `https://checkout.devpolaris.com`. DNS points that name to the external Application Load Balancer. The load balancer handles HTTPS, URL map routing, and the serverless NEG handoff. The Cloud Run service uses `internal-and-cloud-load-balancing` ingress so internet clients cannot bypass the load balancer by calling the generated `run.app` URL.

For invocation, the team writes down whether Cloud Run allows unauthenticated calls or requires IAM. If IAM is required, callers need the accepted identity token and invoker permission. If unauthenticated invocation is allowed, the team should still explain where user-level authentication happens, such as application sessions, API gateway policy, IAP where supported, or another identity layer.

For outbound traffic, the service uses Direct VPC egress to the `prod-apps` VPC and `run-egress-us-central1` subnet. The `checkout-api` network tag lets firewall rules allow only this service to reach the private cache range. The service chooses `private-ranges-only` because cache and internal service calls should use the VPC, while ordinary public payment API calls can use the default outbound path. If the payment provider requires a static outbound IP, the team can revisit `all-traffic` plus Cloud NAT.

The final production review statement sounds like this:

| Area | Decision |
|---|---|
| Public entry | `checkout.devpolaris.com` through external Application Load Balancer |
| Direct service URL | Blocked from direct internet calls by Cloud Run ingress |
| Invocation | Documented as authenticated or intentionally unauthenticated |
| VPC egress | Direct VPC egress through `prod-apps/run-egress-us-central1` |
| Routing mode | `private-ranges-only` for private dependencies |
| Firewall | Egress allowed from revision tag `checkout-api` to required private ranges and ports |
| DNS | Internal names resolve to private ranges; Google API private access has matching DNS when needed |
| Evidence | DNS, certificate, load balancer logs, Cloud Run logs, revision settings, firewall logs, and dependency startup checks |

That is a much clearer service than "Cloud Run is public" or "Cloud Run is private." The team knows which door users use, which identities can invoke the service, which path outbound packets follow, and which logs prove each layer.

## What's Next
<!-- section-summary: The next article moves from Cloud Run egress into private access patterns for managed services and Google APIs. -->

Cloud Run now has an inbound access plan and an outbound VPC plan. The remaining networking questions usually involve managed services: Cloud SQL, Cloud Storage, Google APIs, private service producer networks, Private Service Connect, and DNS for private Google access.

The next article moves into those private access patterns. The focus shifts from "Can Cloud Run send traffic into a VPC?" to "Which private endpoint pattern should this dependency use, and how do DNS and IAM support it?"

---

**References**

- [Google Cloud: Restrict network endpoint ingress for Cloud Run services](https://docs.cloud.google.com/run/docs/securing/ingress) - Documents Cloud Run ingress paths, ingress settings, and the layered use of ingress plus IAM.
- [Google Cloud: Cloud Run authentication overview](https://docs.cloud.google.com/run/docs/authenticating/overview) - Explains default private deployment, IAM-secured invocation, Cloud Run Invoker access, and unauthenticated access options.
- [Google Cloud: Direct VPC with a VPC network](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc) - Documents Direct VPC egress, network and subnet selection, revision-level tags, routing settings, and the lack of Direct VPC ingress for services.
- [Google Cloud: Compare Direct VPC egress and VPC connectors](https://docs.cloud.google.com/run/docs/configuring/connecting-vpc) - Compares Direct VPC egress with Serverless VPC Access connectors and identifies Direct VPC egress as the recommended path.
- [Google Cloud: Private networking and Cloud Run](https://docs.cloud.google.com/run/docs/securing/private-networking) - Explains private request paths and the role of VPC routing for internal Cloud Run access.
- [Google Cloud: Best practices for Cloud Run networking](https://docs.cloud.google.com/run/docs/configuring/networking-best-practices) - Covers Direct VPC egress performance, all-traffic routing with Cloud NAT, private-ranges-only routing, Private Google Access, DNS, and connection practices.

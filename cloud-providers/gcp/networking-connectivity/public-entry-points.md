---
title: "Public Entry Points and Load Balancing"
description: "Understand how Cloud DNS, public IPs, HTTPS certificates, external Application Load Balancers, URL maps, backend services, and Cloud Run targets create a stable public path."
overview: "A generated service URL is useful for testing, while users need a stable public domain, HTTPS, routing, and operational evidence. The example follows one public learning-platform API from DNS to Cloud Run."
tags: ["gcp", "dns", "https", "load-balancing", "cloud-run"]
order: 3
id: article-cloud-providers-gcp-networking-connectivity-dns-custom-domains-https-load-balancing
aliases:
  - dns-custom-domains-https-and-load-balancing
  - cloud-providers/gcp/networking-connectivity/dns-custom-domains-https-and-load-balancing.md
---

## Table of Contents

1. [Why the Service URL Is Not Enough](#why-the-service-url-is-not-enough)
2. [DNS](#dns)
3. [Public IP Address](#public-ip-address)
4. [HTTPS Certificate](#https-certificate)
5. [External Application Load Balancer](#external-application-load-balancer)
6. [URL Map](#url-map)
7. [Backend Service and Cloud Run Target](#backend-service-and-cloud-run-target)
8. [Serverless NEG](#serverless-neg)
9. [Evidence and Bypass Protection](#evidence-and-bypass-protection)
10. [References](#references)

## Why the Service URL Is Not Enough
<!-- section-summary: A service URL is useful for testing; users need a stable public domain, HTTPS, and routing. -->

A service URL is useful for testing; users need a stable public domain, HTTPS, and routing. Cloud Run can give your service a generated `run.app` URL, and that URL proves the container can receive a request. A production public path needs more around it.

Picture the learning platform API. During development, the team can test `https://learn-api-abc123-uc.a.run.app/healthz`. Users should call `https://learn.example.com/api/courses` instead. The product domain should stay stable while the team redeploys Cloud Run revisions, adds another backend, changes certificates, attaches security policy, or routes paths to different services.

A public entry point has several jobs:

| Job | GCP piece | Plain meaning |
|---|---|---|
| Name | Cloud DNS | Publishes the domain users call |
| Address | Public IP address | Gives DNS a stable target |
| Trust | HTTPS certificate | Lets browsers verify and encrypt the connection |
| Public proxy | External Application Load Balancer | Receives HTTP(S) requests at the edge |
| Routing | URL map | Chooses a backend by host and path |
| Delivery | Backend service | Defines how the load balancer uses a backend |

The first layer is the name. Users and clients should not memorize a generated service URL, so DNS comes before the load balancer details.

![A generated infographic showing a public request path from DNS name to global IP, HTTPS frontend, URL map, and Cloud Run backend.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-dns-custom-domains-https-load-balancing/public-request-path.png)
*A public request path has named layers, so an outage can be DNS, TLS, routing, backend delivery, or application behavior.*

## DNS
<!-- section-summary: DNS turns the user-facing service name into the public address clients connect to. -->

**DNS**, the Domain Name System, maps names to records. The record most people meet first is an `A` record, which maps a name to an IPv4 address. An `AAAA` record maps a name to an IPv6 address.

**Cloud DNS** is Google Cloud's managed DNS service. It can host public zones for internet-visible names and private zones for names used inside selected VPC networks. For `learn.example.com`, the team needs a public DNS record that points at the public entry point.

Think of DNS as the address book your users rely on before any HTTP request exists. A browser cannot talk to `learn.example.com` until it learns an IP address for that name. DNS does not know which Cloud Run revision is healthy or which URL map route should match. It only answers the name-to-address part of the public path.

That narrow job is why DNS evidence is the first check in a public-entry incident. If `learn.example.com` resolves to the wrong address, the load balancer and Cloud Run service may both be healthy while users still reach the old frontend. If DNS resolves correctly, the team can move down the path to certificate, proxy, URL map, backend, and application logs.

A simple public DNS record might look like this:

```yaml
name: learn.example.com.
type: A
ttl: 300
rrdatas:
  - 203.0.113.10
```

Important fields:

- `name` is the user-facing hostname.
- `type: A` means the record returns an IPv4 address.
- `ttl: 300` lets resolvers cache the answer for five minutes, which helps during cutovers.
- `rrdatas` contains the load balancer IP address, not the generated Cloud Run URL.

For AWS readers, Cloud DNS fills the same basic job as Route 53 hosted zones and records. The idea is familiar: the public name points to the public entry layer, and the service behind that entry layer can change.

## Public IP Address
<!-- section-summary: A reserved public IP gives DNS a stable target while backends and routing change behind it. -->

A **public IP address** is the internet-routable address clients connect to. For a global external Application Load Balancer, the frontend can use a global external IP address. DNS points the product hostname at that address.

Production teams usually reserve the address as a named resource. A reserved address keeps the DNS target stable while the team changes certificates, URL maps, backend services, or Cloud Run revisions behind the load balancer. It also gives reviewers a concrete resource to protect and track.

A reserved **global** IP is especially useful during rebuilds and cutovers. If a Terraform change replaces the HTTPS proxy, URL map, or backend service, the DNS record can keep pointing at the same address while the load balancer pieces are rebuilt behind it. If the team moves from an old load balancer stack to a new one, the runbook can detach the address from the old forwarding rule, attach it to the replacement forwarding rule, and avoid asking every resolver on the internet to learn a new address. If a DNS cutover is required, the team can lower TTL before the change, compare the old and new answers, and keep the reserved address as the rollback target.

Without a reserved address, an accidental load balancer replacement can allocate a new IP. DNS might still point at the old address for minutes or hours because clients and recursive resolvers cache answers. The application may be healthy, while users continue to reach the wrong frontend. The reserved address turns the public entry IP into a stable production asset instead of a side effect of the current load balancer build.

The command shape is small:

```bash
gcloud compute addresses create learn-public-ip \
  --project=learn-prod \
  --global

gcloud compute addresses describe learn-public-ip \
  --project=learn-prod \
  --global \
  --format="get(address)"
```

Important fields:

- `--global` matches the global external Application Load Balancer frontend.
- The `describe` command is the read-only check that returns the address for the DNS record.
- The address should be recorded in infrastructure code or deployment output before DNS changes.

Example output:

```console
203.0.113.10
```

## HTTPS Certificate
<!-- section-summary: A certificate lets clients trust the domain and encrypt traffic to the public frontend. -->

An **HTTPS certificate**, also called a TLS or SSL certificate, proves that the public endpoint is allowed to serve a hostname and helps encrypt the connection. Browsers expect a trusted certificate for `learn.example.com` before they treat the connection as secure.

Google-managed certificates reduce certificate operations on load balancer frontends. The team lists the domain, attaches the certificate to the HTTPS proxy, and points DNS to the load balancer IP. Google Cloud provisions and renews the certificate after domain validation succeeds.

The beginner version is: the certificate is the browser's proof that the public endpoint is allowed to speak for the name. If the certificate is missing, expired, or issued for the wrong hostname, users see a security warning before the request reaches your app code. That kind of failure lives at the public entry layer, not inside Cloud Run handlers.

Certificate provisioning also depends on the public path being consistent. The domain must point at the load balancer, and the certificate must be attached to the HTTPS frontend that serves that domain. If DNS points somewhere else, the managed certificate may stay stuck because Google Cloud cannot prove control of the name through the intended endpoint.

The certificate setup normally happens with the load balancer frontend, but the concept is easier to understand before the proxy details:

```bash
gcloud compute ssl-certificates create learn-cert \
  --project=learn-prod \
  --domains=learn.example.com \
  --global

gcloud compute ssl-certificates describe learn-cert \
  --project=learn-prod \
  --global \
  --format="yaml(name,managed.status,managed.domainStatus)"
```

Important fields:

- `--domains=learn.example.com` names the hostname the certificate must cover.
- `managed.status` should reach an active state after DNS and load balancer association are correct.
- `managed.domainStatus` helps identify domain-specific validation problems.

Healthy output after provisioning:

```yaml
name: learn-cert
managed:
  status: ACTIVE
  domainStatus:
    learn.example.com: ACTIVE
```

In AWS terms, this is closest to using AWS Certificate Manager with an Application Load Balancer. The certificate belongs to the public entry path, not to one container revision.

## External Application Load Balancer
<!-- section-summary: The external Application Load Balancer is the managed HTTP(S) proxy that receives public requests. -->

An **external Application Load Balancer** is a managed Layer 7 HTTP(S) proxy. Layer 7 means it understands HTTP details such as hostnames, paths, headers, redirects, and backend routing. It can receive public requests at one IP address and route them to different backend services.

For the learning platform, the load balancer receives `https://learn.example.com`. It terminates HTTPS with the certificate, reads the host and path, uses a URL map to pick a backend service, and forwards the request toward the service that runs the API.

Think of it as the public front desk for HTTP traffic. Users do not need to know which Cloud Run service, backend bucket, or VM group serves a path. They call one domain, and the load balancer handles the public-facing HTTP work: certificate, frontend IP, route selection, backend handoff, logging, and optional edge policy.

This front desk is also a clean place to keep public policy. Cloud Armor rules, redirects, request logs, and path routing sit here so each backend service does not have to rebuild the same public-entry behavior from scratch.

This is also the layer where teams often attach edge controls. Cloud Armor policy can protect the backend path. Cloud CDN can cache eligible assets. Logging can show which backend service answered. HTTP-to-HTTPS redirects can keep clients on the secure path.

For AWS readers, the closest anchor is an Application Load Balancer with ACM certificates and listener rules. Route 53 points at the load balancer, ACM covers TLS, and target groups represent backend destinations. CloudFront and AWS WAF can join the AWS public edge story if caching or web protection is part of the design.

## URL Map
<!-- section-summary: A URL map chooses a backend by matching the request host and path. -->

A **URL map** is the routing configuration for an Application Load Balancer. It matches the request hostname and path, then chooses a backend service or backend bucket. The URL map is where one public hostname can route `/api/*` to one backend and `/assets/*` to another.

The URL map is the traffic directory behind the front desk. DNS and the public IP only get the request to the building. The URL map reads the host and path and decides which backend should handle it. This is why a user can call one stable domain while the platform sends API requests, admin requests, and static assets to different places.

For beginners, this prevents a common mistake: assuming one domain means one backend. One domain can be a shared public contract, and the URL map can split requests behind it. The app teams still need clear path ownership so `/api/*`, `/admin/*`, and `/assets/*` do not overlap in surprising ways.

For the learning platform, the public contract can stay under one hostname:

| Public request | URL map decision | Backend choice |
|---|---|---|
| `learn.example.com/api/*` | Match API path | Learning API backend service |
| `learn.example.com/admin/*` | Match admin path | Admin backend service |
| `learn.example.com/assets/*` | Match static path | Backend bucket or static service |
| Unmatched path | Default rule | Main web backend or error service |

![A generated infographic showing host and path rules choosing separate backend services and a default backend.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-dns-custom-domains-https-load-balancing/url-map-routing.png)
*The URL map keeps one public host while routing different paths to different backends.*

A simplified URL map shape looks like this:

```yaml
hostRules:
  - hosts:
      - learn.example.com
    pathMatcher: learn-paths
pathMatchers:
  - name: learn-paths
    defaultService: backendServices/learn-web-backend
    pathRules:
      - paths:
          - /api/*
        service: backendServices/learn-api-backend
      - paths:
          - /assets/*
        service: backendBuckets/learn-assets
```

Important fields:

- `hosts` lists the domain names this rule handles.
- `pathRules` send specific paths to specific backends.
- `defaultService` handles requests that do not match a more specific path.

## Backend Service and Cloud Run Target
<!-- section-summary: A backend service describes how the load balancer uses a backend, and Cloud Run is the service target in this example. -->

A **backend service** is the load balancer configuration for a group of backend resources. It is the place where the load balancer stores backend-related settings such as logging, security policy attachment, CDN support where available, and the backend objects that receive traffic.

The backend service is the load balancer's configuration for reaching application code. For VM backends, it can point at instance groups or network endpoint groups. For static files, the URL map can choose a backend bucket. For the learning API, the backend service needs a way to point at Cloud Run.

**Cloud Run** is the compute service target in this example. It runs the API container and scales service instances. The load balancer needs a stable backend object that represents the Cloud Run service because Cloud Run instances do not provide fixed VM endpoints for the load balancer to list.

Cloud Run and the backend service have different jobs. Cloud Run owns revisions, container image, environment variables, concurrency, scaling, request timeout, and service logs. The backend service owns the load balancer side of the handoff: whether load balancer logging is enabled, which Cloud Armor security policy applies, and which backend object receives the request.

This difference is important for beginners because a Cloud Run backend is not checked like a group of VMs. For a VM backend, the load balancer can use health checks against known backend endpoints. For a Cloud Run serverless NEG backend, normal VM-style health checks are not supported, and backend service timeout settings do not control the Cloud Run request timeout. The useful evidence comes from load balancer request logs, Cloud Run revision logs, Cloud Run metrics, error rates, and the Cloud Run service settings.

The backend service evidence should show those load balancer fields directly:

```bash
gcloud compute backend-services describe learn-api-backend \
  --project=learn-prod \
  --global \
  --format="yaml(name,protocol,logConfig,securityPolicy,backends)"
```

Example output:

```yaml
name: learn-api-backend
protocol: HTTP
logConfig:
  enable: true
  sampleRate: 1.0
securityPolicy: https://www.googleapis.com/compute/v1/projects/learn-prod/global/securityPolicies/learn-edge-policy
backends:
- group: https://www.googleapis.com/compute/v1/projects/learn-prod/regions/us-central1/networkEndpointGroups/learn-api-neg
```

Interpret the fields as the public-entry contract. `logConfig.enable: true` means load balancer request logs should exist for incident review. `securityPolicy` shows the Cloud Armor policy attached at the edge. `backends.group` points at the serverless NEG, which is the adapter that connects the load balancer backend service to the Cloud Run service. Check Cloud Run itself for revision, scaling, concurrency, request timeout, and application logs.

That adapter object is the next concept: a serverless NEG.

## Serverless NEG
<!-- section-summary: A serverless NEG is the load balancer backend adapter for Cloud Run and other serverless targets. -->

A **network endpoint group**, or **NEG**, represents backend endpoints for a load balancer. A **serverless NEG** is a special NEG type that points at a serverless resource such as Cloud Run, App Engine, Cloud Run functions, or API Gateway.

For the learning API, the serverless NEG points at the `learn-api` Cloud Run service in `us-central1`. The NEG lives in the same region as the Cloud Run service. The global backend service then attaches that regional NEG.

```bash
gcloud compute network-endpoint-groups create learn-api-neg \
  --project=learn-prod \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=learn-api

gcloud compute backend-services create learn-api-backend \
  --project=learn-prod \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED

gcloud compute backend-services add-backend learn-api-backend \
  --project=learn-prod \
  --global \
  --network-endpoint-group=learn-api-neg \
  --network-endpoint-group-region=us-central1
```

Important fields:

- `--network-endpoint-type=serverless` tells Google Cloud this NEG represents a managed serverless target.
- `--cloud-run-service=learn-api` binds the NEG to the regional Cloud Run service.
- `--network-endpoint-group-region=us-central1` must match the NEG and Cloud Run region.
- `--load-balancing-scheme=EXTERNAL_MANAGED` selects the modern global external Application Load Balancer scheme.

Expected operation output should point at a regional NEG:

```yaml
operationType: insert
status: DONE
targetLink: projects/learn-prod/regions/us-central1/networkEndpointGroups/learn-api-neg
```

Describe the NEG to confirm that it points at the intended Cloud Run service:

```bash
gcloud compute network-endpoint-groups describe learn-api-neg \
  --project=learn-prod \
  --region=us-central1 \
  --format="yaml(name,networkEndpointType,cloudRun)"
```

Example output:

```yaml
cloudRun:
  service: learn-api
name: learn-api-neg
networkEndpointType: SERVERLESS
```

Serverless backends use request logs, load balancer logs, Cloud Run logs, and service metrics as evidence. Do not expect a normal load balancer health-check object for the Cloud Run path. During an incident, a useful check says: the URL map chose `learn-api-backend`, the backend service points at `learn-api-neg`, the NEG points at Cloud Run service `learn-api`, load balancer logs show requests reaching the backend, and Cloud Run logs or metrics show whether the service accepted or failed those requests.

## Evidence and Bypass Protection
<!-- section-summary: Public entry debugging follows DNS, certificate state, load balancer logs, backend selection, and Cloud Run logs. -->

Public entry failures can show up as DNS errors, certificate warnings, 404s, 403s, 502s, or timeouts. The fastest path is to check each layer in the same order as the request.

DNS should return the load balancer IP:

```bash
dig learn.example.com A
```

Certificate state should be active:

```bash
gcloud compute ssl-certificates describe learn-cert \
  --project=learn-prod \
  --global \
  --format="yaml(name,managed.status,managed.domainStatus)"
```

Healthy evidence:

```console
learn.example.com. 300 IN A 203.0.113.10
```

```yaml
name: learn-cert
managed:
  status: ACTIVE
  domainStatus:
    learn.example.com: ACTIVE
```

The Cloud Run service should also prove that the load balancer is the supported public path:

```bash
gcloud run services describe learn-api \
  --project=learn-prod \
  --region=us-central1 \
  --format="yaml(metadata.annotations['run.googleapis.com/ingress'],status.url)"
```

Expected output:

```yaml
metadata:
  annotations:
    run.googleapis.com/ingress: internal-and-cloud-load-balancing
status:
  url: https://learn-api-abc123-uc.a.run.app
```

The generated `run.app` URL still exists because Cloud Run needs a service endpoint. It should fail as a direct public customer path under `internal-and-cloud-load-balancing` ingress:

```bash
curl -i https://learn-api-abc123-uc.a.run.app/api/healthz
```

Example failure from a direct internet request:

```console
HTTP/2 404
content-type: text/html; charset=UTF-8
```

The exact status code and body can vary with service behavior and platform response details. The important evidence is that the direct generated URL does not return the application health response from the public internet. If this direct check returns `200 OK`, the service has a bypass path around DNS, certificate, URL map, Cloud Armor, and load balancer logs. If it returns `403`, the request reached an identity gate, so the next check is Cloud Run IAM invocation rather than DNS or load balancer routing.

![A generated infographic showing DNS answers, certificate state, load balancer logs, and service logs as separate public-entry evidence.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-dns-custom-domains-https-load-balancing/public-entry-evidence.png)
*Evidence follows the same order as the request: name, certificate, load balancer decision, then service logs.*

Load balancer logs should show whether the public entry layer received the request and which backend service it selected. If load balancer logs show the request and Cloud Run logs show nothing, the problem is between backend selection and the Cloud Run handoff. If Cloud Run logs show the request and the app returns a 500, the public entry path delivered the request and the application needs review.

Bypass protection is the final access check. Cloud Run ingress can be set to `internal-and-cloud-load-balancing` so public users enter through the load balancer instead of the generated `run.app` URL. That keeps the supported public path under DNS, HTTPS, routing, logging, and edge policy.

The full request path is now clear. DNS maps `learn.example.com` to the reserved public IP. The load balancer presents the certificate, reads the host and path, uses the URL map, selects the backend service, reaches Cloud Run through the serverless NEG, and records evidence along the way.

## References

- [Cloud DNS overview](https://docs.cloud.google.com/dns/docs/overview) - Defines Cloud DNS, public zones, private zones, and DNS records.
- [External Application Load Balancer overview](https://docs.cloud.google.com/load-balancing/docs/https) - Describes the external Application Load Balancer as a proxy-based Layer 7 load balancer.
- [Set up a global external Application Load Balancer with Cloud Run](https://docs.cloud.google.com/load-balancing/docs/https/setup-global-ext-https-serverless) - Shows the official setup path for Cloud Run backends.
- [URL maps overview](https://docs.cloud.google.com/load-balancing/docs/url-map-concepts) - Explains host and path routing to backend services and backend buckets.
- [Backend services overview](https://docs.cloud.google.com/load-balancing/docs/backend-service) - Explains backend service behavior and supported backend types.
- [Serverless network endpoint groups overview](https://docs.cloud.google.com/load-balancing/docs/negs/serverless-neg-concepts) - Defines serverless NEGs and documents serverless backend behavior.
- [Use Google-managed SSL certificates](https://docs.cloud.google.com/load-balancing/docs/ssl-certificates/google-managed-certs) - Covers managed certificate provisioning, proxy association, renewal, and DNS requirements.
- [Restrict network ingress for Cloud Run services](https://docs.cloud.google.com/run/docs/securing/ingress) - Documents Cloud Run ingress settings used to require load balancer entry.

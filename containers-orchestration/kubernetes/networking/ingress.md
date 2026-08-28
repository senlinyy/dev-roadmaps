---
title: "Ingress"
description: "Understand how a public HTTP request crosses DNS, TLS, an Ingress controller, and a private Service before reaching a Pod."
overview: "Ingress describes how public HTTP and HTTPS hostnames and paths should reach internal Services. Begin with a browser outside the cluster, then separate the stored rule from the controller and follow one request through every boundary."
tags: ["ingress", "http", "tls", "routing"]
order: 3
id: article-containers-orchestration-kubernetes-networking-ingress
---

## Table of Contents

1. [Why does the browser need an edge route?](#why-does-the-browser-need-an-edge-route)
2. [What are the Ingress object and Ingress controller?](#what-are-the-ingress-object-and-ingress-controller)
3. [How does one HTTPS request reach a Service?](#how-does-one-https-request-reach-a-service)
4. [How do host, path, and TLS rules divide a website?](#how-do-host-path-and-tls-rules-divide-a-website)
5. [How do you create and prove a route before moving users?](#how-do-you-create-and-prove-a-route-before-moving-users)
6. [What does each failure symptom tell you?](#what-does-each-failure-symptom-tell-you)
7. [When does Gateway API fit better?](#when-does-gateway-api-fit-better)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

The API works from another Pod inside the cluster:

```text
http://api-service:8080
```

The same name is useless to a customer opening a browser at home. Their computer uses public DNS and internet routes, while the Service name and ClusterIP exist only inside the cluster. The customer knows a public URL instead:

```text
https://shop.example.com/api
```

Something at the edge of the cluster must receive that outside connection, prove the site's TLS identity, read the HTTP hostname and path, and forward the request to the private Service.

**Ingress is the Kubernetes API that describes that HTTP or HTTPS routing rule.** An Ingress controller is the active software that turns the stored rule into a real proxy or load-balancer configuration.

For a global commerce site, DNS publishes the edge address, TLS proves the site's identity and encrypts the connection, and the HTTP hostname and path choose the internal Service. These are separate decisions along one customer request, and the Ingress controller must implement all three correctly while API traffic continues.

We will follow `https://shop.example.com/api` from the browser to a ready API Pod.

Keep these questions in view as you work through the lesson:

1. **Why does the browser need an edge route?**
2. **What are the Ingress object and Ingress controller?**
3. **How does one HTTPS request reach a Service?**
4. **How do host, path, and TLS rules divide a website?**
5. **How do you create and prove a route before moving users?**
6. **What does each failure symptom tell you?**
7. **When does Gateway API fit better?**

## Why does the browser need an edge route?
<!-- section-summary: A Service gives the application a stable cluster-network identity; Ingress adds a public HTTP-aware entrance for outside callers. -->

The API Service solves the problem inside Kubernetes. Pods can be replaced while callers keep using `api-service:8080`. Its ClusterIP belongs to a virtual network understood by the cluster.

A browser outside the cluster lacks two things. First, its routing table stops before the private Service network. Second, even if several web applications share one public IP and port `443`, the destination IP and port leave the intended application ambiguous.

The useful information is in the URL. For these three requests, the public IP may be identical:

| Incoming HTTP request | Kubernetes backend |
|---|---|
| `shop.example.com/api` | `api-service` Service |
| `shop.example.com/` | `frontend-service` Service |
| `admin.example.com/` | `admin-service` Service |

An HTTP-aware edge can inspect the hostname and path after the connection is established. The decision it needs is:

Each rule maps an HTTP hostname and URL path to a Kubernetes Service and Service port.

Ingress records that mapping. The Service still answers “Which ready Pods provide the API?” Ingress answers “Which public HTTP requests belong to the API?” Keeping those jobs separate lets Pods roll without changing the public URL and lets routes change without exposing Pod addresses.

A LoadBalancer Service can give one Service an outside address, which is useful for some TCP, UDP, or simple single-service cases. Ingress adds a shared HTTP layer: many Services can use one public address and certificate strategy while hostnames and paths direct each request.

That public path is assembled by several systems. A DNS provider publishes the hostname. A load balancer or proxy accepts connections on ports `80` and `443`. The TLS endpoint presents the certificate. The Ingress controller programs HTTP routes. Services and EndpointSlices lead from each route to ready Pods. Ingress owns the HTTP routing description, while the other systems retain their own responsibilities.

This is why “expose the app” is not one switch. The Deployment creates application processes. The ClusterIP Service gives them a stable internal front door. Ingress describes which public HTTP identity should lead to that Service. The controller supplies or configures the edge data plane, while public DNS makes users find it. Omitting any link leaves the others valid but incomplete.

The abstraction also lets several applications share the same public address and port. TCP reaches `203.0.113.42:443`, but that tuple alone does not distinguish the shop API from the admin site. TLS SNI and the later HTTP `Host` and path carry the application identity needed for the edge to choose a route.

## What are the Ingress object and Ingress controller?
<!-- section-summary: The Ingress object stores the desired HTTP rule, while the controller owns a real proxy or load balancer and continually applies those rules. -->

An Ingress object is a statement stored in the Kubernetes API. It can say “send `/api` to `api-service`.” Opening port `443` and carrying packets require an active data plane.

The **Ingress controller** performs the active work. It watches Ingress objects, decides which ones belong to it, translates their rules into the configuration understood by its proxy or load balancer, and keeps reconciling changes.

The distinction is similar to an architect's plan and the building crew. The Ingress is the approved plan showing where the public doorway should lead. The controller and its data plane construct and operate the actual doorway. A valid plan can exist while no crew is present.

This is why the API server can accept an Ingress while the site remains unreachable. It proved only that the desired object was valid. If its `ingressClassName` points to a missing controller, no data plane claims it and the address can remain empty.

An **IngressClass** connects a friendly class name to a controller implementation. A cluster might use `public` for an internet-facing controller and `internal` for a company-network controller. The Ingress chooses one:

```yaml
spec:
  ingressClassName: public
```

The `public` IngressClass then identifies the controller expected to reconcile it. This avoids two controllers treating the same route as their own instruction.

The controller also needs a real backend. Ingress sends to a Service, while the Deployment's Pods sit behind that Service. If `api-service` has zero ready EndpointSlice addresses, the public rule can be correct and still have nowhere healthy to send traffic.

The two prerequisite stories are therefore:

The Ingress controller claims the Ingress and programs the edge. Behind that edge, the Service and its ready EndpointSlices lead to the responding application. These are connected control loops, so an accepted Ingress can still lead to an empty backend set.

Only when both stories work can the edge connect a browser to the application.

The concrete data plane depends on the controller. One implementation may configure NGINX, Envoy, or HAProxy running inside the cluster. Another may configure a provider-managed layer-seven load balancer. In every case, the Ingress object remains stored desired state, the controller performs reconciliation, and the resulting proxy or load balancer receives the real request.

Read creation as a reconciliation sequence:

```text
API stores Ingress
      ↓
controller for ingressClassName observes it
      ↓
controller resolves TLS and Service references
      ↓
controller programs proxy or load balancer
      ↓
edge address becomes available
      ↓
DNS can direct users to that address
```

An accepted YAML document proves only the first transition. A missing controller, wrong class, absent TLS Secret, empty Service backend, or unconfigured public DNS can stop a later transition. Those are separate owners and therefore require separate evidence.

## How does one HTTPS request reach a Service?
<!-- section-summary: DNS finds the edge, TLS proves and protects the hostname, HTTP reveals the route, and the Service supplies a ready backend. -->

Return to the customer's URL:

```text
https://shop.example.com/api
```

The browser and edge use that information in stages. Each stage consumes one part and creates the condition needed for the next.

### 1. DNS finds the public edge

The browser asks public DNS for `shop.example.com`. The answer is the address or load-balancer name used by the Ingress data plane. DNS maps the hostname to the shared entrance; the later HTTP routing stage interprets `/api`.

If the name returns `NXDOMAIN`, the request ended at public DNS before reaching Kubernetes. Repair belongs in the public DNS record rather than the Service selector.

### 2. TLS proves the site's identity

The browser connects to port `443` and includes `shop.example.com` during the TLS handshake. The edge chooses a certificate for that hostname. The browser checks that the certificate is trusted and covers the name, then encryption begins.

This happens before the edge can read the encrypted HTTP path. A certificate warning means some TLS endpoint answered while `/api` routing still awaits a trusted connection. The relevant evidence is the hostname, certificate, Secret, and controller's TLS configuration.

### 3. HTTP reveals the routing decision

Inside the protected connection, the browser sends an HTTP request containing the hostname and `/api` path. The edge compares those values with the configuration produced from Ingress rules.

A rule for `shop.example.com` and `/api` yields `api-service:8080`. The Service then supplies ready endpoints. Depending on the controller, the proxy may use the Service address or consume EndpointSlice information directly, but the Kubernetes backend contract remains the Service and port.

Notice the point at which each piece of information is available. Public DNS can route only by the queried hostname and returns an edge address; it never sees `/api`. During TLS, the edge uses the SNI hostname to choose a certificate before it can read encrypted HTTP content. After decryption, the HTTP hostname and path become available for Ingress matching. Mixing these stages leads to errors such as expecting a DNS record to choose an application path or expecting an HTTP rule to repair a certificate mismatch.

![A browser request is separated into public DNS, TLS hostname verification, Ingress host and path matching, the API Service, and one ready Pod](/content-assets/articles/article-containers-orchestration-kubernetes-networking-ingress/ingress-request-path.png)

*The same URL carries several decisions, and each layer proves a different part before the request can continue.*

The return response follows the established path back. An application-generated response therefore proves more than a successful DNS query: the request crossed the edge, matched a route, reached a backend, and entered application code.

## How do host, path, and TLS rules divide a website?
<!-- section-summary: Hostname chooses the site, path chooses the part of that site, and the TLS host must match the identity protected before HTTP routing begins. -->

Suppose the API and frontend share `shop.example.com`. The hostname chooses the shop site, while the path divides that site between applications.

The useful rule requires both parts to match. A request that matches only the hostname or only the path belongs to a different routing decision.

Path type controls how much URL space an application owns. A `Prefix` rule for `/api` includes `/api`, `/api/orders`, and other paths beneath that path component. An `Exact` rule owns only `/api`.

Several paths can match one request, so precedence matters. Kubernetes chooses the longest matching path. When an `Exact` rule and a `Prefix` rule have the same path length, `Exact` wins. A more specific `/api` rule therefore takes priority over a broad `/` fallback.

That choice is an application boundary. Use `Prefix` when one application owns a route family. Use `Exact` when one handler should receive one precise URL.

TLS identity and HTTP routing should agree. If the Ingress rule accepts `shop.example.com` but the TLS Secret contains a certificate only for `admin.example.com`, the browser stops with a certificate warning before the `/api` rule can help. The matching hostname appears in two stages for two different reasons: TLS protects identity first; HTTP selects the application second.

The following Ingress expresses the decisions after we understand them:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
spec:
  ingressClassName: public
  tls:
    - hosts:
        - shop.example.com
        - admin.example.com
      secretName: example-tls
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-service
                port:
                  number: 80
    - host: admin.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: admin-service
                port:
                  number: 80
```

The standard fields describe class, TLS identity, host, path, and Service. Controller-specific annotations can add rewrites, redirects, authentication, or timeouts. Those annotations are implementation contracts. Every one must be inventoried and retested if the controller changes.

The `tls.secretName` field points to an existing Kubernetes Secret containing `tls.crt` and `tls.key`. Another component or operator must create and renew that Secret; certificate issuance remains a separate workflow. `cert-manager` is one common automation for producing and renewing such a Secret. Public DNS has the same ownership boundary: the Ingress controller may publish an address in status, while a DNS operator or automation still has to map the public hostname to that address.

Ingress deliberately keeps a Service between the route and the Pods. Pod addresses change during rescheduling and rollout, while the Service provides a stable backend name and continuously updated ready endpoint set. The Ingress decides which application should receive the request; the Service data plane decides which current replica should handle the connection.

## How do you create and prove a route before moving users?
<!-- section-summary: Establish the private backend, apply the route, wait for the controller's address, and test the candidate edge with the real hostname before changing DNS. -->

The safest rollout starts before the Ingress. First prove that `api-service` has ready endpoints and responds from inside the cluster. An empty backend remains empty after a public route is added.

After applying the Ingress, inspect whether the expected controller claimed it and associated it with an address:

```bash
kubectl get svc api-service
kubectl get endpointslices
kubectl describe ingress shop
kubectl get ingress shop
```

`describe` combines the intended rules, backend resolution, and controller events. An address proves that a data plane has been associated with the route. TLS and HTTP behavior require their own request-level tests.

Suppose the candidate address is `203.0.113.42`. Test it without changing public DNS:

```bash
curl --resolve shop.example.com:443:203.0.113.42 \
  https://shop.example.com/api
```

`--resolve` makes the connection go to the candidate address while keeping the real hostname. TLS sees `shop.example.com`, and the HTTP rule sees the same hostname. Calling `https://203.0.113.42/` would test a different certificate and route decision.

This test separates route proof from user migration. A successful response proves that the candidate address accepts the real TLS name, matches the intended host and path, reaches `api-service`, and obtains an application response. Public DNS can remain on the old edge until that chain is healthy. When DNS is finally changed, the new variable under test is discovery rather than the entire route at once.

Keep the old path available during verification where the rollout permits it. If the candidate fails before DNS changes, users remain on the existing edge and the team can inspect controller events, certificates, Services, and endpoints without converting diagnosis into a public outage.

![An Ingress rollout has a desired-state track for Service, Ingress, and controller reconciliation plus a user-traffic track for DNS, TLS, route, and application evidence](/content-assets/articles/article-containers-orchestration-kubernetes-networking-ingress/ingress-tls-dns-rollout.png)

*The stored route and the working user path are separate claims; prove both before moving public DNS.*

## What does each failure symptom tell you?
<!-- section-summary: The response tells you how far the request travelled, so diagnosis should begin at the first unproven responsibility rather than editing every object. -->

“Ingress is broken” hides the path. A precise symptom tells us which layers probably completed.

An unresolved hostname places the failure in public DNS, before the edge. A certificate warning shows that a TLS endpoint answered with the wrong identity. A controller-branded default `404` usually means DNS and TLS worked while every host-and-path rule rejected the request. An upstream `503` usually means a route matched while the Service or endpoints were unusable. An application-branded `500` shows that most of the network path succeeded and application logs become relevant.

| Symptom | Last likely success | Next evidence |
|---|---|---|
| `NXDOMAIN` | Nothing reached the edge | Public DNS record and controller address |
| Connection timeout | The caller obtained an address, but received no useful response | Public load balancer, firewall rules, listener, controller, and return path |
| Connection refused | The address was reachable enough to reject TCP | Expected address and port, listener state, and controller data plane |
| Certificate warning | A TLS endpoint answered | Hostname, certificate, Secret, listener configuration |
| TLS handshake error | TCP reached a TLS endpoint | Certificate chain, SNI hostname, protocol support, and TLS configuration |
| Controller default `404` | DNS, TCP, TLS, and edge HTTP response | Host and path matching |
| Controller `502` or `503` | A route likely selected a backend | Service port, EndpointSlices, policy, upstream health |
| Application-shaped `404` | The request probably entered application code | Application route and the path forwarded by the edge |
| Application-shaped `500` | Request entered the application | Application logs and dependencies |
| One replica fails intermittently | The route and Service work for at least one backend | Readiness, image version, listener, and logs for every endpoint |
| HTTP-to-HTTPS redirect loop | Both edge and application are attempting scheme redirects | Forwarded-protocol headers and redirect ownership |

Identify who produced the response. An application `404` proves a different path from the controller's default `404`. Response headers, bodies, edge access logs, and application logs establish the producer.

The distinction prevents backward debugging. A controller-branded `404` means an HTTP edge answered, so replacing application Pods is unlikely to correct a hostname mismatch. An application-branded `500` means the route reached application code, so changing public DNS cannot repair its failed database call. Preserve every completed layer as evidence and begin with the next unproven responsibility.

Use the objects behind the route to confirm that interpretation rather than stopping at the status code:

```bash
kubectl get ingress
kubectl describe ingress shop
kubectl get svc api-service
kubectl get endpointslices
kubectl get pods
```

For an intermittent failure, call each current endpoint directly and compare the outlier with the healthy replicas. For a redirect loop, compare the edge's redirect behavior with the application's handling of forwarded headers. Both cases occur after the request has already crossed several earlier layers.

![An Ingress fault-isolation path marks the last successful evidence across public DNS, TLS, host and path match, Service endpoints, policy, and application response](/content-assets/articles/article-containers-orchestration-kubernetes-networking-ingress/ingress-debugging-summary.png)

*The strongest next question is “Which component produced the last good evidence?”*

## When does Gateway API fit better?
<!-- section-summary: Ingress remains suitable for straightforward routes, while Gateway API is designed for separate infrastructure and route owners plus richer portable traffic rules. -->

Ingress remains useful. A maintained controller and a small set of understood host, path, and TLS rules can be a clear production design. The Kubernetes Ingress API is stable and remains supported.

The friction appears when a route needs decisions outside the portable Ingress fields. Suppose the platform team owns one listener and certificate, while five application teams independently own routes. Or the application team needs a standard header match for test traffic and a 90/10 split between Services. Ingress deployments commonly solve these with shared object ownership, controller-specific annotations, or custom resources.

Gateway API separates the shared listener from application Routes and provides standard forms for more traffic behavior. That makes the ownership and portability problem visible instead of hiding it in one object or annotation collection.

Gateway API v1.6 is the current release line in the source material, and the current installation guide uses the v1.6.1 bundle. GatewayClass, Gateway, HTTPRoute, and ReferenceGrant are available through the Standard channel. TCPRoute and UDPRoute also joined the Standard installation in v1.6, so the model now covers more than HTTP without forcing those protocols through Ingress.

Choose Ingress when its compact model and maintained implementation already meet the requirement. Choose Gateway API when separate owners, richer standard routing, or a broader protocol family solves a problem you actually have. More resources are worthwhile only when they represent real decisions.

The deeper model remains stable across both APIs: the public hostname and path are durable application identities, while the controller, Service endpoints, and Pods are replaceable implementation locations. Edge routing progressively translates the public identity into one current application endpoint.

## Check Your Answers
<!-- section-summary: Reconstruct Ingress from the outside browser, active controller, URL decisions, private Service, and evidence at each boundary. -->

:::expand[Why does the browser need an edge route?]{kind="recap"}
The Service name and ClusterIP belong to the cluster network, while the browser starts outside it. Several web applications may also share one public address, so an HTTP-aware edge must use hostname and path to select the private Service.
:::

:::expand[What are the Ingress object and Ingress controller?]{kind="recap"}
The Ingress object stores desired host, path, TLS, and Service mappings. The controller watches the chosen IngressClass and configures a real proxy or load balancer. Traffic begins only after that controller creates a working data plane.
:::

:::expand[How does one HTTPS request reach a Service?]{kind="recap"}
Public DNS leads the browser to the edge. TLS proves the hostname and protects the connection. The edge then reads the HTTP hostname and path, selects the Service and port, and forwards to a ready endpoint.
:::

:::expand[How do host, path, and TLS rules divide a website?]{kind="recap"}
The hostname chooses the site, the path chooses the application area within that site, and path type controls how much URL space belongs to the rule. TLS must first present a certificate valid for the same public identity.
:::

:::expand[How do you create and prove a route before moving users?]{kind="recap"}
Prove the Service backend, apply the Ingress, inspect controller events and address, then test the candidate address with the real hostname. Move public DNS only after TLS, routing, backend response, and monitoring are healthy while the previous edge remains available.
:::

:::expand[What does each failure symptom tell you?]{kind="recap"}
An unresolved name fails before the edge, a certificate error fails during TLS, an edge default 404 points to matching, an upstream error points to Service reachability, and an application response proves the request travelled further. Confirm which component produced the evidence.
:::

:::expand[When does Gateway API fit better?]{kind="recap"}
Ingress fits straightforward HTTP routes owned and supported through a maintained controller. Gateway API fits when platform listeners and application routes need separate ownership or when richer portable matching and traffic splitting replace controller-specific extensions.
:::

## References

- [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official HTTP and HTTPS routing, controller, path, TLS, and frozen-API behavior.
- [Ingress Controllers](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/) - Official explanation of implementations that fulfil Ingress resources.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official stable Service contract in front of changing Pods.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Official backend endpoint records.
- [Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/) - Official role-oriented shared routing model.
- [Install Gateway API](https://gateway-api.sigs.k8s.io/guides/getting-started/introduction/) - Official current bundle and Standard versus Experimental channel installation guidance.
- [Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) - Kubernetes announcement covering the community controller's March 2026 retirement.

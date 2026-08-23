---
title: "Gateway API"
description: "Understand why Gateway API exists, how infrastructure and application teams share an edge, and how one request reaches a Service."
overview: "Gateway API separates the technology behind an edge, the shared listening point, and each application's routing rules. Follow two teams sharing one HTTPS address, then learn how attachment, namespace consent, traffic splitting, and status keep that shared path understandable."
tags: ["gateway-api", "httproute", "gateway", "routing"]
order: 4
id: article-containers-orchestration-kubernetes-networking-gateway-api
---

## Table of Contents

1. [What is Gateway API in plain terms?](#what-is-gateway-api-in-plain-terms)
2. [Why can Ingress become awkward for several teams?](#why-can-ingress-become-awkward-for-several-teams)
3. [Who owns GatewayClass, Gateway, and Routes?](#who-owns-gatewayclass-gateway-and-routes)
4. [How does an application earn a place on the shared Gateway?](#how-does-an-application-earn-a-place-on-the-shared-gateway)
5. [Can a Route send traffic to another team's Service?](#can-a-route-send-traffic-to-another-teams-service)
6. [How does Gateway API handle safer releases?](#how-does-gateway-api-handle-safer-releases)
7. [How do you prove the configuration became a working route?](#how-do-you-prove-the-configuration-became-a-working-route)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

A platform team operates a shared cluster entrance, while an application team owns the Service behind it. The practical question is:

> How does `https://payments.example.com/api` arrive from outside the cluster, who owns that entry point, and who is allowed to put routes on it?

**Gateway API separates the infrastructure, listener, route, and backend decisions into cooperating Kubernetes resources.** A controller turns those resources into a working proxy or load balancer.

This article follows one request:

```text
GET https://payments.example.com/api
```

That request gives us seven practical questions. Each one follows from a decision that the platform team or an application team must make:

1. **What is Gateway API in plain terms?**
2. **Why can Ingress become awkward for several teams?**
3. **Who owns GatewayClass, Gateway, and Routes?**
4. **How does an application earn a place on the shared Gateway?**
5. **Can a Route send traffic to another team's Service?**
6. **How does Gateway API handle safer releases?**
7. **How do you prove the configuration became a working route?**

## What is Gateway API in plain terms?
<!-- section-summary: Gateway API gives infrastructure teams and application teams separate Kubernetes resources for one shared traffic path. -->

Start with the user. Their browser or API client knows one URL and expects the request to reach the payments API securely. Kubernetes namespaces, proxy vendors, and today's ready Pod remain internal implementation details.

Someone still has to make several different decisions. The infrastructure provider chooses the technology that can handle traffic. The platform operator installs a real HTTPS entrance and supplies its certificate. The payments developer decides that `/api` belongs to the payments Service. These decisions are related, but they have different owners and different risks.

Gateway API represents those decisions with cooperating resources:

Read the relationship from infrastructure toward the application: a `GatewayClass` describes an available gateway implementation, a `Gateway` creates a listening entry point, an `HTTPRoute` attaches matching rules, and each backend reference leads to a Service with ready Pods.

The chain is easier to understand through a building entrance:

- `GatewayClass` is the catalog of entrance systems the company is able to install;
- `Gateway` is one entrance actually installed at a particular place, with a lock and opening hours;
- `HTTPRoute` is the receptionist's instruction for directing a visitor after they enter;
- `Service` is the stable office destination even when the people working there change desks.

The analogy has a precise Kubernetes mapping. The “entrance system” is a controller implementation. The installed entrance is a Gateway address and listener. The receptionist's instruction is an HTTP host, path, or header match. The office is the Service and its ready endpoints.

Gateway API resources describe desired state. A controller watches those instructions and programs the real data plane that receives packets. With the custom resource definitions installed and every compatible controller absent, Kubernetes can store the YAML while the listener remains missing.

Keep three layers separate:

```text
Gateway API objects -> desired network configuration
Gateway controller  -> translates and reconciles that configuration
data plane          -> proxy or load balancer that handles requests
```

Creating an HTTPRoute changes the first layer. The controller must observe it, accept its relationships, and program the second layer's result into the third. Only then can a client request exercise the route. This is why successful `kubectl apply` is necessary evidence but never end-to-end proof.

For `GET /api` with `Host: payments.example.com`, the live data path is concrete. The client connects to the Gateway address, the listener accepts the protocol, an attached HTTPRoute matches the hostname and path, its `backendRefs` choose `payments-service:8080`, and the Service selects a ready Pod. Gateway API organizes the edge decisions; the Service still performs stable backend discovery inside the cluster.


## Why can Ingress become awkward for several teams?
<!-- section-summary: Ingress remains useful for simple HTTP routes, while Gateway API adds portable models for separate listener owners, route owners, and richer routing decisions. -->

Ingress starts from a compact idea: put a hostname, one or more paths, TLS information, and Service backends in an Ingress object. That works well when one team owns a straightforward web route.

Our shared API introduces a different operating problem. The platform team owns `payments.example.com`, the certificate, the public address, and the decision about which namespaces may publish externally. The payments team only owns `/api`. If all of that lives in one object, either the application team needs permission to edit platform-owned details, or every small route change requires the platform team's help.

The limitation is even clearer during a release. Suppose the payments team wants requests with the header `X-Canary: true` to reach `payments-v2`, while normal traffic stays on `payments-v1`. Later it wants a 90/10 split. The portable Ingress API has no standard field for that header match or backend weighting. A controller may support the behavior through annotations or its own custom resource, but moving to another controller can require redesigning the configuration.

Teams commonly respond in one of three ways. They can share one large Ingress and coordinate every edit, let each team create an Ingress and rely on controller-specific merge rules for overlapping hostnames, or create a separate load balancer for every application. The first two choices increase coordination and conflict risk. The third improves isolation while increasing infrastructure cost and the number of public edges to operate. Gateway API makes the shared infrastructure and each application's routing separate resources instead.

Ingress also focuses on HTTP and HTTPS. A platform that wants standard resource models for gRPC, TLS pass-through, or TCP traffic needs something broader than one HTTP routing object.

Ingress was intentionally designed around a smaller HTTP routing shape. The shared-platform problem has outgrown that shape, so Gateway API responds with four design goals:

- **role-oriented:** objects match the people who operate the system;
- **portable:** common behavior has shared API semantics;
- **expressive:** matches and traffic choices can be represented directly;
- **extensible:** implementations can add capabilities without forcing every idea into annotations.

The cost is more resources. A small site may still be clearer as one Ingress. Gateway API earns its extra structure when the listener, routes, and applications really do have different owners or need richer behavior.

## Who owns GatewayClass, Gateway, and Routes?
<!-- section-summary: GatewayClass chooses the implementation, Gateway creates the shared listening point, and Routes express application-specific traffic decisions. -->

Instead of introducing the YAML first, we can assign each decision to the person who can safely make it.

### A. GatewayClass: what kind of entrance can the cluster build?

**Typical owner:** an infrastructure provider or cluster platform team.

**What it controls:** the controller implementation that will fulfil Gateways of this class. A cluster might have one class backed by a cloud load balancer and another backed by an in-cluster proxy.

**Why it is separate:** application developers should request a supported platform capability without copying vendor identity into every route. The platform can upgrade or govern the implementation behind a stable class name.

**Building analogy:** this is the catalog entry for a type of entrance system—perhaps a staffed main entrance or an automated secure gate. It describes what can be installed. A Gateway later places one at a specific building.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: public-gateway
spec:
  controllerName: example.com/gateway-controller
```

If every installed controller ignores `example.com/gateway-controller`, the class remains unaccepted. Every Gateway asking for `public-gateway` is then waiting for technology absent from the cluster.

A platform can publish several classes when the infrastructure choices represent genuinely different capabilities. `public` might create an internet-facing provider load balancer, `private` might create an internal address reachable only from company networks, and `high-security` might require a hardened controller and policy set. Those are platform contracts. Application Routes continue to ask for a stable class name rather than embedding the vendor implementation in every workload repository.

### B. Gateway: where can traffic enter?

**Typical owner:** a platform administrator or cluster operator.

**What it controls:** the real listening point—protocol, port, hostname, TLS certificate, and rules about which Routes may attach.

**Why it is separate:** these settings affect every application sharing the edge. Platform-owned permissions protect the support certificate and keep internal namespaces private while application developers manage their own routes.

**Building analogy:** the operator now installs one entrance at a real address, fits the lock, and decides which departments may put directions behind it.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: shared-gateway
  namespace: edge
spec:
  gatewayClassName: public-gateway
  listeners:
    - name: http
      port: 80
      protocol: HTTP
      allowedRoutes:
        kinds:
          - kind: HTTPRoute
        namespaces:
          from: Selector
          selector:
            matchLabels:
              gateway-access: public
```

This listener accepts HTTP on port `80`. It also says that only namespaces carrying `gateway-access: public` may contribute HTTPRoutes. Reconciliation may create a cloud load balancer, an address, proxy Pods, or other implementation-specific infrastructure.

`allowedRoutes.namespaces.from` can be `Same`, `All`, or `Selector`. `Same` keeps Routes in the Gateway's namespace, `All` admits every namespace, and `Selector` admits namespaces carrying approved labels. A listener can also restrict the Route kinds it accepts. These choices let the Gateway owner describe the exact sharing boundary before any application attaches.

### C. HTTPRoute: how should an HTTP request be directed?

**Typical owner:** the application team whose Service will receive the request.

**What it controls:** HTTP matching and forwarding. The route can use a hostname, path, header, or other supported HTTP information to select one or more backend Services.

**Why it is separate:** an application team can change its own path or release rule without receiving control over the public listener or another team's route.

**Building analogy:** this is the receptionist just inside the shared entrance. The receptionist reads “catalog” on the visitor's request and directs that visitor to the catalog office.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: payments
  namespace: payments
spec:
  parentRefs:
    - name: shared-gateway
      namespace: edge
      sectionName: http
  hostnames:
    - payments.example.com
  rules:
    - backendRefs:
        - name: payments-service
          port: 8080
```

The route chooses the stable `payments-service` Service. That Service maintains the current ready endpoint set and selects a Pod for each request. One request now has an explainable path:

For `http://payments.example.com/health`, the request passes four decisions in order:

1. the `shared-gateway` Gateway accepts HTTP traffic on port `80`;
2. the payments `HTTPRoute` matches the hostname;
3. its backend reference selects `payments-service` on Service port `8080`;
4. the Service data plane chooses one ready payments Pod.

Most Gateway API YAML becomes easier to read when three references are traced explicitly:

| Reference | Meaning |
|---|---|
| `Gateway.spec.gatewayClassName` | Which controller implementation can build this entrance? |
| `HTTPRoute.spec.parentRefs` | Which Gateway listener should supply traffic to this Route? |
| `HTTPRoute.rules.backendRefs` | Which Service should receive matching traffic? |

Those references connect the owners without merging their resources into one document.

Each owner can now change its decision without taking ownership of every neighboring decision.

## How does an application earn a place on the shared Gateway?
<!-- section-summary: A Route asks to use a listener, and the listener independently decides which namespaces and Route kinds it accepts. -->

Consider what would happen without an attachment rule. Any developer who could create an HTTPRoute might name the public Gateway and publish an internal tool to the internet. The platform team would own the entrance but have no control over who placed directions behind it.

Gateway API makes attachment a two-sided agreement. The payments Route uses `parentRefs` to say, “I want to attach to the `http` listener on `edge/shared-gateway`.” The listener uses `allowedRoutes` to say, “I accept Routes only from namespaces approved for public access.” Neither side can create the relationship alone.

In our example, the platform team labels the payments namespace:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    gateway-access: public
```

Now the namespace matches the listener's selector. A namespace without that label can still contain an HTTPRoute object, but the public listener does not attach it and no traffic follows it through that Gateway.

Permission is only one part of compatibility. The Route's hostname and protocol must also be compatible with the listener, and the Route kind must be admitted. These are visible relationship failures rather than silent merge conventions.

This is the important design result: the application team controls **where its own accepted requests go**, while the platform team controls **which applications may use the shared entrance at all**.

Kubernetes RBAC and Gateway attachment answer different permission questions. RBAC decides whether a person or controller may create or modify an HTTPRoute. `parentRefs` and `allowedRoutes` decide whether that existing Route may attach to this listener. A developer can have permission to create Routes in an application namespace while the public Gateway still refuses every Route from that namespace.

## Can a Route send traffic to another team's Service?
<!-- section-summary: A Route can use a Service in another namespace only when the target namespace explicitly grants that reference. -->

Suppose an `HTTPRoute` in `storefront` wants to send traffic to `payment-api` in `payments`. Naming the backend is not enough, because the Route owner must not grant itself access to another team's Service.

The Route expresses the reference:

```yaml
backendRefs:
  - name: payment-api
    namespace: payments
    port: 8080
```

The payments team then creates a `ReferenceGrant` in the namespace that owns the Service:

```yaml
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-storefront
  namespace: payments
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: storefront
  to:
    - group: ""
      kind: Service
      name: payment-api
```

The important rule is that the consumer does not grant itself access. The owner of the target grants access. Including `name: payment-api` limits consent to that Service; omitting the name would allow matching Routes to reference every Service of that group and kind in `payments`.

This consent is intentionally directional. The storefront Route can ask to use `payment-api`, but only a ReferenceGrant stored beside that target can make the cross-namespace reference valid. Moving the grant into `storefront` would let the consumer approve itself and would defeat the ownership boundary.

Gateway attachment uses a different trust mechanism. A Route in another namespace attaches through `parentRefs` plus the Gateway listener's `allowedRoutes`; that attachment does not require a ReferenceGrant.

## How does Gateway API handle safer releases?
<!-- section-summary: HTTPRoute can direct test requests and gradually divide ordinary traffic between two healthy Service versions. -->

Suppose `payments-v2` changes the way discounts are calculated. Sending every customer to it immediately would make the first production request the first realistic test. The payments team wants two smaller steps.

First, only synthetic requests carrying `X-Canary: true` should reach v2. Everyone else stays on v1. HTTPRoute can describe that decision directly:

```yaml
rules:
  - matches:
      - headers:
          - name: X-Canary
            value: "true"
    backendRefs:
      - name: payments-v2
        port: 8080
  - backendRefs:
      - name: payments-v1
        port: 8080
```

The team can now send a known request with the test header and fix v2 without exposing ordinary users. The more specific header rule wins over the catch-all rule.

After that proof, the team can put a small share of ordinary traffic on v2:

```yaml
backendRefs:
  - name: payments-v1
    port: 8080
    weight: 90
  - name: payments-v2
    port: 8080
    weight: 10
```

The weights are relative. `90` and `10` produce roughly 90% and 10% across a suitable sample of requests. Connection reuse, retries, and low traffic make “every tenth request goes to v2” an invalid expectation and can leave a short observation uneven.

The rollback remains small because v1 is still present. Setting v2's weight to `0` sends new traffic back to the stable Service. Deleting v1 before v2 is proven would remove that safety path.

Gateway API supplies the routing primitives for this rollout; a person or progressive-delivery controller still decides when to change the weights. The Route can express `10%` to v2, while it has no built-in rule saying “increase to 25% when the error rate stays below this threshold” or “return to v1 when latency rises.” Those decisions require measurements, acceptance thresholds, and an operator or rollout system that edits the Route.

Header matching and weighting illustrate why Gateway API can be more portable than annotation-heavy Ingress configurations. They have API fields and conformance expectations. Other features may be **Extended**, meaning their behavior is standardized but an implementation can choose whether to support them. Before relying on rewrites, mirroring, backend TLS, or timeouts, check the controller's conformance report for the Gateway API version you run.

## How do you prove the configuration became a working route?
<!-- section-summary: Conditions explain whether the controller accepted each relationship, while a real request proves the complete data path. -->

Applying YAML proves that the Kubernetes API server accepted its shape. Controller recognition, listener creation, Route acceptance, Service resolution, and a real request each require separate evidence.

Gateway API exposes those stages through conditions. Think of them as answers from each owner boundary.

For the Gateway:

- `Accepted=True` means the controller accepts the configuration;
- `Programmed=True` means the data plane is configured for the current generation.

Its status can also publish the address assigned to that data plane:

```yaml
status:
  addresses:
    - type: IPAddress
      value: 203.0.113.10
```

The address gives the candidate endpoint for a real request. It does not by itself prove that the listener, Route, Service, and application all work.

For the payments Route's relationship to `shared-gateway`:

- `Accepted=True` means the listener attached the Route;
- `ResolvedRefs=True` means its Services, ports, filters, and required grants are valid.

Return to the cross-namespace example. The storefront Route can attach successfully while its reference to `payments/payment-api` remains unusable. While the `ReferenceGrant` is absent, the controller can report `Accepted=True` and `ResolvedRefs=False` at the same time: the entrance accepted the Route while the backend owner withheld consent for this destination.

A controller may make the reason explicit:

```text
Accepted=True
ResolvedRefs=False
Reason=RefNotPermitted
```

That combination sends the investigation to the cross-namespace grant. Reworking the Gateway listener would address a different relationship that has already been accepted.

![Gateway and HTTPRoute status conditions identify whether the listener was programmed, the Route attached, and backend references were permitted before the Service can receive traffic](/content-assets/articles/article-containers-orchestration-kubernetes-networking-gateway-api/gateway-status-conditions.png)

*Status identifies the incomplete relationship, giving you a precise diagnosis and owner.*

Inspect the chain in the same order the controller needs it:

```bash
kubectl describe gateway shared-gateway -n edge
kubectl describe httproute payments -n payments
kubectl get svc -n payments
kubectl get endpointslice -n payments
```

The combinations lead to different owners and fixes. `Accepted=True` with `Programmed=False` means the controller understands the Gateway while its load balancer or proxy remains pending. Route `Accepted=False` points to its parent, listener, namespace permission, hostname, or protocol. `Accepted=True` with `ResolvedRefs=False` points to a Service, port, filter, or ReferenceGrant. Healthy route status with zero Service endpoints means the edge is ready while the application backend remains empty.

Check `observedGeneration` too. Only a condition for the current generation proves that the controller processed the latest Route; a generation-6 condition is stale after generation 7 appears.

Listener status also reports `attachedRoutes`, the number of Routes that successfully attached through compatible `parentRefs` and `allowedRoutes`. A platform operator expecting seven application Routes can use a count of six as immediate evidence that one relationship was refused or remains unresolved.

Finally, send the request a user will send. Before changing public DNS, test a candidate address while preserving the real hostname:

```bash
curl -H 'Host: payments.example.com' \
  http://203.0.113.10/health
```

The hostname lets the HTTPRoute select the intended rule while the IP directs the request to the candidate Gateway address. Conditions prove the control relationships; the end-to-end request proves that real traffic can cross them.

## Check Your Answers
<!-- section-summary: Reconstruct Gateway API from the people, decisions, trust boundaries, and request path it represents. -->

:::expand[What is Gateway API in plain terms?]{kind="recap"}
Gateway API divides one traffic path into resources owned by the people responsible for each decision. The platform operates the shared entrance, application teams own their routing rules, and a controller turns the combined intent into a working proxy or load balancer.
:::

:::expand[Why can Ingress become awkward for several teams?]{kind="recap"}
Ingress keeps a deliberately compact HTTP routing model. When a platform team owns the listener and certificate while application teams own separate routes, or when teams need portable header matching and traffic weights, that compact object often relies on shared ownership or controller-specific extensions.
:::

:::expand[Who owns GatewayClass, Gateway, and Routes?]{kind="recap"}
An infrastructure or platform team usually owns GatewayClass because it selects the implementation. A platform operator owns Gateway because it defines the address, listeners, TLS, and attachment policy. Application teams own Routes because those resources match requests and select their Services.
:::

:::expand[How does an application earn a place on the shared Gateway?]{kind="recap"}
The Route asks to use a listener through parentRefs, while the listener independently admits Route kinds and namespaces through allowedRoutes. The hostname and protocol must also be compatible. A Route that is refused can exist in Kubernetes but receives no traffic through that listener.
:::

:::expand[Can a Route send traffic to another team's Service?]{kind="recap"}
Yes, but supported cross-namespace references require the target namespace to consent. The Service owner creates a ReferenceGrant beside the protected Service. This prevents a Route author from granting itself access to another team's backend.
:::

:::expand[How does Gateway API handle safer releases?]{kind="recap"}
An HTTPRoute can select test traffic with a header and can divide later traffic between backend Services with relative weights. The team proves the candidate first, starts with a small share, watches real evidence, and can return its weight to zero while the stable backend remains available.
:::

:::expand[How do you prove the configuration became a working route?]{kind="recap"}
Gateway Accepted and Programmed conditions prove the listener configuration. Route Accepted and ResolvedRefs prove attachment and backend references. Service endpoints prove application availability. A request using the real hostname finally proves TLS, matching, forwarding, policy, and application behavior together.
:::

## References

- [Gateway API Introduction](https://gateway-api.sigs.k8s.io/docs/introduction/) - Official overview, design goals, and relationship to Ingress.
- [Gateway API Overview](https://gateway-api.sigs.k8s.io/docs/concepts/api-overview/) - Official resource roles, attachment model, and extension points.
- [Cross-Namespace Routing](https://gateway-api.sigs.k8s.io/guides/user-guides/multiple-ns/) - Official shared-Gateway and two-sided attachment example.
- [HTTP Traffic Splitting](https://gateway-api.sigs.k8s.io/guides/user-guides/traffic-splitting/) - Official header-selected and weighted rollout examples.
- [ReferenceGrant](https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/) - Official cross-namespace consent model and security rationale.
- [Gateway API Conformance](https://gateway-api.sigs.k8s.io/docs/concepts/conformance/) - Official Core, Extended, and implementation-specific support definitions.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official Ingress scope, controller requirement, and frozen status.

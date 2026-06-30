---
title: "Gateway API"
description: "Use Gateway API resources to split shared listener ownership from application route ownership in Kubernetes."
overview: "Gateway API gives Kubernetes teams a structured way to publish HTTP traffic through shared Gateways and app-owned Routes. The api.devpolaris.local example moves from GatewayClass to Gateway, HTTPRoute, Service, TLS, status checks, and production rollout evidence."
tags: ["gateway-api", "httproute", "gateway", "routing"]
order: 4
id: article-containers-orchestration-kubernetes-networking-gateway-api
---
## Table of Contents

1. [Gateway API in One Request](#gateway-api-in-one-request)
2. [Why Ingress Started to Strain](#why-ingress-started-to-strain)
3. [The Objects That Share the Work](#the-objects-that-share-the-work)
4. [GatewayClass and the Controller](#gatewayclass-and-the-controller)
5. [A Shared Gateway for the Platform Team](#a-shared-gateway-for-the-platform-team)
6. [HTTPRoute for the Application Team](#httproute-for-the-application-team)
7. [TLS and Cross-Namespace Trust](#tls-and-cross-namespace-trust)
8. [Status Conditions Are Review Evidence](#status-conditions-are-review-evidence)
9. [Debugging a Broken Route](#debugging-a-broken-route)
10. [Rollouts and Traffic Splitting](#rollouts-and-traffic-splitting)
11. [Evidence to Keep in Pull Requests](#evidence-to-keep-in-pull-requests)
12. [References](#references)

## Gateway API in One Request
<!-- section-summary: Gateway API publishes traffic through role-focused resources, so platform teams and application teams can own different parts of one request path. -->

Gateway API is a Kubernetes API family for publishing application traffic through shared Gateways and app-owned Routes. It separates the shared edge listener from the application route, which helps platform teams and app teams work on different parts of the same traffic flow.

The example is `https://api.devpolaris.local/orders`. The platform team owns the public listener and certificate. The orders team owns the route that sends `/orders` traffic to the right Service and can later split traffic during a release.

The path moves from GatewayClass to Gateway, HTTPRoute, Service, TLS rules, status conditions, debugging, and rollout evidence. Each object has one named responsibility in a real production handoff.

A DevPolaris web app calls `https://api.devpolaris.local/orders`. A user clicks "buy", the browser reaches the public hostname, and the request needs to land on the `orders-api` Pods inside the `orders` namespace. That sounds like one simple path, and several teams care about it.

The platform networking team owns the public entry point. They care about the load balancer, the HTTPS listener, the certificate, the public hostname, and which namespaces can attach routes. The orders team owns the application route. They care that `/orders` goes to the right Service, the Service selects ready Pods, and a release can move traffic from stable to canary while other teams keep their routes unchanged.

**Gateway API** is a set of Kubernetes resources for describing this public-to-internal path. In plain English, a Gateway describes the listener at the edge, and an HTTPRoute describes which HTTP requests should go to which Service. The implementation details come later; the first idea is just public hostname, listener, route, Service, and ready Pods.

The traffic flow looks like this:

![Gateway API ownership path showing api.devpolaris.local/orders moving through GatewayClass, Gateway listener, HTTPRoute, orders Service, and ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-networking-gateway-api/gateway-ownership-path.png)

*Gateway API splits one request path into platform-owned listener work and application-owned route work.*

The diagram maps the rest of the article. One request moves from the public hostname to the Pods, and each section names which team owns the next part of the path.

Here is the same path as an ownership handoff:

| Path part | Owner | Main review question |
|---|---|---|
| `api.devpolaris.local` and HTTPS listener | Platform networking | Is the public listener programmed with the right hostname, port, certificate, and attachment rule? |
| `/orders` route | Orders team | Does the HTTPRoute attach to the listener and match the path the product exposes? |
| `orders-api` Service | Orders team | Does the Service port point to ready Pods? |
| Rollout weights | Orders team with platform visibility | Does the route send the expected share to stable and canary backends? |

That handoff is why Gateway API spends extra object names on ownership. A beginner can follow the request from left to right, while reviewers can review the same route by responsibility.

## Why Ingress Started to Strain
<!-- section-summary: Ingress still serves simple HTTP routing, while Gateway API gives teams more ownership, status, and routing structure for shared platforms. -->

**Ingress** is the older Kubernetes API for exposing HTTP and HTTPS Services outside the cluster. It maps hostnames and paths to backends, and many production clusters still run very well with it. A small team with one controller, a few hostnames, and simple path routing can keep using Ingress with no drama.

The strain shows up when one shared edge has to serve many teams. DevPolaris might place `/orders`, `/profiles`, `/billing`, and `/search` under the same `api.devpolaris.local` hostname. The platform team wants one safe public listener and one certificate policy. Each application team wants to ship route changes inside its own ownership boundary.

Ingress also pushed many advanced behaviors into controller-specific annotations. An annotation is a free-form key-value field on a Kubernetes object. Teams used annotations for rewrites, timeouts, canary traffic, authentication, and controller settings, which meant the YAML shape changed from one implementation to another.

Kubernetes documentation now recommends Gateway API for newer routing work. The same documentation says the Ingress API remains generally available and has no removal plan, while the API itself has been frozen and no longer receives feature development. That is the practical reason to learn Gateway API: new service networking design work has moved here.

So the next question is simple. If Gateway API spreads the job across several resources, what does each resource do?

## The Objects That Share the Work
<!-- section-summary: GatewayClass, Gateway, HTTPRoute, and Service each answer a different ownership question in the same traffic path. -->

Gateway API uses several resource types, and the names can blur together on the first read. The easiest way to keep them clear is to attach each object to a question from the DevPolaris request path.

The request gives every object a job. Someone has to choose the implementation, someone has to publish the listener, someone has to attach the `/orders` route, and the Service still has to point at ready Pods. Reading the objects in that order turns Gateway API from a list of resource names into a handoff between platform and application teams.

| Resource | Usual owner | What it answers |
|---|---|---|
| **GatewayClass** | Cluster platform team | Which Gateway API implementation handles this family of Gateways? |
| **Gateway** | Platform networking team | Which listeners, hostnames, ports, certificates, and route attachment rules exist? |
| **HTTPRoute** | Application team | Which HTTP requests match, and which backend Services receive them? |
| **Service** | Application team | Which stable Kubernetes backend points to the ready Pods? |

**GatewayClass** is cluster-scoped. It names the controller that handles a class of Gateways, the same way a StorageClass tells Kubernetes which storage behavior to use for volumes. A cluster needs at least one usable GatewayClass before a Gateway can serve traffic.

**Gateway** is the listener object. It describes traffic handling infrastructure such as an external load balancer or proxy listener, and it declares ports, protocols, hostnames, TLS settings, and route attachment rules. In our scenario, the Gateway is `platform-networking/public-api`, and it owns `api.devpolaris.local` on HTTPS port `443`.

**HTTPRoute** is the application routing object for HTTP traffic. It attaches to a Gateway listener, matches hostnames, paths, headers, or methods, and forwards matching requests to backend Services. In our scenario, the orders team owns an HTTPRoute that sends `/orders` traffic to the `orders-api` Service.

**Service** remains the internal backend contract. Gateway API still sends traffic to Kubernetes Services. The HTTPRoute sends traffic to a Service, and the Service sends traffic to ready Pods through its selector and EndpointSlices.

Those four objects give every pull request a cleaner shape. Platform changes touch GatewayClass and Gateway. Application route changes touch HTTPRoute and Service. Reviewers can ask for status from the object that matches the team making the change.

## GatewayClass and the Controller
<!-- section-summary: GatewayClass connects a Gateway to the installed implementation, and its Accepted condition proves that the controller understands the class. -->

A **Gateway API implementation** is the software that turns Gateway API objects into working traffic behavior. It might program a cloud load balancer, an Envoy-based proxy, a managed Kubernetes gateway, or another data plane. The Kubernetes API stores the objects, and the implementation watches those objects and makes the real network path happen.

The **GatewayClass** tells a Gateway which implementation should handle it. The class has a `controllerName`, and that value belongs to the installed controller. Platform teams usually create the class during cluster setup, then tell application teams which class backs internet-facing traffic, private traffic, or internal service traffic.

Here is a simple GatewayClass for the DevPolaris public API:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: shared-public
spec:
  controllerName: gateway.devpolaris.local/controller
```

The controller name is implementation-specific. In a real cluster, the value comes from the controller documentation and the platform team's installation notes. Many platforms also create more than one class, such as `shared-public`, `shared-private`, and `mesh-internal`, because those names describe the traffic behavior that teams can request.

The first rollout check is the class status. `kubectl get gatewayclass shared-public` should show `ACCEPTED=True`. If the class stays false or empty, the Gateway and HTTPRoute YAML can look perfect while no usable listener appears. That makes GatewayClass status the first piece of evidence for any new cluster, controller upgrade, or new traffic class.

```bash
kubectl get gatewayclass shared-public
```

```bash
NAME            CONTROLLER                              ACCEPTED   AGE
shared-public   gateway.devpolaris.local/controller     True       2d
```

Now the class exists. The platform team can use it to create the shared listener for `api.devpolaris.local`.

## A Shared Gateway for the Platform Team
<!-- section-summary: The Gateway owns the shared listener, hostname, TLS reference, and the rules for which namespaces may attach Routes. -->

A **Gateway** is the platform-owned entry point. In DevPolaris, the platform networking team creates a Gateway named `public-api` in the `platform-networking` namespace. It listens on HTTPS port `443`, accepts traffic for `api.devpolaris.local`, terminates TLS with a certificate Secret, and allows only approved namespaces to attach HTTPRoutes.

This object is where the platform team publishes the shared edge contract. Application teams need a listener name, a hostname, and a rule that says whether their namespace may attach a route. The platform team can keep load balancer internals in its own operating space, while the Gateway gives route owners one reviewed place to attach.

The Gateway names the platform-owned entry point, the GatewayClass, the HTTPS listener, the TLS Secret, and the namespace attachment rule in one object:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public-api
  namespace: platform-networking
spec:
  gatewayClassName: shared-public
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: api.devpolaris.local
      tls:
        mode: Terminate
        certificateRefs:
          - name: devpolaris-api-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              shared-gateway: public-api
```

A **listener** is the port, protocol, and hostname the Gateway accepts. TLS termination uses `devpolaris-api-tls` from the Gateway namespace. `allowedRoutes` limits cross-namespace HTTPRoute attachment to namespaces with `shared-gateway=public-api`.

The Gateway fields read as a platform contract:

- `gatewayClassName: shared-public` chooses the installed Gateway implementation.
- `listeners[].name: https` gives Routes a precise listener name to attach to.
- `protocol: HTTPS` and `port: 443` describe the edge protocol and port.
- `hostname: api.devpolaris.local` limits this listener to that host.
- `tls.mode: Terminate` says the Gateway handles HTTPS at the edge.
- `certificateRefs[].name: devpolaris-api-tls` names the TLS Secret.
- `allowedRoutes.namespaces.from: Selector` means only labeled namespaces may attach Routes.

The listener has a name, and that name matters. Application Routes can point at the `https` listener with `sectionName: https`, which keeps the relationship precise when a Gateway has more than one listener. A public Gateway might have one HTTPS listener for `api.devpolaris.local` and another listener for `admin.devpolaris.local`, so names help routes attach to the intended place.

The `allowedRoutes` block is the platform trust rule. It says that a Route from another namespace may attach only when that namespace has the label `shared-gateway=public-api`. The platform team can onboard the `orders` namespace with `kubectl label namespace orders shared-gateway=public-api`, then confirm the label with `kubectl get namespace orders --show-labels`.

This is the first half of Gateway API's cross-team handshake. The Gateway listener says which namespaces may attach. The application Route still has to choose this Gateway as its parent. Both sides need to line up before traffic can use the listener.

With the shared listener ready, the orders team can add the route for `/orders`.

## HTTPRoute for the Application Team
<!-- section-summary: HTTPRoute lets the application team attach path rules to a shared Gateway and forward matching requests to its own Service. -->

An **HTTPRoute** is the object application teams edit for HTTP routing. It names one or more parent Gateways, lists hostnames, defines matching rules, and forwards matching requests to backend Services. For the orders team, this is the normal place to review path changes, canary weights, header matches, redirects, or simple route ownership.

The route belongs to the orders team in the `orders` namespace. The traffic story is specific: requests for `api.devpolaris.local` under the `/orders` path should attach to the platform `https` listener and land on the `orders-api` Service. The route expresses that ownership without asking the orders team to edit the shared Gateway.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: orders-api
  namespace: orders
spec:
  parentRefs:
    - name: public-api
      namespace: platform-networking
      sectionName: https
  hostnames:
    - api.devpolaris.local
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /orders
      backendRefs:
        - name: orders-api
          port: 80
```

The route says that traffic for `api.devpolaris.local` with a path starting at `/orders` should go to the `orders-api` Service on port `80`. The parent reference points at the shared Gateway listener, and the backend reference points at a Service in the same `orders` namespace as the HTTPRoute.

The HTTPRoute fields carry the application team's part:

- `parentRefs[].name: public-api` attaches the Route to the shared Gateway.
- `parentRefs[].namespace: platform-networking` crosses into the platform namespace intentionally.
- `parentRefs[].sectionName: https` attaches to the named listener instead of any listener on the Gateway.
- `hostnames[]: api.devpolaris.local` limits the Route to the expected hostname.
- `matches[].path.type: PathPrefix` matches `/orders` and child paths such as `/orders/healthz`.
- `backendRefs[].name: orders-api` sends matched requests to the Service.
- `backendRefs[].port: 80` uses the Service port, not the container port.

The Service still does the Kubernetes backend work:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  type: ClusterIP
  selector:
    app: orders-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

This Service gives the route a stable backend name and port. The selector finds Pods with `app=orders-api`, and EndpointSlices record which Pod IPs are ready for traffic. A healthy HTTPRoute with an unhealthy Service path can still return errors, so route evidence and backend evidence belong together.

The Service fields complete the backend side:

- `type: ClusterIP` keeps the backend private behind the Gateway.
- `selector.app: orders-api` chooses the application Pods.
- `ports[].name: http` gives the backend Service port a stable name.
- `ports[].port: 80` is the port the HTTPRoute targets.
- `ports[].targetPort: 3000` forwards traffic to the application container.

Now the route exists. The next production concern is the encrypted edge and the permission model around references that cross namespace boundaries.

## TLS and Cross-Namespace Trust
<!-- section-summary: TLS usually belongs to the Gateway listener, and ReferenceGrant controls cross-namespace object references that need explicit permission. -->

**TLS termination** means the Gateway receives HTTPS, presents the certificate, decrypts the request at the edge, and forwards the request onward according to the Route. In this DevPolaris setup, the platform team owns TLS because it owns the public listener and hostname. The orders team owns `/orders`; certificate Secret access stays with platform networking.

Keeping TLS on the Gateway also keeps certificate ownership close to the hostname owner. The platform team can renew one certificate for `api.devpolaris.local`, while several application teams attach routes under that hostname. The orders route then focuses on HTTP matching and Service backends instead of copying certificate references into every app namespace.

The simple pattern keeps the TLS Secret in the same namespace as the Gateway. The TLS part is the same listener snippet from the shared Gateway:

```yaml
tls:
  mode: Terminate
  certificateRefs:
    - name: devpolaris-api-tls
```

In that shape, `platform-networking/devpolaris-api-tls` contains the certificate and private key. cert-manager can create and renew that Secret by watching annotations on the Gateway, depending on how the cluster team configures issuers. The rollout evidence should show both the Gateway status and the certificate material because a listener can exist while certificate automation still has work to do.

| Evidence | Healthy signal |
|---|---|
| `kubectl -n platform-networking get secret devpolaris-api-tls` | Secret type is `kubernetes.io/tls` and has certificate data |
| `kubectl -n platform-networking get certificate devpolaris-api-tls` | Certificate shows `READY=True` when cert-manager owns renewal |

Gateway API also has **ReferenceGrant** for cross-namespace references. A ReferenceGrant is a namespaced object created by the owner of the target namespace. It gives specific kinds of objects in another namespace permission to reference target resources in this namespace.

Route-to-Gateway attachment across namespaces uses the Gateway listener's `allowedRoutes` rule. Other cross-namespace references usually need ReferenceGrant. For example, if an HTTPRoute in `orders` forwards to a Service in `shared-search`, then the `shared-search` owner must create a grant in the `shared-search` namespace:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: ReferenceGrant
metadata:
  name: allow-orders-routes
  namespace: shared-search
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: orders
  to:
    - group: ""
      kind: Service
```

This rule keeps namespace ownership clear. The orders team can ask to use a shared backend, and the shared backend owner makes the permission decision. That explicit grant prevents one namespace from quietly pointing production traffic at another namespace's Service.

At this point, we have the class, listener, route, Service, TLS, and trust rules. Gateway API gives us one more useful tool: structured status conditions that show where the relationship actually worked.

## Status Conditions Are Review Evidence
<!-- section-summary: Gateway API status conditions show whether the class, listener, route attachment, references, and backend relationship were accepted. -->

A **status condition** is a structured result that controllers write back onto Kubernetes objects. It usually has a type, a true or false status, a reason, and a message. Instead of treating every failed request as "the Gateway is broken", teams can inspect the first false condition and start in the right layer.

Status is especially valuable in Gateway API because several objects have to agree. The class must be accepted, the listener must be programmed, the Route must attach to the right parent, and backend references must resolve. A pull request review should include those controller-written results, because they prove more than the desired YAML alone.

The platform team starts with `kubectl -n platform-networking get gateway public-api -o yaml`, and the orders team checks `kubectl -n orders get httproute orders-api -o yaml`. The useful fields are these:

| Object | Condition or field | Healthy meaning |
|---|---|---|
| Gateway | `addresses` | The implementation reports the public load balancer address |
| Gateway | `Accepted=True` | The controller accepted the Gateway configuration |
| Gateway | `Programmed=True` | The implementation programmed the data plane or load balancer |
| Listener `https` | `attachedRoutes: 1` | At least one Route attached to this listener |
| Listener `https` | `ResolvedRefs=True` | Listener references such as TLS material resolved |
| HTTPRoute parent | `Accepted=True` | The Route attached to `platform-networking/public-api` listener `https` |
| HTTPRoute parent | `ResolvedRefs=True` | Backend Services and permitted references resolved |

Route status appears under `parents` because one Route can attach to more than one parent. In this example, the parent is the `https` listener on `platform-networking/public-api`. Those conditions show whether the platform side and application side agree about the route.

A healthy Gateway status may look like this:

```yaml
status:
  addresses:
    - type: IPAddress
      value: 203.0.113.40
  listeners:
    - name: https
      attachedRoutes: 1
      conditions:
        - type: Accepted
          status: "True"
          reason: Accepted
        - type: Programmed
          status: "True"
          reason: Programmed
        - type: ResolvedRefs
          status: "True"
          reason: ResolvedRefs
```

A healthy HTTPRoute parent status may look like this:

```yaml
status:
  parents:
    - parentRef:
        name: public-api
        namespace: platform-networking
        sectionName: https
      conditions:
        - type: Accepted
          status: "True"
          reason: Accepted
        - type: ResolvedRefs
          status: "True"
          reason: ResolvedRefs
```

`Accepted=True` means the controller accepted the object or attachment. `Programmed=True` means the controller reports that it pushed the listener into the data plane or load balancer. `ResolvedRefs=True` means referenced objects such as Services, listener sections, or TLS material were found and allowed. `BackendNotFound` is a common false reason for `ResolvedRefs`; it means the Route attached to the Gateway, but the backend Service name, namespace permission, or Service port did not resolve.

For a pull request, these conditions are stronger than a screenshot of YAML. They show what the controller actually accepted after it reconciled the objects. A reviewer can see whether the platform side and application side agree about the route.

![Gateway API status board showing Gateway Accepted and Programmed conditions, HTTPRoute Accepted and ResolvedRefs conditions, and failure reasons like NotAllowedByListeners and BackendNotFound](/content-assets/articles/article-containers-orchestration-kubernetes-networking-gateway-api/gateway-status-conditions.png)

*Gateway API status conditions point to the first failed relationship, which keeps debugging tied to the object that actually needs attention.*

The same conditions also guide debugging when the request fails.

## Debugging a Broken Route
<!-- section-summary: Gateway API debugging follows the first failed condition, then checks Service endpoints and the application response. -->

Gateway API debugging should follow the traffic flow in order: GatewayClass, Gateway, HTTPRoute, Service, and then Pods. That order keeps a platform policy failure from getting mixed up with an application readiness problem.

The first failed condition should decide the owner of the next action. A rejected GatewayClass points to platform setup. A blocked Route attachment points to listener policy or namespace labels. A backend reference failure points to the application Service name, Service port, or cross-namespace permission. That is the reason this section starts with status and then moves toward endpoints.

| Failure class | Common signal | What the signal means |
|---|---|---|
| GatewayClass missing or rejected | `kubectl get gatewayclass shared-public` shows `ACCEPTED=False` or no class | The controller class is unavailable, so route edits in `orders` cannot create a listener |
| Route attachment blocked | HTTPRoute condition has `Accepted=False` and reason `NotAllowedByListeners` | The Gateway listener policy or namespace label blocks the Route |
| Backend reference missing | HTTPRoute condition has `ResolvedRefs=False` and reason `BackendNotFound` | The Route attached, but the backend Service name, port, grant, or reference is wrong |
| Backend has no ready endpoints | Service exists, but EndpointSlices are empty or Pods are unready | The edge can route, but the application has no ready backend |
| Real URL still fails | `curl -i https://api.devpolaris.local/orders/healthz` returns a non-200 response | The team should compare Gateway status, route status, endpoint readiness, and app logs |

Those signals also tell teams who should take the next action. GatewayClass and Gateway failures usually point to platform networking. HTTPRoute and Service failures usually point to the application team. Endpoint and Pod failures move into workload health.

Once the route is healthy, the next production question is how to make route changes gradually instead of sending every release through one all-or-nothing switch.

## Rollouts and Traffic Splitting
<!-- section-summary: HTTPRoute can express weighted backends for gradual rollouts, while implementation support and rollback evidence still need review. -->

Gateway API can express richer HTTP routing than a basic host-and-path rule. One practical feature is weighted backends. A weighted backend lets one HTTPRoute send most traffic to the stable Service and a small slice to a canary Service, which helps a team test a new version with real production traffic.

For the DevPolaris orders API, the stable Service might point at version `v1`, while the canary Service points at version `v2`. The Route can send 90 percent of matching traffic to stable and 10 percent to canary:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: orders-api
  namespace: orders
spec:
  parentRefs:
    - name: public-api
      namespace: platform-networking
      sectionName: https
  hostnames:
    - api.devpolaris.local
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /orders
      backendRefs:
        - name: orders-api
          port: 80
          weight: 90
        - name: orders-api-canary
          port: 80
          weight: 10
```

This rollout still needs the same evidence as the simple route. Both Services need ready endpoints, the HTTPRoute conditions should stay true, and metrics or access logs should show traffic reaching both versions. The rollback is a small route change: set the canary weight to `0`, restore the stable Service to `100`, or remove the canary backend reference.

Some Gateway API features depend on the implementation and its conformance profile. Core matching and backend routing form the portable center, while details around timeouts, retries, header filters, mirroring, policy attachment, or vendor-specific behavior may vary. A production design review should name the installed implementation and confirm that it supports the fields the team plans to use.

The YAML file is only the request. The controller status tells you whether the installed implementation accepted the request, so the rollout process should always include both.

## Evidence to Keep in Pull Requests
<!-- section-summary: Gateway API changes should keep platform evidence, application evidence, backend evidence, and one real request in the review. -->

A Gateway API pull request should leave a short evidence trail. The platform part proves that the shared entry point exists and has been programmed. The application part proves that the Route attached, the references resolved, the backend has endpoints, and the real URL works.

For the orders route, the evidence record should read like the production path. It should name the host, Gateway, listener, Route, Service, expected health URL, and the team ownership boundaries. That record helps reviewers understand the change without reconstructing the request path from several YAML files.

Here is a compact record for the DevPolaris orders route:

```yaml
gatewayApiChangeRecord:
  host: api.devpolaris.local
  platformNamespace: platform-networking
  gatewayClass: shared-public
  gateway: public-api
  listener: https
  applicationNamespace: orders
  route: orders-api
  service: orders-api
  path: /orders
  expectedHealthResponse: HTTP 200 from /orders/healthz
  platformOwns: listener, hostname, TLS Secret, allowedRoutes
  applicationOwns: HTTPRoute, Service, Pods, canary weights
```

![Gateway API pull request evidence board with Gateway programmed, Route attached, references resolved, Service endpoints, HTTP 200, stable 90 percent, canary 10 percent, and rollback to stable 100 percent](/content-assets/articles/article-containers-orchestration-kubernetes-networking-gateway-api/gateway-rollout-evidence-summary.png)

*A Gateway API change review should preserve both ownership evidence and one real request through the published route.*

The platform evidence should show the class, Gateway address, programmed listener, certificate Secret, and certificate readiness when cert-manager manages TLS. The application evidence should show Route attachment, reference resolution, Service shape, endpoint readiness, and one real response from the published path.

| Evidence group | Commands to keep in the review |
|---|---|
| Platform listener | `kubectl get gatewayclass shared-public`, `kubectl -n platform-networking get gateway public-api -o yaml` |
| TLS | `kubectl -n platform-networking get secret devpolaris-api-tls`, `kubectl -n platform-networking get certificate devpolaris-api-tls` |
| Application route | `kubectl -n orders get httproute orders-api -o yaml` |
| Backend readiness | `kubectl -n orders get svc orders-api -o wide`, `kubectl -n orders get endpointslice -l kubernetes.io/service-name=orders-api` |
| Real request | `curl -i https://api.devpolaris.local/orders/healthz` |

This evidence turns Gateway API from "more YAML" into a clear operating model. Platform teams own the shared listener and trust boundaries. Application teams own their routes and backends. Status conditions connect both sides, and one real request proves the path from hostname to Pod.

## References

- [Gateway API - Kubernetes](https://kubernetes.io/docs/concepts/services-networking/gateway/) - Introduces Gateway API as an extensible, role-oriented, protocol-aware service networking API family.
- [API overview - Gateway API](https://gateway-api.sigs.k8s.io/docs/concepts/api-overview/) - Explains GatewayClass, Gateway, listeners, Routes, and the relationship between the core resources.
- [GatewayClass - Gateway API](https://gateway-api.sigs.k8s.io/reference/api-types/gatewayclass/) - Documents GatewayClass scope, controller selection, and Accepted status.
- [HTTPRoute - Gateway API](https://gateway-api.sigs.k8s.io/reference/api-types/httproute/) - Documents parentRefs, hostnames, rules, matches, filters, backendRefs, and route status.
- [ReferenceGrant - Gateway API](https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/) - Documents explicit permission for cross-namespace references such as Route-to-Service and Gateway-to-Secret references.
- [Ingress controllers - Kubernetes](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/) - Notes that Kubernetes recommends Gateway for newer work while Ingress remains generally available and frozen.
- [Service - Kubernetes](https://kubernetes.io/docs/concepts/services-networking/service/) - Explains Services as stable backend abstractions for Pods.
- [Annotated Gateway resource - cert-manager](https://cert-manager.io/docs/usage/gateway/) - Documents cert-manager certificate automation for annotated Gateway resources.

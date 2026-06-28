---
title: "What Is a Service Mesh"
description: "Understand how a service mesh adds managed proxies, shared traffic rules, security, and observability to Kubernetes service-to-service communication."
overview: "An online store with web, checkout, and inventory services is enough to see why teams add a mesh. You will install Istio, a Kubernetes service mesh, enable sidecar proxy injection, verify injected Pods, and trace how requests move through proxies before the next article turns that path into traffic control."
tags: ["kubernetes", "service-mesh", "istio", "sidecar"]
order: 1
id: article-containers-orchestration-kubernetes-service-mesh-what-is-a-service-mesh
---

## Table of Contents

1. [The Whole Picture First](#the-whole-picture-first)
2. [Kubernetes Communication Before the Mesh](#kubernetes-communication-before-the-mesh)
3. [What the Mesh Adds](#what-the-mesh-adds)
4. [Data Plane and Control Plane](#data-plane-and-control-plane)
5. [Sidecar Proxies and Admission Webhooks](#sidecar-proxies-and-admission-webhooks)
6. [Installing Istio for a First Look](#installing-istio-for-a-first-look)
7. [Enabling Injection for the Store Namespace](#enabling-injection-for-the-store-namespace)
8. [How Traffic Interception Works](#how-traffic-interception-works)
9. [Verifying the Mesh Path With Curl](#verifying-the-mesh-path-with-curl)
10. [Production Gotchas](#production-gotchas)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Whole Picture First
<!-- section-summary: A service mesh puts managed proxies on the request path so teams can control service-to-service traffic while application code stays focused on business logic. -->

A familiar request path is enough to start. Service A calls service B over HTTP. In the online store, the `web` service receives a customer request and calls `checkout` at `http://checkout:8080`. Then `checkout` calls `inventory` to check stock. At this point, nothing sounds special. One service sends an HTTP request, another service returns an HTTP response.

That simple path gets harder as the store grows. A checkout release may need 5% of traffic before the team trusts it with every order. A slow inventory response needs a timeout so `checkout` does not wait forever. A temporary network error may deserve one careful retry, while an overloaded service needs protection from too many retries. The security team also wants encrypted service-to-service traffic, a real caller identity, and access rules so a reporting job cannot call payment endpoints. The on-call team wants proxy logs and request metrics, and the platform team has to budget the extra CPU and memory used by the network layer.

A **proxy** is a network helper that receives traffic for an application, applies rules, and forwards the traffic to the next place. In the store, a proxy can sit beside `checkout`, see the request to `inventory`, record a log line, apply a timeout, and forward the request. A **service mesh** is a platform layer that manages those service-to-service proxies across many workloads. The application still sends normal HTTP, gRPC, or TCP requests, while the mesh gives the platform team one consistent place to manage traffic policy, encryption, identity, access control, observability, and reliability behavior.

One naming detail helps before the article gets busy. A lowercase service means one application capability, such as checkout or inventory. A capital-S **Kubernetes Service** means the cluster object named `checkout` that callers use as a stable target. The distinction is useful because the store application teams talk about services as business pieces, while the cluster uses Service objects so those pieces can find each other by name.

Keep the first picture small. Kubernetes already gives us Services and DNS, so one service can find another. A mesh builds on that base by putting managed proxies on the path. Once the proxies are on the path, a platform team can give them shared rules for routing, waiting limits, encryption, caller identity, access checks, and telemetry. The later sections name the Istio pieces that make this work.

![Service mesh big picture infographic showing web, checkout, and inventory Pods using Envoy sidecars while istiod pushes configuration above the Kubernetes Services and DNS layer](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-what-is-a-service-mesh/mesh-service-request-path.png)

*The mesh keeps the familiar Kubernetes Service names, then places Envoy sidecars on the request path so traffic policy, mTLS, and telemetry can be handled consistently.*

## Kubernetes Communication Before the Mesh
<!-- section-summary: Kubernetes networking gives applications stable names, while the application still owns most reliability behavior. -->

In the store, `web` calls the `checkout` Service by DNS name, and Kubernetes sends the request toward one of the ready checkout Pods behind that Service. That layer answers the first question for the store: where should a caller send traffic for `checkout` right now?

Before the mesh, the request is still ordinary HTTP from application code to a Kubernetes Service name. Application code keeps using familiar names such as `http://checkout:8080`, and Kubernetes keeps updating the backend list as Pods appear, disappear, and become ready.

The remaining behavior still needs a home: how long `web` should wait when `checkout` is slow, whether the call should be retried, whether traffic should shift gradually to `checkout-v2`, and whether service-to-service traffic should be encrypted. Application teams often add those behaviors inside each service with HTTP client libraries, shared SDKs, or framework middleware. That can work for a small system, and it gets messy when every team configures the same network behavior in a slightly different way.

The online store makes the pain easy to see. If `inventory` slows down during a flash sale, `checkout` may hold open too many requests. If `web` retries too aggressively, it may create even more load on `checkout`. If you release a new `checkout` version, you may want 5% of traffic to test it before sending every customer through it. Kubernetes Services give you the stable address. The mesh adds a shared traffic layer around that address.

## What the Mesh Adds
<!-- section-summary: The mesh gives platform-owned traffic behavior to services that still call each other using normal Kubernetes names. -->

**Istio** is a popular open source service mesh for Kubernetes. It gives platform teams APIs and control-plane components for traffic management, security, and observability. **Envoy** is the open source proxy Istio commonly places on the request path. Envoy understands common service protocols such as HTTP and gRPC, so it can collect useful request data, enforce security settings, and forward traffic with mesh policy attached.

In Istio **sidecar mode**, each application Pod receives an Envoy proxy container beside the application container. The application still says, "call `checkout`" or "call `inventory`." The proxy handles the extra work around that call: collecting metrics, applying routing rules, enforcing security policy, and forwarding the request to the right destination. For the store team, that means the checkout code can keep using normal Kubernetes Service names while the platform adds shared network behavior around the call.

Think about the store's checkout path during a real release. The team ships `checkout-v2`, but the old `checkout-v1` is still serving most orders. The product manager wants a small canary, the SRE wants a timeout so requests have a clear limit, and the security team wants service-to-service encryption. If each team owns that behavior separately, those requirements often end up as application code, load balancer configuration, or one-off scripts. With a mesh, those requirements can be expressed as platform configuration that the proxies enforce.

The mesh keeps application design important. `checkout` still needs useful error handling, idempotent order creation, and clear health checks. The value of the mesh is that common network concerns move into one consistent layer. Teams can still use normal Kubernetes Services while the platform controls the traffic around those Services.

This is why service mesh discussions usually start with two halves: the proxies that touch traffic and the system that configures those proxies. Those two halves are called the data plane and the control plane.

## Data Plane and Control Plane
<!-- section-summary: The data plane carries requests, while the control plane watches cluster state and distributes proxy configuration. -->

The **data plane** is the set of proxies that handles real application traffic. In Istio sidecar mode, those proxies are Envoy containers injected into application Pods. A request from `web` to `checkout` passes through a proxy near `web`, then a proxy near `checkout`, and then reaches the `checkout` application container. These proxies are the only Istio components on the normal request path.

The **control plane** is the management layer that configures the data plane. Istio's main control-plane process is **`istiod`**. It watches Services, Pods, EndpointSlices, and Istio traffic configuration, then translates that state into proxy configuration and sends the result to Envoy proxies.

For the store, `istiod` notices that there is a `checkout` Service with healthy Pods behind it because Kubernetes publishes that information through Services, Pods, and EndpointSlices. It also notices any traffic rules you later create, such as sending 90% of requests to `checkout-v1` and 10% to `checkout-v2`. The proxies receive that configuration and apply it to live traffic. Customer requests stay in the data plane; `istiod` handles configuration, discovery data, certificates, and policy distribution.

This split is important in production. If the control plane has a problem, existing proxies may continue using their last known configuration for a while, but new configuration changes and new proxy connections are affected. If a data plane proxy has a problem, the local workload's traffic can be affected directly. Real teams monitor both halves because they fail in different ways and create different symptoms.

## Sidecar Proxies and Admission Webhooks
<!-- section-summary: In sidecar mode, Istio uses Kubernetes admission to add an Envoy proxy to new Pods in selected namespaces. -->

A **sidecar proxy** is a proxy container that runs beside your application container in the same Pod. In Istio sidecar mode, that sidecar is usually an Envoy container named `istio-proxy`. The word sidecar is specific here: the proxy shares the Pod's network namespace with the application. That means the application container and the proxy container share the same Pod IP address and can communicate over local networking inside the Pod.

In our store, a normal `checkout` Pod might start with one container:

```bash
$ kubectl get pods -n store -l app=checkout
NAME                        READY   STATUS    RESTARTS   AGE
checkout-66b7d9c7d8-px9mv   1/1     Running   0          45s
```

After sidecar injection, a newly created `checkout` Pod has two containers:

```bash
$ kubectl get pods -n store -l app=checkout
NAME                        READY   STATUS    RESTARTS   AGE
checkout-7d8b8f9b6f-m44qk   2/2     Running   0          28s
```

The extra ready container is usually `istio-proxy`, which runs Envoy. The application Deployment YAML often still lists only the application container. Automatic injection happens when the Pod is created, which is why `kubectl get deployment` may still show one application container while `kubectl get pod` shows two running containers.

An **admission webhook** is a Kubernetes callback that runs while the API server is accepting a new or changed object. A **mutating webhook** is the type of admission webhook that can edit the object before Kubernetes stores it. Istio registers a mutating webhook that says, "for Pods matching the injection policy, add the proxy container, volumes, environment variables, and startup pieces needed for the mesh." In the store, that is how a normal `checkout` Pod spec turns into a running Pod with both the checkout app and `istio-proxy`.

That also explains a common surprise: the namespace label affects Pod creation time. The webhook acts while Kubernetes accepts a new Pod. Existing `web`, `checkout`, and `inventory` Pods need a rollout restart or replacement before they receive sidecars.

![Istio sidecar injection flow infographic showing a namespace label, Pod creation, mutating webhook, app plus istio-proxy container, and 2/2 ready Pods after restart](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-what-is-a-service-mesh/sidecar-injection-flow.png)

*Injection is a Pod creation-time change. The namespace label prepares the rule, the webhook adds the proxy, and a rollout creates the new two-container Pods.*

## Installing Istio for a First Look
<!-- section-summary: A small Istio install gives you the control plane first, then application Pods join the mesh when injection is enabled. -->

For a first hands-on look, you need a Kubernetes cluster and **`istioctl`**, Istio's command-line tool. You run `istioctl` from your terminal to install Istio resources, inspect mesh configuration, and ask Istio diagnostic questions. The examples below use Istio's default profile, which keeps the first install small and close to a production starting point.

```bash
$ istioctl install -y

✔ Istio core installed
✔ Istiod installed
✔ Installation complete
Made this installation the default for injection and validation.
```

The command creates the Istio control plane resources, usually in the `istio-system` namespace. The next check confirms that the main control plane Pod is running before we bring application traffic into the mesh.

```bash
$ kubectl get pods -n istio-system

NAME                      READY   STATUS    RESTARTS   AGE
istiod-7f58d6d77b-q9wzp   1/1     Running   0          90s
```

Some learning guides use the larger `demo` profile because it turns on more features for exploration. Many production teams prefer an `IstioOperator` YAML file or Helm values checked into Git so the install is reviewable and repeatable. For a beginner, the practical order is to install the control plane first, then choose which namespaces or workloads join the mesh.

For our store, keep the application in a dedicated namespace. That keeps the example clean and mirrors production practice, where teams usually onboard namespaces intentionally instead of turning injection on for the whole cluster at once.

```bash
$ kubectl create namespace store
namespace/store created
```

## Enabling Injection for the Store Namespace
<!-- section-summary: Namespace injection labels tell Istio which new Pods should receive sidecar proxies. -->

To enable automatic sidecar injection for new Pods in the store namespace, add the Istio injection label. Istio's webhook uses that namespace label as a simple onboarding signal. In the store, this lets the platform team bring `web`, `checkout`, and `inventory` into the mesh together without editing each Deployment manifest first.

```bash
$ kubectl label namespace store istio-injection=enabled --overwrite
namespace/store labeled
```

You can check the namespace label directly:

```bash
$ kubectl get namespace store -L istio-injection

NAME    STATUS   AGE   ISTIO-INJECTION
store   Active   2m    enabled
```

Before restarting workloads, it is useful to ask Istio whether injection will happen. The `istioctl experimental check-inject` command checks the matching webhooks and explains the reason. It helps catch label or revision mistakes before you wait for a rollout.

```bash
$ istioctl experimental check-inject -n store deploy/web

WEBHOOK                    REVISION  INJECTED  REASON
istio-sidecar-injector     default   ✔         Namespace label istio-injection=enabled matches
```

Now restart the store Deployments so Kubernetes creates fresh Pods and the webhook can mutate them:

```bash
$ kubectl rollout restart deployment/web deployment/checkout deployment/inventory -n store
deployment.apps/web restarted
deployment.apps/checkout restarted
deployment.apps/inventory restarted
```

Then verify that the new Pods show `2/2` containers ready:

```bash
$ kubectl get pods -n store

NAME                         READY   STATUS    RESTARTS   AGE
web-74db7d9c96-ppx7m         2/2     Running   0          34s
checkout-7d8b8f9b6f-m44qk    2/2     Running   0          33s
inventory-56f8d84b7c-nnb8c   2/2     Running   0          32s
```

That `2/2` output is the first visible sign that the data plane has reached your application Pods. The next question is what those proxies actually do with traffic.

## How Traffic Interception Works
<!-- section-summary: Traffic interception redirects configured inbound and outbound traffic through the local proxy so the mesh can apply policy. -->

**Traffic interception** means the Pod's network rules redirect application traffic through the local proxy. When `checkout` opens a connection to `inventory`, the `checkout` application thinks it is making a normal outbound call. Inside the Pod, networking rules send that connection through `istio-proxy` first. The proxy applies mesh behavior, chooses the destination, and forwards the request.

In classic Istio sidecar mode, a small init container named `istio-init` often sets up these network rules before the application starts. It configures Linux packet redirection so inbound and outbound TCP traffic can pass through Envoy. You may see this in a described Pod:

```bash
$ kubectl describe pod -n store -l app=checkout

Init Containers:
  istio-init:
    Image: docker.io/istio/proxyv2:...
Containers:
  checkout:
    Image: ghcr.io/example/store-checkout:...
  istio-proxy:
    Image: docker.io/istio/proxyv2:...
```

Many production clusters use **Istio CNI** instead. CNI stands for Container Network Interface, which is the plugin system Kubernetes uses when it sets up Pod networking on a node. With Istio CNI, a privileged node-level agent handles the traffic redirection setup, so application Pods can avoid a privileged `istio-init` container for that job. This helps restricted store clusters where security policy blocks application Pods from using capabilities such as `NET_ADMIN`.

Across those setup styles, the proxy must be on the path. Once `checkout` traffic flows through Envoy, the mesh can collect request metrics, apply encrypted service-to-service traffic, use service discovery data, and later enforce routing rules. Without traffic interception, the proxy would just sit beside the app while the app talked directly to the network.

Istio also has **ambient mode**, which is another way to run the mesh data plane. Ambient mode uses a per-node Layer 4 proxy for base mesh traffic and can add waypoint proxies when a workload needs Layer 7 behavior such as HTTP routing policy. For the store, ambient mode would let a platform team choose a mesh shape with fewer per-Pod proxy containers, while this article stays with sidecar mode because the app container and Envoy container are easy to see together inside one Pod.

## Verifying the Mesh Path With Curl
<!-- section-summary: A small curl Pod and a service-to-service request can confirm that DNS, Services, Pods, and sidecars are working together. -->

After injection, verify the path with something small before you start writing traffic policy. A simple curl Pod gives you a client inside the same namespace as the store services. Because the namespace is labeled for injection, this test Pod should also receive an Istio sidecar.

```bash
$ kubectl run mesh-curl -n store \
  --image=curlimages/curl \
  --restart=Never \
  --command -- sleep 1h

pod/mesh-curl created
```

Check that the curl Pod has both containers:

```bash
$ kubectl get pod -n store mesh-curl

NAME        READY   STATUS    RESTARTS   AGE
mesh-curl   2/2     Running   0          20s
```

Now make a request to the `web` Service by Kubernetes DNS name:

```bash
$ kubectl exec -n store mesh-curl -c mesh-curl -- \
  curl -sS http://web.store.svc.cluster.local:8080/health

ok
```

You can also test the internal call at the center of the example, from `web` toward `checkout` or from `checkout` toward `inventory`:

```bash
$ kubectl exec -n store deploy/web -c web -- \
  curl -sS http://checkout:8080/health

ok
```

These tests confirm several layers at once. Kubernetes DNS resolves the Service name, the Service selects healthy Pods, the application container can make the request, and the sidecar is present on the Pod. If this basic call fails, fix the Service selector, port, DNS name, container health, or injection state before adding routing rules.

In production, teams usually add stronger verification. They check proxy readiness, inspect sidecar logs, run `istioctl proxy-status`, and look at dashboards such as Prometheus, Grafana, or Kiali. Those tools are useful, but the small curl test is still valuable because it proves the simplest request path before you debug a more advanced mesh feature.

## Production Gotchas
<!-- section-summary: Most early mesh problems come from injection timing, namespace labels, security restrictions, port naming, and direct Pod IP calls. -->

The first gotcha is injection timing. The namespace label affects new Pods. If `web`, `checkout`, and `inventory` were already running before the label was added, they keep their original one-container shape until a rollout creates replacement Pods. When a team says "the namespace is labeled but my Pod is still `1/1`," the usual answer is to restart the Deployment and then check the new Pod.

The second gotcha is conflicting injection policy. Istio can use `istio-injection=enabled`, revision labels such as `istio.io/rev=canary`, and per-Pod labels such as `sidecar.istio.io/inject`. Mixed labels can produce surprising results during upgrades or canary control-plane rollouts. `istioctl experimental check-inject` is useful because it reports which webhook matched and why.

The third gotcha is cluster security. Classic sidecar traffic redirection may require an init container with networking capabilities. Restricted clusters often prefer Istio CNI so the privileged networking work lives in a node agent instead of every application Pod. This is one of those details that should be decided with the platform team before onboarding production namespaces.

The fourth gotcha is Service port naming and protocol detection. Istio can proxy TCP traffic, and it can automatically detect common HTTP traffic, but richer HTTP routing and metrics depend on the proxy understanding the protocol. Naming Service ports clearly, such as `http`, `http-web`, `grpc`, or `tcp-metrics`, helps the mesh treat traffic correctly later.

The fifth gotcha is direct Pod IP traffic. Mesh traffic features are designed around Services and the proxy's service discovery view. If application code calls a Pod IP directly, later routing rules and telemetry may miss important context. In the store, `web` should call `checkout` through the `checkout` Service, and `checkout` should call `inventory` through the `inventory` Service.

The final gotcha is cost. Every proxy uses CPU and memory, every injected Pod has more startup pieces, and every mesh upgrade has to account for both the control plane and the data plane. Real teams use a mesh when the shared traffic, security, and observability value is worth that operational cost. For a three-service toy app, the mesh may look like extra machinery. For a production platform with dozens of teams and hundreds of services, the consistent control point can be worth it.

## Putting It All Together
<!-- section-summary: A mesh starts with normal Kubernetes Services, adds proxies to the traffic path, and uses the control plane to configure those proxies. -->

Let's connect the store flow from the beginning. The Kubernetes networking layer gives `web`, `checkout`, and `inventory` stable Service names. `web` can call `checkout`, and `checkout` can call `inventory`, even though individual Pods are replaced during rollouts. That base layer is the prerequisite this module builds on.

Istio adds the mesh layer. The control plane, `istiod`, watches Kubernetes and Istio configuration. The data plane, made of Envoy proxies, handles requests. In sidecar mode, the Envoy proxy runs in each application Pod as `istio-proxy`.

Automatic injection uses a Kubernetes mutating admission webhook. You label the `store` namespace, create or restart Pods, and the webhook adds the proxy pieces to new Pods. `kubectl get pods -n store` showing `2/2` tells you each application Pod has both the app container and the proxy container ready.

Traffic interception puts the proxy on the path. A call from `checkout` to `inventory` moves through the local proxy, across the network, through the destination proxy, and then to the inventory application. The application code still uses ordinary HTTP clients and Kubernetes DNS names, but the platform now has a place to apply shared behavior.

![Service mesh foundation summary infographic showing Service name, sidecar injection, proxy on path, istiod config, and shared traffic, security, and observability behavior](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-what-is-a-service-mesh/mesh-foundation-summary.png)

*The foundation is a sequence: keep the Service contract, add sidecars, put proxies on the path, and let the control plane distribute shared behavior.*

That is the reason service meshes matter. They turn service-to-service networking from scattered application behavior into a managed platform layer. The next step is to use that layer for traffic control.

## What's Next

Now that the proxies are on the request path, the store has a new capability. The platform can tell those proxies how to handle traffic while the `web`, `checkout`, and `inventory` code stays the same.

The next article moves from "what is the mesh?" to "what can the mesh do?" We will use routing, retries, timeouts, and canaries so `checkout-v2` can receive a small slice of traffic, slow calls can fail cleanly, and production rollouts can happen with more control.

---

**References**

- [Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) - Defines Istio's control plane and data plane, including Envoy sidecars and `istiod`.
- [Istio Sidecar or Ambient](https://istio.io/latest/docs/overview/dataplane-modes/) - Explains the sidecar and ambient data plane modes.
- [Istio Install with Istioctl](https://istio.io/latest/docs/setup/install/istioctl/) - Documents `istioctl install`, profiles, and install customization.
- [Istio Installing the Sidecar](https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/) - Documents automatic sidecar injection, namespace labels, and webhook behavior.
- [Istio Check-Inject](https://istio.io/latest/docs/ops/diagnostic-tools/check-inject/) - Documents `istioctl experimental check-inject` for injection diagnostics.
- [Istio CNI Node Agent](https://istio.io/latest/docs/setup/additional-setup/cni/) - Explains CNI-based traffic redirection and the relationship to privileged init containers.
- [Istio Application Requirements](https://istio.io/latest/docs/ops/deployment/application-requirements/) - Covers sidecar-related Pod requirements, Istio ports, outbound traffic, and Service usage.
- [Istio Protocol Selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) - Explains protocol detection and explicit Service port naming.
- [Envoy: What Is Envoy](https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy) - Defines Envoy as a proxy designed for modern service-oriented architectures.
- [Kubernetes EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Explains how Kubernetes tracks subsets of Service backend endpoints.
- [Kubernetes Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) - Explains admission webhooks and mutating admission webhooks.
- [Kubernetes Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/) - Defines sidecar containers and how they run alongside application containers in a Pod.

---
title: "Operating a Mesh"
description: "Operate a service mesh by budgeting proxy cost, reading proxy request logs, checking proxy configuration sync, fixing startup races, and rolling mesh changes safely."
overview: "A mesh adds a proxy beside each workload, so production debugging includes the application container and the proxy sidecar. This article follows an online store through proxy resource planning, 503 debugging, startup reliability, configuration scoping, and canary mesh upgrades."
tags: ["kubernetes", "service-mesh", "operations", "debugging"]
order: 4
id: article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh
---

## Table of Contents

1. [The Production Shape](#the-production-shape)
2. [Proxy Overhead](#proxy-overhead)
3. [Budgeting Sidecar Resources](#budgeting-sidecar-resources)
4. [Access Logs and Response Flags](#access-logs-and-response-flags)
5. [Checking xDS and Proxy Sync](#checking-xds-and-proxy-sync)
6. [Proxy Readiness and Startup Races](#proxy-readiness-and-startup-races)
7. [Configuration Scoping](#configuration-scoping)
8. [Canary Upgrades of the Mesh](#canary-upgrades-of-the-mesh)
9. [A Small Operating Runbook](#a-small-operating-runbook)
10. [Common Gotchas](#common-gotchas)
11. [Putting It All Together](#putting-it-all-together)

## The Production Shape
<!-- section-summary: A mesh changes daily operations because every service now depends on both application behavior and proxy behavior. -->

The online store now handles real customer traffic. The `web` service receives browser requests, `checkout` creates orders, `inventory` confirms stock, and `payments` authorizes cards. A `checkout` Pod contains the `checkout` app plus an `istio-proxy` container, and every production request has two moving parts: the application that owns the business logic and the proxy that owns much of the network path.

That sidecar proxy changes operations because a failed request can now involve application code, Kubernetes readiness, proxy resources, proxy configuration, or the Istio control plane. This article is structured like a normal on-call shift for that store. First we budget **proxy overhead**, which means the CPU, memory, and latency added by each sidecar proxy. Then we turn on **access logs**, which are per-request records written by Envoy, and we read **response flags**, the short Envoy codes that explain why a request failed. After that we check **xDS/control-plane sync**, which is the flow where the Istio control-plane process, **`istiod`**, sends routes, clusters, listeners, and endpoints to each proxy. Then we fix **proxy readiness** and **startup races**, and we finish with **configuration scoping** plus **mesh canary upgrades** so changes roll out safely.

The online store used to have a simpler failure path. If `checkout` called `inventory` and the request failed, the team mostly checked `checkout` logs, `inventory` logs, Kubernetes Services, and Pod readiness. After the mesh rollout, that same request travels through `checkout`'s local Envoy proxy, across the network, into `inventory`'s local Envoy proxy, and then into the `inventory` container. The application code still matters, but the proxy now participates in routing, connection pooling, TLS, retries, timeouts, telemetry, and policy.

That extra layer gives the team useful control. They can shift traffic between versions, require mTLS, collect consistent metrics, and debug traffic without adding logging code to every service. The tradeoff is operational responsibility. The proxy consumes resources, receives configuration from the control plane, writes its own logs, and has its own readiness state. A good mesh operator treats the sidecar as part of the workload instead of treating it like an invisible helper.

We will use one connected incident pattern through the rest of the article. The store starts seeing intermittent checkout failures during a busy sale. Some customers get a `503` after clicking "Pay now." At the same time, the `checkout` rollout takes longer than expected because a few Pods restart during startup. The team needs to answer four practical questions: whether the sidecars have enough resources, why Envoy returned `503`, whether the proxies received the latest control-plane configuration, and how to change the mesh without making the sale worse.

## Proxy Overhead
<!-- section-summary: Proxy overhead is the real CPU, memory, and latency cost added by each sidecar, so capacity planning must include it. -->

**Proxy overhead** is the extra CPU, memory, and request time used by the mesh data plane. In Istio sidecar mode, each meshed Pod usually has an application container and an `istio-proxy` container. The proxy terminates or originates mesh traffic, keeps routing data in memory, maintains connection pools, emits telemetry, and participates in mTLS. Those jobs cost resources even when the application code stays exactly the same, so the sale incident has to include the sidecar in the capacity question. If `checkout` has spare CPU but its Envoy sidecar is throttled, customers can still see slow calls or failed calls on the payment path.

For the online store, overhead matters because the busy sale increases traffic through all four services. If `web`, `checkout`, `inventory`, and `payments` each run 20 replicas, the team runs 80 application containers and about 80 proxy containers. A small amount of proxy memory per Pod turns into a real node-sizing question, and a small amount of proxy CPU per request turns into a real autoscaling question.

Start with container-level metrics. Pod totals hide whether the app or the proxy consumes the resources, so ask Kubernetes for each container separately. Use this command:

```bash
kubectl top pods --containers -n store
```

During the sale, the output might look like this. The useful detail is that each Pod appears once per container.

```bash
POD                            NAME          CPU(cores)   MEMORY(bytes)
web-779b946f7f-42jks           web           28m          92Mi
web-779b946f7f-42jks           istio-proxy   35m          74Mi
checkout-66d57c9b88-lwz6h      checkout      95m          180Mi
checkout-66d57c9b88-lwz6h      istio-proxy   140m         118Mi
inventory-7b57d5cc55-r2sqn     inventory     42m          110Mi
inventory-7b57d5cc55-r2sqn     istio-proxy   55m          82Mi
payments-5fc64bb66f-9h6t2      payments      70m          155Mi
payments-5fc64bb66f-9h6t2      istio-proxy   120m         104Mi
```

The important move is comparing each app container with its own proxy container. `checkout` has a busy proxy because every order fans out to `inventory` and `payments`. `payments` also has a busy proxy because card authorization is slow enough to keep connections open longer. The numbers show real sidecar work that must appear in the capacity plan.

In production, take a baseline before and after mesh rollout. Record proxy CPU, proxy memory, p95 latency, request rate, and error rate for each service. Use the same traffic window for each comparison, because a low-traffic morning and a sale peak tell different stories. Once you have a baseline, you can size the proxy like any other container and update HPA targets, Pod requests, and node capacity with evidence instead of guesswork.

## Budgeting Sidecar Resources
<!-- section-summary: Sidecar resources should be sized from observed traffic, applied through supported annotations or proxy configuration, and verified after rollout. -->

Resource budgeting means giving the proxy enough CPU and memory to handle traffic without starving the application or wasting node capacity. A **resource request** tells Kubernetes how much CPU or memory to reserve for scheduling. A **resource limit** tells Kubernetes the maximum the container can use before throttling or termination behavior applies. For an Envoy sidecar, the request protects scheduling quality, and the limit protects the node from one proxy consuming too much during a spike.

For a hot path like `checkout`, apply resource settings on the Pod template so new Pods receive the sidecar budget during injection. Istio supports sidecar resource annotations such as `sidecar.istio.io/proxyCPU`, `sidecar.istio.io/proxyCPULimit`, `sidecar.istio.io/proxyMemory`, and `sidecar.istio.io/proxyMemoryLimit`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: store
spec:
  template:
    metadata:
      labels:
        app: checkout
      annotations:
        sidecar.istio.io/proxyCPU: "100m"
        sidecar.istio.io/proxyCPULimit: "500m"
        sidecar.istio.io/proxyMemory: "128Mi"
        sidecar.istio.io/proxyMemoryLimit: "512Mi"
    spec:
      containers:
      - name: checkout
        image: registry.example.com/store/checkout:2026-06-16
```

Treat those values as an example shape rather than a universal recommendation. A quiet internal service may need much less. A service with high request rate, many upstreams, heavy telemetry, or long-lived connections may need more. After the rollout, verify that the injected Pod actually contains the resource settings:

```bash
kubectl get pod -n store -l app=checkout -o jsonpath='{.items[0].spec.containers[?(@.name=="istio-proxy")].resources}'
```

You can also use **ProxyConfig** for proxy-level runtime settings such as concurrency. **ProxyConfig** is an Istio resource that can apply mesh-wide, namespace-wide, or to selected workloads, and it is useful for settings that belong to Envoy behavior instead of Kubernetes scheduling. In the online store, concurrency controls how many Envoy worker threads the `checkout` proxy uses to process traffic. The team should set it only after load testing, because too few workers can queue requests during the sale and too many workers can waste CPU on every replica. For example, the team may pin `checkout`'s Envoy worker count after seeing stable results under realistic payment traffic:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: ProxyConfig
metadata:
  name: checkout-proxy-runtime
  namespace: store
spec:
  selector:
    matchLabels:
      app: checkout
  concurrency: 2
```

Proxy injection and many proxy settings apply when Pods are created, so plan a rollout after changing them. For the store, roll one workload at a time during a safe window, then watch container metrics and request success before moving to the next service:

```bash
kubectl rollout restart deployment/checkout -n store
kubectl rollout status deployment/checkout -n store
kubectl top pods -n store -l app=checkout --containers
```

Rollback stays simple if the change lives in the Deployment history. If the new proxy limit causes CPU throttling or memory pressure, undo the rollout and restore the previous annotation values. These commands use the Deployment rollout history:

```bash
kubectl rollout undo deployment/checkout -n store
kubectl rollout status deployment/checkout -n store
```

The practical habit is to budget the proxy as part of the service. The application team owns `checkout`, but the production service now includes `checkout` plus its sidecar. When a dashboard shows cost, capacity, or saturation, include both containers in the conversation.

## Access Logs and Response Flags
<!-- section-summary: Envoy access logs show what the proxy did with each request, and response flags point directly at common mesh failure causes. -->

An **access log** is a per-request record written by the proxy. It usually includes the request method and path, response code, bytes sent and received, duration, upstream host, authority, and a request ID. In a mesh, access logs are valuable because they come from Envoy, the proxy that actually routed the traffic between `checkout` and `payments`. When `checkout` says "payments returned 503," the access log can show whether Envoy had no route, overflowed a circuit breaker, or failed to connect to the upstream Pod. That matters during the sale because the team needs a proxy-level reason before it edits application code or rolls back the wrong service.

Istio can enable Envoy access logs through the **Telemetry API**. The Telemetry API is Istio's configuration API for mesh-generated logs, metrics, and traces, so it gives platform teams a supported place to say which proxies should emit access logs and which provider should receive them. In this incident, the team wants the default Envoy provider so every relevant sidecar can write request records while they debug the `503` errors. Put this change through the same review path as other mesh configuration:

```yaml
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata:
  name: mesh-default-access-logs
  namespace: istio-system
spec:
  accessLogging:
  - providers:
    - name: envoy
```

Some teams still enable stdout access logs through mesh config during installation or an operator-managed update. This form belongs in the Istio install or operator configuration.

```yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    accessLogFile: /dev/stdout
```

For a quick lab cluster installed with `istioctl`, the same setting often appears as an install flag. It changes the mesh config at install or upgrade time.

```bash
istioctl install --set meshConfig.accessLogFile=/dev/stdout
```

Once logging is enabled, inspect the proxy container for the service that observed the failure. In our scenario, customers clicked "Pay now," so start with the `checkout` sidecar. Read only recent logs so the incident line stays easy to find:

```bash
kubectl logs -n store deployment/checkout -c istio-proxy --since=10m | grep 'POST /api/payments/authorize'
```

A failing request might produce a line like this. Keep one real line from the incident, because the fields tell you where to go next.

```bash
[2026-06-16T09:15:42.018Z] "POST /api/payments/authorize HTTP/1.1" 503 UF 284 95 13 - "-" "checkout/1.12" "req-7f4a1c" "payments.store.svc.cluster.local" "10.42.3.17:8080"
```

A **response flag** is the short field after the response code in Envoy's default access log format. In this line, the response code is `503`, and the response flag is `UF`. That flag matters because many different failures can produce a `503`, and the flag gives you the proxy's reason in a form the on-call engineer can act on. The method and path show what `checkout` tried to do, the authority shows the service name it called, and the upstream host shows the Pod IP and port Envoy selected. During the online store incident, this one field decides whether the next step is checking Pod readiness, traffic policy limits, or route configuration.

Here are the flags the store team should decode first during a `503` incident. Keep this table nearby during incident response.

| Flag | Meaning | What to check next |
|---|---|---|
| **`UF`** | **Upstream connection failure**. Envoy selected an upstream but failed to connect. | Check destination Pods, readiness, NetworkPolicy, mTLS policy, and whether the target port is actually listening. |
| **`UO`** | **Upstream overflow**. Envoy hit a circuit breaker or connection-pool limit. | Check DestinationRule traffic policy, connection pool settings, request rate, retries, and whether a downstream spike overloaded `payments`. |
| **`NR`** | **No route configured** for the request, or no matching filter chain for a downstream connection. | Check VirtualService hosts, Gateway hosts, Service port names, configuration scoping, and whether the request authority matches the configured host. |

Now connect the log to a useful investigation. If `checkout` logs `UF` when calling `payments`, start by confirming `payments` endpoints exist and are ready. This confirms whether Envoy had healthy targets to call:

```bash
kubectl get endpoints -n store payments
kubectl get pods -n store -l app=payments
kubectl logs -n store deployment/payments -c payments --since=10m
```

If the flag is `UO`, look for a traffic policy that limits pending requests or connections too tightly. That points to load or policy pressure around the upstream.

```bash
kubectl get destinationrule -n store payments -o yaml
```

If the flag is `NR`, inspect the route config next. `NR` often means the proxy received a request that missed every configured route for the host, port, or protocol the application used. The fix may be a host name, port name, VirtualService host, or configuration scope, so check the proxy config before editing YAML.

## Checking xDS and Proxy Sync
<!-- section-summary: xDS sync tells you whether a proxy has received the current routes, clusters, listeners, and endpoints from the control plane. -->

**xDS** is Envoy's family of discovery APIs. In plain terms, it is how the control plane teaches each proxy what the network looks like right now. A proxy needs a **listener** for an incoming port, a **route** for HTTP host and path decisions, a **cluster** for each upstream service and port it can send traffic to, an **endpoint** list with the actual Pod IPs behind that service, and secrets for TLS material. Istio's control-plane process, **`istiod`**, watches Kubernetes Services, EndpointSlices, Pods, and Istio resources, then translates that live state into Envoy configuration and pushes it to sidecars. This matters in the store incident because a correct `VirtualService` in Kubernetes only helps customers after the `checkout` sidecar receives and accepts the updated route.

**Control-plane sync** means the proxy and `istiod` agree on the latest version of that configuration. This matters during incidents because a YAML file can look correct in the Kubernetes API while one proxy still uses old or rejected config. For the online store, a new VirtualService might correctly route `checkout` to `payments`, while one stale `checkout` sidecar still lacks the route and returns `NR`.

Start with the mesh-wide summary. This command compares what `istiod` sent with what the proxies acknowledged.

```bash
istioctl proxy-status
```

Healthy output should show the store proxies in sync. All major discovery columns should show `SYNCED` for the Pods you care about.

```bash
NAME                                                   CLUSTER        CDS        LDS        EDS        RDS          ECDS         ISTIOD
checkout-66d57c9b88-lwz6h.store                       Kubernetes    SYNCED     SYNCED     SYNCED     SYNCED       NOT SENT     istiod-1-30-1
inventory-7b57d5cc55-r2sqn.store                      Kubernetes    SYNCED     SYNCED     SYNCED     SYNCED       NOT SENT     istiod-1-30-1
payments-5fc64bb66f-9h6t2.store                       Kubernetes    SYNCED     SYNCED     SYNCED     SYNCED       NOT SENT     istiod-1-30-1
web-779b946f7f-42jks.store                            Kubernetes    SYNCED     SYNCED     SYNCED     SYNCED       NOT SENT     istiod-1-30-1
```

The short column names map to the pieces Envoy needs. **CDS** is cluster discovery, so it tells Envoy about upstream services such as `payments` on port `8080`. **LDS** is listener discovery, so it tells Envoy which local ports and filter chains should accept traffic. **EDS** is endpoint discovery, so it fills a cluster with actual Pod IPs that are ready to receive requests. **RDS** is route discovery, so it tells Envoy which HTTP host and path should go to which cluster. If one of those columns says `STALE`, `NOT SENT`, or reports a different `istiod` revision than expected, focus on that proxy before changing application code because the proxy may be making decisions from old information.

When a specific request fails, inspect the proxy that sent it. First capture one `checkout` Pod name. Using the exact source Pod keeps the investigation tied to the failing request path:

```bash
CHECKOUT_POD=$(kubectl get pod -n store -l app=checkout -o jsonpath='{.items[0].metadata.name}')
```

Then check whether that proxy has a cluster for the `payments` service. An Envoy **cluster** is the upstream object Envoy uses for one destination service and port inside the mesh. The cluster name can look long because it encodes direction, port, subset, and service host, but the operating question is practical: does the `checkout` proxy know that `payments.store.svc.cluster.local:8080` is a destination it can call?

```bash
istioctl proxy-config clusters "$CHECKOUT_POD" -n store --fqdn payments.store.svc.cluster.local
```

You should see an outbound cluster for the service and port. If this is missing, the source proxy lacks a usable upstream for `payments`.

```bash
SERVICE FQDN                         PORT     SUBSET     DIRECTION     TYPE
payments.store.svc.cluster.local     8080     -          outbound      EDS
```

Next, inspect the route that should send HTTP traffic to that cluster. A **route** is Envoy's HTTP decision table: it matches details like authority, host, path, headers, or method and then chooses an upstream cluster. For the failed "Pay now" request, the route should map the `payments` host and request path to the `payments` cluster, so missing route data points back to VirtualService hosts, port naming, or scoping.

```bash
istioctl proxy-config routes "$CHECKOUT_POD" -n store --name 8080 -o json
```

For a routing problem, look for the virtual host domains and the cluster name. Those two fields show whether the request authority can reach the intended upstream.

```json
{
  "name": "8080",
  "virtualHosts": [
    {
      "name": "payments.store.svc.cluster.local:8080",
      "domains": [
        "payments.store.svc.cluster.local",
        "payments",
        "payments.store"
      ],
      "routes": [
        {
          "match": {
            "prefix": "/"
          },
          "route": {
            "cluster": "outbound|8080||payments.store.svc.cluster.local"
          }
        }
      ]
    }
  ]
}
```

If `clusters` has the service but `routes` lacks the host, check VirtualService hosts, HTTP route matches, and port names. If `routes` points to the right cluster but endpoints are empty, check EndpointSlices and Pod readiness. An **endpoint** is the concrete Pod IP and port Envoy will dial after it chooses a cluster, so an empty endpoint list means Envoy may understand the service name but has no ready `payments` Pod to send the request to:

```bash
istioctl proxy-config endpoints "$CHECKOUT_POD" -n store --cluster "outbound|8080||payments.store.svc.cluster.local"
kubectl get endpointslice -n store -l kubernetes.io/service-name=payments
```

Run **`istioctl analyze`** before and after changing mesh configuration. `istioctl analyze` is Istio's configuration checker: it reads live cluster resources, local YAML, or both, then reports common mistakes before customers hit them. In the online store incident, it is a fast safety check before changing VirtualServices, DestinationRules, configuration scope, or revision labels while the checkout path is already under pressure.

```bash
istioctl analyze -n store
istioctl analyze --all-namespaces
```

`istioctl analyze` catches many configuration mistakes before they turn into request failures: missing injection labels, invalid hosts, unreachable VirtualService rules, broken selectors, and resources that point to missing services. Use it alongside real traffic testing during every mesh change review, because it gives fast feedback before the rollout reaches customers.

## Proxy Readiness and Startup Races
<!-- section-summary: Proxy readiness protects startup because an application can send its first network call before the sidecar is ready to route it. -->

**Proxy readiness** means the `istio-proxy` container has started, connected to `istiod`, received enough configuration, and is ready to handle captured traffic. The exact readiness behavior depends on Istio version and install settings, but the operating point stays the same: a Pod can contain a running application container while the proxy is still warming up. That matters for the online store because `checkout` may try to call `inventory` or `payments` during boot, and the first call can fail through the proxy path before normal customer traffic even reaches the Pod.

A **startup race** happens when the application makes a network call before the proxy can route it. In the store, `checkout` loads configuration, opens a database connection, and calls `inventory` during boot to warm a local cache. If the application starts fast and the proxy takes a moment to connect to `istiod`, the first outbound call may hit a proxy path that is still starting. The application logs a connection failure, exits, and Kubernetes restarts it. The second attempt may work because the proxy is ready by then, which makes the failure look random to the team watching the rollout.

You can spot this shape by looking at Pod readiness and restart history. The `READY` column shows how many containers are ready inside each Pod.

```bash
kubectl get pods -n store -l app=checkout
```

Example output can show one Pod crash-looping while another finishes startup. That contrast is a useful clue during rollouts.

```bash
NAME                         READY   STATUS             RESTARTS      AGE
checkout-66d57c9b88-lwz6h    1/2     CrashLoopBackOff   3 (44s ago)   4m12s
checkout-66d57c9b88-x9mfs    2/2     Running            0             4m12s
```

Now compare the application logs with the proxy logs. The `--previous` flag is important because the current container may have restarted. Reading both containers keeps the startup story complete:

```bash
kubectl logs -n store deployment/checkout -c checkout --previous
kubectl logs -n store deployment/checkout -c istio-proxy --since=10m
```

The application might show a dependency call failing during boot. That tells you the app tried to use the network before it was ready.

```bash
FATAL startup probe failed: GET http://inventory.store.svc.cluster.local:8080/health returned connection refused
```

For workloads that need the network immediately at boot, use Istio's **`holdApplicationUntilProxyStarts`** setting. This setting tells Istio to hold the application containers until the sidecar proxy has started enough to handle traffic, so the first `checkout` call to `inventory` does not race ahead of the proxy. The per-workload form goes on the Pod template as a proxy config annotation, which keeps the fix local to `checkout` while you verify the behavior during the rollout:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: store
spec:
  template:
    metadata:
      labels:
        app: checkout
      annotations:
        proxy.istio.io/config: '{ "holdApplicationUntilProxyStarts": true }'
    spec:
      containers:
      - name: checkout
        image: registry.example.com/store/checkout:2026-06-16
```

After applying it, roll the Deployment and watch the transition. The new Pods need to be created before the annotation can affect injection.

```bash
kubectl rollout restart deployment/checkout -n store
kubectl rollout status deployment/checkout -n store
kubectl get pods -n store -l app=checkout -w
```

For broad policy, mesh operators can configure the same behavior globally through Istio installation values, but use a workload-level change first when you are fixing one startup-sensitive service. Global changes affect many teams, and a canary or staged rollout gives you cleaner evidence.

Also fix the application pattern when you can. A service should tolerate temporary dependency failures during boot, use readiness probes to keep itself out of traffic until it is useful, and retry dependency checks with bounded backoff. `holdApplicationUntilProxyStarts` removes the proxy race, while application-level startup resilience handles real dependency unavailability.

## Configuration Scoping
<!-- section-summary: Configuration scoping limits which mesh configuration a proxy receives, reducing cost while requiring careful dependency lists. -->

**Configuration scoping** means limiting the services and mesh resources a proxy needs to know about. By default, a sidecar may receive configuration for many namespaces and services, including services it will never call. That default is convenient because most routes work out of the box, but large meshes pay for it through control-plane CPU, proxy memory, and larger config pushes. For the sale incident, scoping matters because a smaller config can reduce proxy memory and sync work, while a missing dependency in the scope can create a real `503` even though the destination service is healthy.

For the online store, `checkout` only calls `inventory`, `payments`, and a few platform services. It only needs routes for the namespaces that hold those dependencies. Scoping can reduce the amount of configuration shipped to the `checkout` proxy, which helps memory and sync time when the platform grows. The risk is missing a real dependency and creating traffic failures, so start with observation before editing scope.

One Istio scoping tool is the **Sidecar resource**. The Sidecar resource is an Istio networking resource that describes which hosts a sidecar proxy should import for a namespace or selected workloads. The name can confuse beginners because the resource configures proxy visibility, while the sidecar proxy itself is the extra container in the Pod. In the store, this resource lets the platform team say that `checkout` should see local `store` services and selected shared services, instead of receiving config for every service in the mesh. This example keeps the `store` namespace visible to workloads in `store` and allows access to selected shared services after the team has confirmed the dependency list:

```yaml
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: store-default
  namespace: store
spec:
  egress:
  - hosts:
    - "./*"
    - "istio-system/*"
    - "shared-observability/*"
```

The `"./*"` entry means all services in the same namespace as the Sidecar resource. If `payments` lives in `store`, `checkout` can still call it. If the finance team moves `payments` into a `finance` namespace later, this scope needs an explicit `finance/*` entry before `checkout` can rely on it.

Service owners can also control visibility through **`exportTo`** on Istio resources or the `networking.istio.io/exportTo` annotation on Kubernetes Services. `exportTo` answers the visibility question from the service owner's side: which namespaces should be allowed to see this service or this Istio config? In the store, the `payments` owner might expose payment routing only to the `store` namespace and a small set of platform namespaces, which reduces accidental cross-namespace coupling. Mesh owners can use **discovery selectors** for broader mesh-wide visibility. A discovery selector is an Istio installation setting that tells `istiod` which namespaces to watch at all, so it is a platform-level decision because excluding a namespace can remove its services from every proxy's view.

Verify scope changes with commands before sending customer traffic through them. The checks should prove the source proxy can still see the services it calls.

```bash
istioctl analyze -n store
istioctl proxy-status | grep store
CHECKOUT_POD=$(kubectl get pod -n store -l app=checkout -o jsonpath='{.items[0].metadata.name}')
istioctl proxy-config clusters "$CHECKOUT_POD" -n store --fqdn payments.store.svc.cluster.local
istioctl proxy-config routes "$CHECKOUT_POD" -n store --name 8080
```

Rollback is the old scope plus a Pod restart. Keep the previous `Sidecar` YAML in version control, revert the change, apply it, and restart the affected workload so new proxy config and injection-time settings are cleanly tested:

```bash
kubectl apply -f sidecar-store-previous.yaml
kubectl rollout restart deployment/checkout -n store
kubectl rollout status deployment/checkout -n store
```

Treat scoping like a performance optimization with a correctness test. It can reduce overhead, but it also edits what the proxy can see. The safest first canary is one namespace or one low-risk workload with known dependencies, access logs enabled, and a fast rollback path.

## Canary Upgrades of the Mesh
<!-- section-summary: A mesh canary upgrade runs a new control-plane revision beside the old one so a small set of workloads tests the change first. -->

An **upgrade of the mesh** changes the infrastructure that configures or runs the proxies. In Istio sidecar mode, that usually means installing a new `istiod` **revision** and gradually recreating workloads so their sidecars connect to that revision. A revision is a named Istio control-plane installation, such as `1-30-1`, that can run beside the older control plane while selected Pods receive sidecars from the new version. A **canary upgrade** is a small, controlled rollout of that new revision before the whole fleet moves. The goal is to learn from one service before changing every service, because a bad mesh upgrade can affect routing, telemetry, policy, and startup behavior across the store.

For the store, canary the mesh with a low-risk path first, then move to `web`, then `inventory`, then `checkout`, and finally `payments`. `checkout` and `payments` sit on the money path, so they should move after the team has evidence from easier workloads. Before the upgrade, run the precheck so Istio can report known install, version, and configuration problems before the team introduces a second control plane:

```bash
istioctl x precheck
```

Install the new control plane as a separate revision. Use a real version-shaped revision name in production, because names like `canary` can confuse the team after several upgrades and make rollback conversations harder during incidents. The install should create a second `istiod` beside the old one, which gives the team a safe place to test new sidecars while the rest of the store keeps using the old revision:

```bash
istioctl install --set revision=1-30-1 -y
kubectl get pods -n istio-system -l app=istiod
```

You should see the old and new control planes running side by side. That side-by-side state is what makes a controlled canary possible.

```bash
NAME                              READY   STATUS    RESTARTS   AGE
istiod-1-29-5-6d7ddc8f77-bqj2s    1/1     Running   0          21d
istiod-1-30-1-85c9b5fcb6-t7xzh    1/1     Running   0          2m
```

Then move one namespace or workload set to the new revision label and recreate the Pods. The revision label tells Istio which control-plane revision should inject new sidecars for that namespace, and the restart creates Pods that actually use that choice. This distinction matters because changing the label prepares future injection, while recreating the workload changes the live data plane:

```bash
kubectl label namespace store istio.io/rev=1-30-1 --overwrite
kubectl rollout restart deployment/web -n store
kubectl rollout status deployment/web -n store
```

Confirm the new proxies connect to the intended control plane. Check both `istioctl` and Kubernetes labels to verify which revision served the Pod.

```bash
istioctl proxy-status | grep web
kubectl get pods -n store -l app=web -L istio.io/rev
kubectl logs -n store deployment/web -c istio-proxy --since=10m | tail
```

During the canary, watch the things that would hurt customers: 5xx rate, latency, `UF`/`UO`/`NR` flags, proxy restarts, and `proxy-status` sync state. If the canary looks bad, move the namespace label back to the old revision, restart the canary workload, and remove the new control plane only after traffic is safely back:

```bash
kubectl label namespace store istio.io/rev=1-29-5 --overwrite
kubectl rollout restart deployment/web -n store
kubectl rollout status deployment/web -n store
istioctl uninstall --revision=1-30-1 -y
```

When the canary succeeds, repeat the same pattern service by service. Existing Pods keep their injected sidecar until they are recreated, so a label update prepares future injection and the rollout step changes the live data plane.

## A Small Operating Runbook
<!-- section-summary: A runbook turns mesh operations into repeatable checks for capacity, failed requests, startup reliability, and safe change rollout. -->

A runbook is a short operating script for humans. It gives the on-call engineer a sequence to follow while the incident is noisy. This one fits the online store scenario and uses commands you can run from a terminal with cluster access.

| Situation | First checks | Deeper checks | Rollback or mitigation |
|---|---|---|---|
| Proxy resource pressure | `kubectl top pods --containers -n store` and compare app vs `istio-proxy`. | Check proxy restarts, CPU throttling dashboards, and recent traffic growth. | Revert bad annotations with `kubectl rollout undo`, or raise proxy requests/limits for the hot workload and roll one service at a time. |
| Customer-facing `503` | Read access logs with `kubectl logs -n store deployment/checkout -c istio-proxy --since=10m`. | Decode `UF`, `UO`, or `NR`, then inspect clusters, routes, endpoints, and destination policies. | Roll back recent VirtualService, DestinationRule, Sidecar, or deployment changes. Use traffic shifting to reduce load on the failing version. |
| Possible stale proxy config | Run `istioctl proxy-status` and find proxies with stale CDS, LDS, EDS, or RDS. | Use `istioctl proxy-config clusters` and `istioctl proxy-config routes` on the exact source Pod. Run `istioctl analyze`. | Restart only the affected workload after fixing config. Escalate to the platform team if many proxies lose sync with `istiod`. |
| Startup crash after mesh rollout | Check `kubectl get pods`, app logs with `--previous`, and sidecar logs. | Look for first-boot dependency calls and proxy readiness timing. | Add `proxy.istio.io/config: '{ "holdApplicationUntilProxyStarts": true }'`, add app retry/backoff, then restart the Deployment. |
| Mesh upgrade or config scoping change | Start with one low-risk workload and run `istioctl analyze`. | Watch access logs, flags, latency, and `proxy-status` for that workload. | Restore the old revision label or previous configuration scope, restart the canary workload, and keep the old control plane until verification passes. |

Use the runbook in order during a live issue. First decide whether the problem is capacity, request routing, proxy sync, startup, or rollout. Then collect evidence from the smallest useful scope, usually one source Pod and one destination service. That keeps the team from making broad mesh changes while only one `checkout` sidecar is missing a route.

## Common Gotchas
<!-- section-summary: Most painful mesh incidents come from disabled logs, hidden container metrics, stale assumptions about injection, or rollout steps that recreate fewer Pods than expected. -->

Access logs may be disabled in a default installation. `kubectl logs -c istio-proxy` will still show proxy process logs, but per-request access logs require Telemetry API or mesh config setup. If the incident process relies on response flags, verify logging before the busy season instead of discovering the gap during checkout failures.

Container metrics require the Kubernetes metrics pipeline. If `kubectl top pods --containers` fails, fix metrics-server or use your cluster's observability stack to view per-container CPU and memory. Pod-level CPU hides proxy pressure and can lead the team to tune the wrong container.

Some proxy and injection settings require new Pods. Resource annotations, the `proxy.istio.io/config` annotation, and revision labels apply through the Pod template and injection path. After changing them, run a rollout and confirm the generated Pod spec rather than assuming existing Pods changed in place.

`NR` often points to host, port, protocol, or scope mismatches. Check the authority the application uses, the Kubernetes Service port name, VirtualService hosts, Gateway hosts for ingress traffic, and configuration scope. A route can exist for `payments.store.svc.cluster.local` while the application calls a different host name that the proxy treats separately.

`UO` means overflow at the upstream side, usually from circuit breaking or connection-pool pressure. Raising CPU on the sidecar may help if the proxy is saturated, but first inspect traffic policy and request rate. A tight connection pool can produce overflow even when the Pod has spare CPU.

Canary upgrade labels choose which revision injects new sidecars. Restart or roll the selected workloads, verify `istioctl proxy-status`, and keep the previous revision until the new one has served real traffic without new errors.

## Putting It All Together
<!-- section-summary: Operating a mesh means treating the proxy, control plane, and rollout process as first-class parts of production. -->

The online store scenario gives you the operating pattern. Budget the sidecars with the same seriousness as the application containers. Enable access logs before incidents, then use response flags to turn a vague `503` into a specific next step. Check xDS sync before blaming application code, because a proxy with stale routes can fail while the YAML in Git looks perfect.

For startup reliability, make the proxy readiness path explicit with `holdApplicationUntilProxyStarts` where the workload needs immediate network access, and keep application boot code resilient to temporary dependency failures. For scale and safety, scope configuration carefully, analyze changes before applying them, and canary mesh upgrades through one workload or namespace before touching the whole store.

The main production habit is to treat every meshed service as the application plus its proxy. Debug `checkout` as `checkout` plus `istio-proxy`, debug routing as application intent plus Envoy config, and roll mesh changes like infrastructure changes that can affect every customer request.

---

**References**

- [Istio Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) - Explains control-plane and data-plane performance considerations, including proxy CPU and memory costs.
- [Istio Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) - Documents `istioctl proxy-status` and `istioctl proxy-config` workflows for inspecting Envoy configuration.
- [Istio Diagnose your Configuration with Istioctl Analyze](https://istio.io/latest/docs/ops/diagnostic-tools/istioctl-analyze/) - Documents `istioctl analyze` for detecting potential Istio configuration issues before or after applying changes.
- [Istio Envoy Access Logs](https://istio.io/latest/docs/tasks/observability/logs/access-log/) - Shows how to enable Envoy access logging through Telemetry API or mesh config.
- [Istio Configure Access Logs with Telemetry API](https://istio.io/latest/docs/tasks/observability/logs/telemetry-api/) - Shows Telemetry API examples for access logging and filtering.
- [Envoy Access Logging](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage) - Defines Envoy's default access log fields, including response code and response flags.
- [Envoy Substitution Formatter](https://www.envoyproxy.io/docs/envoy/latest/configuration/advanced/substitution_formatter) - Lists response flag meanings such as `UF`, `UO`, and `NR`.
- [Istio Sidecar Injection Problems](https://istio.io/latest/docs/ops/common-problems/injection/) - Documents startup issues around delayed `istio-proxy` readiness and the `holdApplicationUntilProxyStarts` setting.
- [Istio Configuration Scoping](https://istio.io/latest/docs/ops/configuration/mesh/configuration-scoping/) - Explains Sidecar imports, `exportTo`, and discovery selectors for limiting mesh configuration scope.
- [Istio ProxyConfig Reference](https://istio.io/latest/docs/reference/config/networking/proxy-config/) - Describes workload, namespace, and mesh-level ProxyConfig behavior.
- [Istio Resource Annotations](https://istio.io/latest/docs/reference/config/annotations/) - Lists supported sidecar annotations for proxy CPU, memory, and proxy config.
- [Istio Canary Upgrades](https://istio.io/latest/docs/setup/upgrade/canary/) - Describes revision-based Istio control-plane canary upgrades and rollback.

---
title: "Mesh Traffic"
description: "Route an online store checkout service with canary traffic, waiting limits, safe retry behavior, and overloaded-service protection."
overview: "Mesh traffic rules let Kubernetes teams split service requests between versions, limit waiting time, retry carefully, protect overloaded dependencies, and roll back through proxy configuration."
tags: ["kubernetes", "service-mesh", "routing", "circuit-breaker", "canary"]
order: 2
id: article-containers-orchestration-kubernetes-service-mesh-mesh-traffic
---
## Table of Contents

1. [The Checkout Service Call](#the-checkout-service-call)
2. [A Checkout Canary Rollout](#a-checkout-canary-rollout)
3. [Route Rules, Subsets, VirtualServices, and DestinationRules](#route-rules-subsets-virtualservices-and-destinationrules)
4. [A Small Canary](#a-small-canary)
5. [Verify What the Proxies Received](#verify-what-the-proxies-received)
6. [Add Timeout and Retry Protection](#add-timeout-and-retry-protection)
7. [Add Circuit Breaking for Inventory Trouble](#add-circuit-breaking-for-inventory-trouble)
8. [Rollback and Common Gotchas](#rollback-and-common-gotchas)
9. [Putting It All Together](#putting-it-all-together)
10. [References](#references)

## The Checkout Service Call
<!-- section-summary: Mesh traffic rules control where service requests go and how proxies behave when a destination is slow or unhealthy. -->

**Mesh traffic** is service-to-service routing and failure behavior managed by the mesh proxies. In the online store, `web` calls the `checkout` Service as usual, but the mesh can decide how much traffic reaches `checkout-v1` or `checkout-v2`, how long callers wait, and how proxies react to repeated failures.

The base Kubernetes Service still gives callers a stable name. That part should feel familiar from normal Kubernetes networking. The mesh adds traffic rules around that name, so release and failure behavior can change through platform configuration instead of application code.

## A Checkout Canary Rollout
<!-- section-summary: The example rollout sends most traffic to checkout v1 and a small canary share to checkout v2. -->

The store team is testing `checkout-v2`. The safe rollout plan is:

| Step | Goal |
|---|---|
| Label Pods by version | Let the mesh identify v1 and v2 backends |
| Define subsets | Tell Envoy which endpoints count as v1 or v2 |
| Route canary traffic | Send 95% to v1 and 5% to v2 |
| Verify proxy config | Confirm Envoy loaded the route |
| Watch signals | Compare errors, latency, and conversion |
| Roll back quickly | Send 100% back to v1 if evidence is bad |

The first YAML should stay small because the learner needs to see the parts separately. Labels identify the backend versions. Subsets give those versions names. The route uses those names to split traffic.

## Route Rules, Subsets, VirtualServices, and DestinationRules
<!-- section-summary: DestinationRules define backend subsets, while VirtualServices define how requests are routed to those subsets. -->

In Istio, a **DestinationRule** defines policies and subsets for a destination service. A **VirtualService** defines routing behavior for requests.

DestinationRule:

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: checkout
  namespace: store
spec:
  host: checkout.store.svc.cluster.local
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

What this does:

- Names the checkout Service as the destination.
- Defines `v1` and `v2` subsets from Pod labels.
- Gives the VirtualService stable subset names to route toward.

## A Small Canary
<!-- section-summary: A canary route sends a small percentage of traffic to the new version while most users stay on the stable version. -->

Now split traffic:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout
  namespace: store
spec:
  hosts:
    - checkout.store.svc.cluster.local
  http:
    - route:
        - destination:
            host: checkout.store.svc.cluster.local
            subset: v1
          weight: 95
        - destination:
            host: checkout.store.svc.cluster.local
            subset: v2
          weight: 5
```

What this route means:

- Calls to the checkout Service stay on the same host name.
- Envoy sends most traffic to Pods labeled `version: v1`.
- Envoy sends a small canary share to Pods labeled `version: v2`.

![Checkout canary split infographic showing web calling the checkout Service, a VirtualService sending 95 percent to v1 and 5 percent to v2, and a DestinationRule defining version subsets](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/checkout-canary-split.png)

*The canary split keeps the Service name stable while proxy routing sends a small share to v2.*

Apply and check:

```bash
$ kubectl -n store apply -f checkout-destination-rule.yaml -f checkout-virtual-service.yaml
destinationrule.networking.istio.io/checkout created
virtualservice.networking.istio.io/checkout created
```

The output confirms the API server accepted both mesh resources.

## Verify What the Proxies Received
<!-- section-summary: Traffic rules matter only after the destination proxies receive and sync the generated Envoy configuration. -->

After applying mesh config, verify that proxies synced. The API accepting YAML is only the first step.

```bash
$ istioctl proxy-status
NAME                                   CLUSTER        CDS        LDS        EDS        RDS
web-6d8c7ccf6c-l2x9p.store             Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED
checkout-v1-5c79c7b9d9-7sl4q.store     Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED
checkout-v2-6f4c9dbb79-hx2l8.store     Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED
```

What this output means:

- Envoy proxies are connected to the control plane.
- Route and cluster data are synced.
- A stale proxy should be investigated before trusting the canary.

Inspect the route from the caller proxy:

```bash
$ istioctl proxy-config routes deploy/web -n store --name 8080
NAME     VIRTUAL HOSTS
8080     checkout.store.svc.cluster.local:8080
```

This confirms the web proxy has a route for the checkout host.

## Add Timeout and Retry Protection
<!-- section-summary: Timeouts and retries should make slow failures bounded without multiplying load during an outage. -->

Timeouts limit how long callers wait. Retries can help short network blips. Careless retries can also multiply traffic during an outage, so the retry budget should stay small and visible during review.

Add small limits to the VirtualService:

```yaml
http:
  - timeout: 2s
    retries:
      attempts: 2
      perTryTimeout: 700ms
      retryOn: 5xx,connect-failure,refused-stream
    route:
      - destination:
          host: checkout.store.svc.cluster.local
          subset: v1
        weight: 95
      - destination:
          host: checkout.store.svc.cluster.local
          subset: v2
        weight: 5
```

What these values do:

- The total request waits at most `2s`.
- Each retry attempt has a smaller `700ms` window.
- Retries only happen for selected failure classes.

Watch application and proxy metrics after enabling retries. If the destination is overloaded, retries can make the overload worse.

## Add Circuit Breaking for Inventory Trouble
<!-- section-summary: Circuit breaking protects a struggling dependency by limiting connections, pending requests, and unhealthy endpoint use. -->

The checkout service also calls inventory. If inventory slows down, checkout should fail fast instead of building unbounded waits. Istio uses DestinationRule traffic policy for connection pools and outlier detection.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: inventory
  namespace: store
spec:
  host: inventory.store.svc.cluster.local
  trafficPolicy:
    connectionPool:
      http:
        http1MaxPendingRequests: 100
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 60s
```

What this protects:

- Pending request growth has a cap.
- Reused connections are limited.
- Endpoints with repeated `5xx` can be ejected temporarily.

![Timeout retry and circuit breaker infographic showing checkout Envoy using timeout and retry limits while inventory is protected by connection pool limits and outlier detection](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/timeout-retry-circuit-breaker.png)

*Timeouts, retries, and circuit breaking work together only when limits are small and measured.*

## Rollback and Common Gotchas
<!-- section-summary: Traffic rollback should be a prepared route change, and common mistakes usually involve labels, host names, protocol detection, or stale proxy config. -->

Rollback should be a small route change:

```yaml
http:
  - route:
      - destination:
          host: checkout.store.svc.cluster.local
          subset: v1
        weight: 100
      - destination:
          host: checkout.store.svc.cluster.local
          subset: v2
        weight: 0
```

What this rollback does:

- Sends all checkout traffic back to v1.
- Keeps the v2 subset defined for later inspection.
- Avoids deleting multiple resources during the incident.

Common gotchas:

| Symptom | Check |
|---|---|
| Traffic never reaches v2 | Pod labels match the DestinationRule subset |
| Route ignored | VirtualService host matches the called Service host |
| HTTP policy ignored | Service port name starts with `http` or protocol is explicit |
| One Pod has old behavior | `istioctl proxy-status` shows stale config |

## Putting It All Together
<!-- section-summary: Mesh traffic work should route intentionally, verify proxy config, bound waiting, protect weak destinations, and keep rollback ready. -->

Mesh traffic gives the store a safer rollout loop: label versions, define subsets, send a small canary share, verify proxy sync, add bounded timeout and retry behavior, protect overloaded dependencies, and keep a 100% v1 rollback route ready.

![Mesh traffic rollout runbook infographic showing labels, subsets, canary route, proxy sync verification, metrics, protections, and rollback to 100 percent v1](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/traffic-rollout-runbook.png)

*Traffic work stays safe when routing, verification, protection, and rollback move together.*

## References

- [Istio traffic management concepts](https://istio.io/latest/docs/concepts/traffic-management/) - Explains Istio traffic routing, VirtualServices, DestinationRules, percentage-based traffic splits, timeouts, retries, and circuit breakers.
- [Istio VirtualService reference](https://istio.io/latest/docs/reference/config/networking/virtual-service/) - Defines VirtualService routing fields, HTTP routes, destinations, timeouts, and retry policy fields.
- [Istio DestinationRule reference](https://istio.io/latest/docs/reference/config/networking/destination-rule/) - Defines DestinationRule subsets, traffic policies, connection pool settings, and outlier detection.
- [Istio protocol selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) - Explains explicit protocol naming and automatic protocol detection for service ports.
- [Istio circuit breaking task](https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/) - Shows how to configure and test circuit breaking for requests, connections, and outlier detection.
- [Istio proxy diagnostic commands](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) - Documents `istioctl proxy-status` and `istioctl proxy-config` for inspecting Envoy and Istiod state.
- [Istio configuration analysis](https://istio.io/latest/docs/ops/diagnostic-tools/istioctl-analyze/) - Documents `istioctl analyze` for checking live clusters and local configuration files.
- [Envoy life of a request](https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request) - Explains how Envoy routes a request through listeners, routes, clusters, connection pools, and endpoints.
- [Envoy circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking) - Explains Envoy's network-level circuit breaking limits and why fast failure protects distributed systems.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Explains Service names, selectors, and Service-to-Pod routing used by the checkout contract.
- [Recommended Kubernetes Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/) - Shows common label conventions that help teams keep app and version metadata consistent across resources.

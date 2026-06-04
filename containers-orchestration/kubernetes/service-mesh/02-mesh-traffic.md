---
title: "Mesh Traffic"
description: "Control request behavior between services with retries, timeouts, circuit breaking, and traffic splitting."
overview: "Once the mesh intercepts traffic, you can manipulate it. This article explores how proxy routing rules enable granular traffic splitting and canary deployments using the CLI."
tags: ["kubernetes", "service-mesh", "routing", "circuit-breaker", "canary"]
order: 2
id: article-containers-orchestration-kubernetes-service-mesh-mesh-traffic
---

## Table of Contents

- [Random vs Predictable Routing](#random-vs-predictable-routing)
- [Defining Routing Rules](#defining-routing-rules)
- [Testing The Canary Split](#testing-the-canary-split)
- [How Proxies Make Decisions](#how-proxies-make-decisions)
- [Verifying Control Plane Sync](#verifying-control-plane-sync)
- [Timeouts and Retries](#timeouts-and-retries)
- [Breaking The Circuit](#breaking-the-circuit)
- [Putting It All Together](#putting-it-all-together)
- [What's Next](#whats-next)

## Random vs Predictable Routing

When an engineering team deploys a new version of a payment processing service, they rarely want to expose it to all live traffic at once. In a plain Kubernetes cluster, a `Service` chooses from ready endpoints behind one stable name. That is useful for normal load balancing, but it is not version-aware canary routing. If you deploy ten Pods running the old payment version and one Pod running the new version, the Service sees eleven ready backends, not a release plan that says the new version should receive exactly one percent of traffic.

A service mesh adds rule-based routing on top of that endpoint list. Because a local proxy sits on the network path of each meshed HTTP or gRPC workload, it can evaluate explicit routing rules and split traffic by version, header, path, or weight instead of relying only on the number of Pods behind the Service.

## Defining Routing Rules

To split traffic precisely, the mesh requires two configurations. First, it needs to know the available subsets of the target service. Second, it needs to know the exact mathematical weight to assign to each subset.

![Service mesh traffic routing rules showing service, route rule, version A, version B, and traffic weights](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/mesh-route-rules.png)

*Mesh routing rules let one stable service split traffic across versioned backends.*


A practical way to understand this is to treat the `DestinationRule` as the list of available versions, and the `VirtualService` as the route map that directs requests to those versions.

Create a routing configuration that defines a `v1` and `v2` subset for the checkout service, and then routes 90 percent of traffic to `v1` and 10 percent to `v2`.

```yaml
# routing.yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: checkout-destination
spec:
  host: checkout
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout-route
spec:
  hosts:
  - checkout
  http:
  - route:
    - destination:
        host: checkout
        subset: v1
      weight: 90
    - destination:
        host: checkout
        subset: v2
      weight: 10
```

Apply this file to the cluster:

```bash
$ kubectl apply -f routing.yaml
destinationrule.networking.istio.io/checkout-destination created
virtualservice.networking.istio.io/checkout-route created
```

The control plane immediately reads these custom resources. It translates the YAML declarations into low-level proxy configuration objects and pushes the relevant routing state over persistent gRPC connections to the proxies that need it.

## Testing The Canary Split

To see the traffic rules in action, you can generate a continuous stream of requests from a client Pod inside the mesh to the checkout service. A simple shell loop using `curl` makes the distribution visible.

```bash
$ kubectl exec deploy/web -c app -- sh -c 'while true; do curl -s http://checkout/api/v1/ping; echo ""; sleep 0.1; done'
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v1", "status": "ok"}
{"version": "v2", "status": "ok"}
{"version": "v1", "status": "ok"}
```

The output shows the routing policy is active. The web application thinks it is communicating with a single stable endpoint named `checkout`. Under the hood, the sidecar proxy evaluates the 90/10 weight rule and forwards each HTTP request to an endpoint in the selected subset. With a small sample, the output will not always show an exact 90/10 split, but over enough requests the distribution should move toward the configured weights.

## How Proxies Make Decisions

Standard Kubernetes `kube-proxy` operates at Layer 4 of the network stack. It works with IP addresses and TCP or UDP ports. It does not know that one request is `/api/v1/ping` and another is `/checkout`, so it cannot choose a backend based on HTTP paths, headers, or release names.

An Istio sidecar can operate at Layer 7 when the traffic is HTTP, HTTP/2, or gRPC and Istio can detect or has been told the protocol. In that case, the proxy can read the Host header, the URL path, the query parameters, and custom HTTP headers. Opaque TCP and encrypted TLS traffic do not give the proxy the same application-level view, and UDP traffic is outside this sidecar routing model.

This HTTP-aware parsing enables advanced routing. Instead of a simple percentage split, the proxy can route traffic based on a header value. For example, a `VirtualService` can inspect a specific `x-user-group` header. If the header equals `beta-testers`, the proxy routes the request to the `v2` subset. If the header is missing, the proxy defaults to `v1`. The web application writes normal HTTP requests, and the proxy performs the routing logic outside the application code.

## Verifying Control Plane Sync

When a cluster has hundreds of Pods, the control plane must distribute routing updates rapidly. If a proxy misses an update, it might route traffic using old rules. To diagnose configuration consistency, the mesh provides a CLI command that compares the control plane's expected state with the actual state reported by the proxies.

```bash
$ istioctl proxy-status
NAME                                   CLUSTER        CDS        LDS        EDS        RDS          ISTIOD                      VERSION
checkout-v1-6b877f8d5b-4j8kp.default   Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED       istiod-6c84f5d6c8-9b8r2     1.20.0
checkout-v2-5c988e7d4c-2l9mq.default   Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED       istiod-6c84f5d6c8-9b8r2     1.20.0
web-7d999e8e5d-1k0nr.default           Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED       istiod-6c84f5d6c8-9b8r2     1.20.0
```

The `SYNCED` status in every column proves that the proxy has successfully received and applied the latest configuration. The acronyms represent the specific discovery service APIs used by the proxy to stream state changes. `CDS` is the Cluster Discovery Service, which tracks available upstream service targets. `EDS` tracks the individual IP endpoints. `LDS` tracks the listening ports on the proxy itself. `RDS` is the Route Discovery Service, which contains the exact HTTP routing rules like the 90/10 split.

If a row showed `STALE` instead of `SYNCED`, it would mean that specific proxy failed to receive the new routing update. This typically happens when the control plane experiences heavy CPU load, or when the long-lived gRPC socket connecting the proxy to the control plane drops packets, leaving the proxy evaluating traffic against outdated memory rules.

## Timeouts and Retries

Routing rules decide where a request goes. Timeouts and retries decide how long the caller should wait and whether the proxy should try again after a failed attempt.

In plain terms, a timeout is a maximum waiting period for one request. Example: if the frontend calls checkout and the checkout service does not respond within two seconds, the proxy can stop waiting and return an error to the frontend. A retry is a controlled second attempt. Example: if one checkout Pod closes the connection before sending a response, the proxy may try another healthy endpoint once before giving up.

These settings are powerful because they protect callers from waiting forever, but they also create load if they are too aggressive. A retry storm can make a struggling backend worse. A beginner should read retry and timeout rules as part of the service contract, not as harmless defaults.

## Breaking The Circuit

Beyond routing, the proxy also protects services from overwhelming each other. When a backend database or downstream service slows down, upstream services often keep sending requests. These waiting requests stack up as open network connections until the entire cluster exhausts its memory.

![Service mesh circuit breaker path showing caller proxy, timeout, retry, circuit open, and protected service](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/mesh-circuit-breaker-path.png)

*Timeouts, retries, and circuit breaking are proxy decisions that protect callers and backends.*


A circuit breaker prevents this cascading failure by monitoring active connections and instantly failing new requests when a threshold is breached.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: checkout-circuit-breaker
spec:
  host: checkout
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 10
        maxRequestsPerConnection: 10
```

In plain terms, a circuit breaker acts as a pressure valve on the network socket. The `maxConnections` field tells the proxy exactly how many concurrent TCP connections it is allowed to establish to the checkout service. If the checkout service slows down and 100 connections are already actively waiting for responses, the proxy will not open a 101st connection. Instead, it will immediately return a `503 Service Unavailable` HTTP error to the calling web application.

This instant rejection is the goal. Failing fast protects the slow checkout service from being crushed by a thundering herd of retries, allowing it time to process the existing backlog and recover. However, this means your upstream application code must be prepared to handle `503` errors gracefully, rather than blindly retrying and worsening the situation.

## Putting It All Together

By deploying a local proxy alongside every container, the service mesh moves traffic routing logic out of application code and into the network infrastructure.

- A `DestinationRule` defines the available subsets and circuit breaking limits.
- A `VirtualService` defines the exact traffic weights or header-based rules.
- The control plane pushes these rules to every proxy, visible via `istioctl proxy-status`.
- For HTTP and gRPC traffic, the proxy can parse request details and apply Layer 7 rules dynamically.
- Timeouts, retries, and circuit breakers protect callers and backends only when their limits match the real service behavior.

Using these rules, an engineering team can roll out a new payment service predictably, testing exactly 10 percent of traffic before committing to a full release.

## What's Next

Now that we control the traffic routing, how do we secure it?

![Mesh traffic summary showing a stable service, versioned backends, timeout, retry, and circuit breaker controls.](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/mesh-traffic-summary.png)

*Mesh traffic rules let application code call one stable service while the proxy layer manages version splits, time limits, retries, and failure pressure.*

---

**References**

- [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) - Core concepts for VirtualServices and DestinationRules.
- [Istio Circuit Breaking](https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/) - Configuring connection pools and outlier detection.
- [Istio Protocol Selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) - Explains when Istio can treat traffic as HTTP, HTTP/2, gRPC, or opaque TCP.
- [Kubernetes Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) - Explains how Kubernetes Services route to endpoints.

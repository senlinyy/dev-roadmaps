---
title: "Operating a Mesh"
description: "Operate a service mesh by budgeting proxy cost, reading proxy request logs, checking proxy configuration sync, fixing startup races, and rolling mesh changes safely."
overview: "Operating a service mesh means running the application container and proxy sidecar together. The operating workflow covers proxy overhead, resource budgets, access logs, proxy sync, startup timing, configuration scope, and mesh upgrades."
tags: ["kubernetes", "service-mesh", "operations", "debugging"]
order: 4
id: article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh
---
## Table of Contents

1. [The Proxied Request Path](#the-proxied-request-path)
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
12. [References](#references)

## The Proxied Request Path
<!-- section-summary: Operating a mesh means debugging the application container and the proxy sidecar together. -->

**Operating a mesh** means treating each meshed workload as the application plus its proxy. A failing checkout request may come from application code, an Envoy route, a stale proxy config, a policy denial, sidecar resource pressure, or startup timing.

In the online store, `web` calls `checkout`, and the request passes through the `web` proxy and the `checkout` proxy. The app logs may say little while Envoy access logs reveal a `503` response flag. That is the operational difference a mesh introduces.

![Mesh incident map infographic showing a checkout request through checkout Envoy and payments Envoy with app logs, access logs, response flags, proxy resources, and xDS sync as evidence sources](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh/mesh-incident-map.png)

*The incident map adds proxy evidence beside the usual application and Kubernetes evidence.*

## Proxy Overhead
<!-- section-summary: Every sidecar needs CPU, memory, startup time, and config capacity, so mesh cost should be budgeted explicitly. -->

Each sidecar consumes resources. That cost is usually worth the traffic, security, and telemetry features, but it should be visible in capacity planning.

Check per-container usage:

```bash
$ kubectl -n store top pod checkout-5c79c7b9d9-kx4mv --containers
POD                         NAME          CPU(cores)   MEMORY(bytes)
checkout-5c79c7b9d9-kx4mv   checkout      210m         180Mi
checkout-5c79c7b9d9-kx4mv   istio-proxy   65m          96Mi
```

What this output tells you:

- The proxy has its own CPU and memory profile.
- HPA based only on the app container may miss proxy pressure.
- Node capacity needs room for both containers.

## Budgeting Sidecar Resources
<!-- section-summary: Sidecar resource requests and limits should match observed proxy traffic and avoid starving the application. -->

Proxy resource settings can be applied through annotations or mesh-level defaults, depending on the platform approach. The important beginner idea is that the proxy is not free. It runs in the same Pod as the app, so the scheduler must reserve enough CPU and memory for both containers. A busy checkout service needs a visible proxy budget in the same review where the team checks the application resources.

```yaml
metadata:
  annotations:
    sidecar.istio.io/proxyCPU: 100m
    sidecar.istio.io/proxyMemory: 128Mi
    sidecar.istio.io/proxyCPULimit: 500m
    sidecar.istio.io/proxyMemoryLimit: 512Mi
```

What these settings do:

- Reserve CPU and memory for `istio-proxy`.
- Keep proxy limits visible in workload review.
- Help the scheduler place the full Pod realistically.

After applying, verify the rendered Pod:

```bash
$ kubectl -n store get pod checkout-5c79c7b9d9-kx4mv -o jsonpath='{.spec.containers[?(@.name=="istio-proxy")].resources}'
{"limits":{"cpu":"500m","memory":"512Mi"},"requests":{"cpu":"100m","memory":"128Mi"}}
```

The output proves the sidecar received the intended resources.

## Access Logs and Response Flags
<!-- section-summary: Envoy access logs and response flags show whether a request failed in routing, connection, upstream, timeout, or policy handling. -->

Envoy access logs can name proxy-side failures. After mesh logging is enabled, the proxy container logs show the request status, response flag, destination, and timing.

```bash
$ kubectl -n store logs deploy/checkout -c istio-proxy --tail=3
[2026-06-30T12:10:02.118Z] "GET /charge HTTP/1.1" 503 UF "-" 0 91 35 - "10.42.1.14" "curl/8.7.1" "a3f2" "payments:8080" "10.42.4.31:8080"
```

What this line gives you:

- Status code: `503`.
- Response flag: `UF`, often an upstream connection failure.
- Destination host: `payments:8080`.
- Duration and request ID for correlation.

The next check should follow the upstream path to payments and proxy sync, not only checkout app logs.

## Checking xDS and Proxy Sync
<!-- section-summary: xDS sync checks whether Envoy has received current listeners, routes, clusters, and endpoints from the control plane. -->

Istio sends Envoy configuration through xDS APIs. If a proxy has stale config, it may route differently from the YAML you just applied.

```bash
$ istioctl proxy-status
NAME                              CLUSTER        CDS        LDS        EDS        RDS
checkout-5c79c7b9d9-kx4mv.store   Kubernetes     SYNCED     SYNCED     SYNCED     SYNCED
payments-6dc9c8c7f9-j2m4x.store   Kubernetes     SYNCED     SYNCED     STALE      SYNCED
```

What this output says:

- Checkout has synced config.
- Payments has stale endpoint discovery data.
- The payments proxy or control-plane connection needs inspection before changing app code.

Inspect clusters for the caller:

```bash
$ istioctl proxy-config clusters deploy/checkout -n store | rg payments
outbound|8080||payments.store.svc.cluster.local     EDS
```

This confirms checkout has an outbound cluster for the payments Service.

## Proxy Readiness and Startup Races
<!-- section-summary: Some applications need the proxy ready before they make startup network calls. -->

Apps that call dependencies during startup can fail if the app starts before the proxy is ready. That is common with migration checks, config fetches, or warmup calls.

Enable proxy-start ordering where needed:

```yaml
metadata:
  annotations:
    proxy.istio.io/config: |
      holdApplicationUntilProxyStarts: true
```

What this annotation does:

- Tells Istio to hold app startup until the sidecar proxy is ready.
- Reduces startup races for apps that need network access immediately.
- Adds startup time, so use it where the workload needs it.

Check Pod readiness:

```bash
$ kubectl -n store get pod checkout-5c79c7b9d9-kx4mv
NAME                         READY   STATUS    RESTARTS
checkout-5c79c7b9d9-kx4mv    2/2     Running   0
```

The `2/2` result means both app and proxy are ready.

## Configuration Scoping
<!-- section-summary: Scoping mesh configuration reduces proxy config size and limits accidental cross-namespace effects. -->

Large meshes can push too much configuration to every proxy. Scoping keeps proxies focused on the services they actually call.

Example Sidecar resource:

```yaml
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: store-egress
  namespace: store
spec:
  egress:
    - hosts:
        - "./*"
        - "payments/*"
        - "istio-system/*"
```

What this allows:

- Store workloads can call services in their own namespace.
- Store workloads can call selected services in `payments`.
- Istio system services remain available.

Run analysis before applying:

```bash
$ istioctl analyze -n store
✔ No validation issues found when analyzing namespace: store.
```

The output gives a basic config sanity check before rollout.

## Canary Upgrades of the Mesh
<!-- section-summary: Mesh control-plane upgrades should use revisions and workload canaries before moving an entire namespace. -->

Mesh upgrades can affect every service call. Use revision-based canaries when supported by your mesh process.

```bash
$ istioctl install --set revision=1-24-0 -y
✔ Istio core installed
✔ Istiod installed
✔ Installation complete
```

Label one canary workload or namespace for the new revision:

```bash
$ kubectl label namespace store istio.io/rev=1-24-0 --overwrite
namespace/store labeled

$ kubectl -n store rollout restart deploy/web
deployment.apps/web restarted
```

What this does:

- New Pods in the namespace use the selected Istio revision.
- Restarting one workload creates a mesh canary.
- Existing Pods keep their current sidecars until restarted.

![Safe mesh operations infographic showing proxy readiness before app start, Sidecar scope for store and shared services, and old and new Istio revisions with a web canary](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh/safe-mesh-operations.png)

*Safe mesh operations use small rollout units: one namespace, one workload, one revision canary.*

## A Small Operating Runbook
<!-- section-summary: Mesh incidents should gather app logs, proxy logs, proxy sync, resource pressure, and recent mesh config changes. -->

Use this runbook when checkout traffic fails after mesh changes:

| Step | Command or check | Evidence |
|---|---|---|
| App status | `kubectl -n store get deploy,pod` | App and proxy readiness |
| App logs | `kubectl -n store logs deploy/checkout -c checkout` | Application errors |
| Proxy logs | `kubectl -n store logs deploy/checkout -c istio-proxy` | Status codes and response flags |
| Proxy sync | `istioctl proxy-status` | Stale or synced config |
| Route config | `istioctl proxy-config routes deploy/checkout -n store` | Loaded route rules |
| Resource pressure | `kubectl -n store top pod <pod> --containers` | App versus proxy CPU and memory |
| Recent changes | GitOps or `kubectl get` history | Traffic, security, or mesh revision changes |

This order keeps the app and proxy evidence together.

## Common Gotchas
<!-- section-summary: Common mesh operation failures involve missing sidecars, stale config, overloaded proxies, protocol detection, and startup races. -->

Common operation checks:

| Symptom | Likely check |
|---|---|
| Pod is `1/1` instead of `2/2` | Sidecar injection label or revision |
| Route change has no effect | Proxy sync and host name match |
| Sudden `503 UF` | Upstream connection, destination health, mTLS, or NetworkPolicy |
| App crashes at boot | Proxy readiness and dependency calls during startup |
| Node pressure after mesh rollout | Proxy requests and limits |
| Large config pushes | Sidecar scoping or namespace exports |

These checks do not replace normal Kubernetes debugging. They add the proxy layer to the same evidence-first workflow.

## Putting It All Together
<!-- section-summary: Mesh operations keep application evidence, proxy evidence, config sync, resource budgets, and rollout safety in one workflow. -->

Operating a mesh means every service has two operational surfaces: the application and the proxy. Budget proxy resources, read Envoy access logs, check xDS sync, handle startup timing, scope configuration, and canary mesh upgrades before broad rollout.

![Mesh operations runbook infographic showing proxy pressure, 503 response flags, stale config xDS checks, startup crash readiness checks, mesh upgrade canary first, and application plus proxy](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh/mesh-operations-runbook.png)

*The runbook keeps the first move practical: check the right container, decode the proxy clue, verify xDS, fix startup timing, and canary mesh changes before expanding them.*

## References

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
- [Kubernetes Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Explains CPU and memory requests, limits, scheduling, throttling, and memory behavior for containers.
- [kubectl top pod](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_top/kubectl_top_pod/) - Documents container-level resource usage output with `--containers`.

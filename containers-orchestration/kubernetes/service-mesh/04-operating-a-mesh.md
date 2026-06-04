---
title: "Operating a Mesh"
description: "Understand proxy overhead, startup sequencing, and how to debug request paths through a service mesh."
overview: "A mesh adds a new layer of infrastructure between every service. This article explores how to inspect proxy logs, monitor overhead, and debug startup sequencing from the command line."
tags: ["kubernetes", "service-mesh", "operations", "debugging"]
order: 4
id: article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh
---

A service mesh adds a proxy path for configured application traffic. When you deploy a microservice into an Istio sidecar mesh, you are no longer just running an application container. You are running an application container alongside a proxy container that controls much of its TCP request path. This extra infrastructure layer means that when requests fail or pods crash on startup, you cannot only look at the application logs. You must inspect the proxy.

This article walks through operating a mesh from the command line. Using a standard `orders-api` deployment, we will measure proxy resource overhead, decode Envoy access logs to debug a failed request, and fix a subtle container startup race condition caused by the mesh architecture.

## Table of Contents

- [Proxy Overhead](#proxy-overhead)
- [Inspecting Proxy Logs](#inspecting-proxy-logs)
- [The Startup Race Condition](#the-startup-race-condition)
- [Holding the Application](#holding-the-application)
- [Putting It All Together](#putting-it-all-together)

## Proxy Overhead

A practical way to understand a service mesh is to look at its physical footprint. A mesh is not a centralized router; it is a fleet of small, decentralized proxies. In Istio sidecar mode, each meshed Pod gets its own proxy container, usually Envoy, injected alongside your application.

![Service mesh proxy overhead map showing app container, sidecar CPU, sidecar memory, latency, and capacity budget](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh/mesh-proxy-overhead.png)

*A mesh adds proxy CPU, memory, and latency overhead that must be included in capacity planning.*


This architecture provides high availability and keeps network hops short, but it requires memory and CPU. To see this overhead, you can use `kubectl top pods` and ask for container-level metrics instead of pod-level aggregates.

```bash
$ kubectl top pods -l app=orders-api --containers
POD                           NAME          CPU(cores)   MEMORY(bytes)
orders-api-7b89f5c49d-v2q8m   orders-api    12m          45Mi
orders-api-7b89f5c49d-v2q8m   istio-proxy   8m           62Mi
```

In this output, the `istio-proxy` container is consuming 62 megabytes of memory. This is often more than the actual `orders-api` application requires.

Under the hood, this memory is used to store the mesh routing table, TLS certificates, and telemetry buffers. If your cluster has thousands of services, Envoy needs to hold the routing rules and IP endpoints for all of them in memory so it can route traffic instantly without querying a central database. As your cluster grows, the proxy memory footprint grows with it. You are effectively doubling the number of containers running in your cluster.

## Inspecting Proxy Logs

When a network request fails in a mesh, the application logs rarely tell the whole story. If `orders-api` tries to fetch data from an inventory service and the connection drops, the application log might simply say `Connection refused`. To find out why the connection was refused, you must read the proxy logs.

Because the proxy sits between the application and the network, it can record inbound and outbound TCP connections and HTTP requests. Istio access logs are not always enabled by default. In a learning cluster, you can enable them with a mesh configuration such as `meshConfig.accessLogFile=/dev/stdout`, or with Istio's Telemetry API in a production-style setup. Without that prerequisite, `kubectl logs` still shows proxy process logs, but not necessarily per-request access logs.

```bash
$ kubectl logs deploy/orders-api -c istio-proxy | grep "GET /api/inventory"
[2026-06-02T14:32:01.123Z] "GET /api/inventory HTTP/1.1" 503 UF 0 95 10 - "-" "Go-http-client/1.1" "req-12345" "inventory.default.svc.cluster.local" "10.244.2.14:8080"
```

This single line of Envoy access log contains several critical diagnostic fields. The `503` is the HTTP response code returned to the application. The `UF` is the Envoy response flag for upstream connection failure. This shows that the proxy tried to establish a TCP connection to the destination pod but failed. The target might have been offline or blocked by a network policy. A similar-looking flag, `UC`, means the upstream connection was terminated after it existed, which points to a different failure shape.

The `0 95 10` section shows bytes received, bytes sent, and duration in milliseconds. The request took 10 milliseconds to fail. The `req-12345` is the `X-Request-ID` header. If distributed tracing is enabled, you can use this ID to find the exact request in Jaeger or Zipkin. Finally, `10.244.2.14:8080` is the resolved upstream host IP and port. The proxy did not just try to reach the service name; it successfully resolved that name to a specific pod IP and tried to connect to it.

By reading the proxy log, you shift the debugging focus. You no longer need to guess if the application sent the right HTTP headers. You know exactly which IP the proxy attempted to route to, and that the failure happened at the TCP transport layer.

## The Startup Race Condition

One of the most common operational gotchas in a service mesh involves container lifecycle sequencing. When a pod launches, its application container and proxy container start at nearly the same time. If your application boots up quickly and immediately tries to open a network connection, it might crash before the proxy is ready.

![Service mesh startup race showing app starts, proxy not ready, outbound call fails, hold app, and ready proxy](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh/mesh-startup-race.png)

*Startup ordering matters because an app can try to send traffic before its proxy is ready.*


You can spot this race condition by looking at a newly deployed pod that is stuck in a crash loop.

```bash
$ kubectl get pods -l app=orders-api
NAME                          READY   STATUS             RESTARTS      AGE
orders-api-6d4f7c8b9-x4p2z    1/2     CrashLoopBackOff   3 (42s ago)   2m10s
```

The `1/2` in the `READY` column means the `istio-proxy` container is running, but the application container has crashed. When you describe the pod and look at the application logs, you see a network failure on startup.

```bash
$ kubectl describe pod -l app=orders-api | grep -A 5 "Container orders-api"
  Container orders-api:
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1

$ kubectl logs deploy/orders-api -c orders-api
FATAL: Failed to connect to database at db.internal:5432: Connection refused
```

When the mesh is enabled in default sidecar mode, an init container or Istio CNI configures Linux traffic-redirection rules inside the Pod's network namespace. Outbound application TCP traffic is redirected to the `istio-proxy` process unless the mesh configuration excludes that port or range.

If the `orders-api` container starts in 200 milliseconds, but the `istio-proxy` container takes 2 seconds to download its routing configuration from the mesh control plane, the application's database connection is redirected to a proxy that is not yet listening. The connection is refused, the application fatals, and the pod crashes. Kubernetes eventually restarts the crashed container, and by the second attempt, the proxy is usually ready. However, this causes flaky, slow deployments.

## Holding the Application

To fix the startup race condition, you must force the application container to wait until the proxy container is fully operational. In Istio, you can achieve this by adding a specific configuration annotation to your deployment.

You can patch the deployment directly from the command line:

```bash
$ kubectl patch deployment orders-api -p '
spec:
  template:
    metadata:
      annotations:
        proxy.istio.io/config: "{ \"holdApplicationUntilProxyStarts\": true }"
'
deployment.apps/orders-api patched
```

This behavior is an Istio feature, not a general Kubernetes guarantee you should copy by hand. Kubernetes lifecycle hooks such as `PostStart` can run at the same time as a container entrypoint, so they are not a universal startup-order tool. Istio's injection logic changes the generated Pod so the proxy is started and checked before the application container is allowed to proceed. The exact injected fields can vary by Istio version, so the practical evidence is the generated Pod spec and the proxy readiness check, not a memorized kubelet trick.

## Putting It All Together

A service mesh makes the network programmable, but it physically changes the environment your applications run in. Operating a mesh effectively requires treating the proxy as a first-class citizen of your infrastructure.

- **Check container metrics**: Use `kubectl top pods --containers` to monitor the CPU and memory footprint of the proxies. A mesh is not free; it consumes resources on every node.
- **Read proxy logs**: When network calls fail, check the `istio-proxy` logs after access logging is enabled. Envoy response flags like `UF` (upstream connection failure), `UC` (upstream connection termination), or `NR` (no route configured) point toward different failure shapes.
- **Control startup sequences**: Applications that connect to the network immediately upon boot can fail if the proxy is not ready. Istio's `holdApplicationUntilProxyStarts` setting tells the injected mesh setup to hold the application until the proxy is ready.

By mastering these command-line techniques, you can confidently debug mesh deployments without relying on blind restarts or complex external dashboards.

![Operating a mesh summary showing proxy overhead, access logs, Envoy response flags, startup hold, and readiness checks.](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-operating-a-mesh/operating-mesh-summary.png)

*Operate the proxy as part of the workload: budget its overhead, read its logs, interpret its failure flags, and coordinate startup with readiness.*

---

**References**

- [Istio Observability](https://istio.io/latest/docs/tasks/observability/logs/access-log/) - Explains how to access Envoy proxy logs in an Istio mesh.
- [Envoy Access Log Dictionary](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage) - Details the format and meaning of Envoy response flags and log fields.
- [Istio Pod Lifecycle](https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/#pod-lifecycle) - Describes the `holdApplicationUntilProxyStarts` annotation and how it affects container startup sequencing.
- [Kubernetes Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/) - Explains lifecycle hook timing and why `PostStart` is not a general ordering guarantee.

---
title: "Debugging Kubernetes Networking"
description: "Learn how to trace one Kubernetes request through DNS, a Service, EndpointSlices, Pod listeners, policy, and external routing."
overview: "Kubernetes networking works as a chain of small agreements. A name must resolve, a Service must select ready Pods, the application must listen on the expected port, and policy must allow the connection. Checking those agreements in order makes debugging manageable."
tags: ["debugging", "kubectl", "dns", "services"]
order: 7
id: article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking
---

## Table of Contents

1. [What are you looking for when a request fails?](#what-are-you-looking-for-when-a-request-fails)
2. [Why should you test from the original caller?](#why-should-you-test-from-the-original-caller)
3. [What does each error tell you?](#what-does-each-error-tell-you)
4. [How do you trace a Service name to ready Pods?](#how-do-you-trace-a-service-name-to-ready-pods)
5. [How do you separate an application problem from a network problem?](#how-do-you-separate-an-application-problem-from-a-network-problem)
6. [How does the path change for traffic from outside the cluster?](#how-does-the-path-change-for-traffic-from-outside-the-cluster)
7. [How do you confirm the repair?](#how-do-you-confirm-the-repair)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

Suppose a `frontend` Pod makes one request to the `orders` Service:

```text
http://orders:8080/api/orders
```

That short URL hides a chain of Kubernetes decisions:

1. The Pod's DNS resolver turns `orders` into the ClusterIP of a Service.
2. The `orders` Service describes the destination port and selects a group of Pods.
3. EndpointSlices hold the addresses of the ready Pods behind that Service.
4. The cluster's Service data plane sends the connection to one endpoint.
5. NetworkPolicy rules allow the source and destination to communicate.
6. The orders process accepts the connection and handles `/api/orders`.

Each step passes the request to the next. A networking problem appears when one step produces a result that is incompatible with the next. For example, DNS may return the correct Service address while the Service has an empty endpoint list. The name works, and the empty EndpointSlice marks the stopping point.

This article answers seven questions:

1. **What are you looking for when a request fails?**
2. **Why should you test from the original caller?**
3. **What does each error tell you?**
4. **How do you trace a Service name to ready Pods?**
5. **How do you separate an application problem from a network problem?**
6. **How does the path change for traffic from outside the cluster?**
7. **How do you confirm the repair?**

## What are you looking for when a request fails?
<!-- section-summary: Find the first step in the request path that produces an unexpected result. -->

Follow the request and find the first broken handoff. Every successful check proves one part of the path and reduces the number of remaining causes.

The request succeeds only when every handoff returns a usable result. DNS must return the intended Service, the Service must have ready endpoints, the ports must line up, policy must allow the flow, and the orders process must accept the connection:

The Service handoff is implemented by the cluster's data plane. Some clusters use kube-proxy-managed packet rules, while others use CNI or eBPF-based Service handling. The implementation changes the available diagnostics, while the same logical contract remains: traffic for the Service address and port must reach one usable endpoint and target port.

| Handoff | Question | Healthy result |
|---|---|---|
| Application to DNS | What address belongs to `orders`? | The orders Service ClusterIP |
| Service to EndpointSlice | Which ready Pods serve the orders? | One or more current Pod addresses |
| Service port to Pod port | Where should the connection arrive? | The port used by the orders process |
| Source to destination | Is this flow allowed? | Egress and ingress rules permit it |
| Socket to application | Is the process ready to answer? | A response from the requested path |

Suppose DNS returns `10.96.42.10`, the Service has an empty EndpointSlice, and the request eventually times out. DNS has completed its job. The empty EndpointSlice is the first unexpected result, so the next useful check is the Service selector and Pod readiness.

This order matters because later layers depend on earlier ones. Editing NetworkPolicy while the Service selects zero Pods spends effort on a layer the request has yet to reach.

Treat the process as a binary search over one packet path. If name resolution fails, everything after DNS is still untested. If direct Pod requests work but the ClusterIP fails, the application, endpoint listener, and caller-to-Pod path have been substantially exercised; the remaining gap is around Service configuration or its data plane. The question at each step is not “what could be broken?” but “what is the earliest transition I have not yet proved?”

Keep the request coordinates fixed while making that search: source Pod, namespace, destination name or IP, port, protocol, path, and relevant headers. Changing several coordinates at once can produce a different path and a misleading success.

![A Kubernetes request passes through six clear handoffs from the caller to the application, with each handoff labelled by the question it answers](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/request-handoff-chain.png)

*Treat each Kubernetes object as one handoff in the request path.*

## Why should you test from the original caller?
<!-- section-summary: The source Pod determines DNS search paths, network identity, routes, and policy selection. -->

The source of a request changes the path. A laptop uses the laptop's DNS resolver. A Pod in `shop` receives search domains for `shop`, while a Pod in `payments` receives search domains for `payments`. NetworkPolicy also selects Pods by namespace and labels, so two Pods can reach different destinations even when they run the same command.

The original Pod also contributes its network namespace, source IP, node, IP-family configuration, routing table, CNI state, egress policy, and any service-mesh sidecar. A random debug Pod can differ in several of those properties and produce a successful request that says little about the failing application path.

Start by writing down one exact request:

```text
caller:      frontend Pod in namespace shop
destination: orders:8080/api/orders
protocol:    HTTP over TCP
result:      request fails
```

Then run the request from the caller:

```bash
kubectl exec -n shop <frontend-pod> -- curl -sv http://orders:8080
```

This test reuses the caller's DNS configuration, source address, labels, routes, and policies. Its result describes the same path as the application request.

Small production images often contain only the application binary. Kubernetes supports ephemeral debug containers for this situation:

```bash
kubectl debug -n shop pod/<frontend-pod> \
  -it \
  --image=busybox
```

An ephemeral container attached to the Pod shares its network namespace, so tools such as `nslookup`, `wget`, or `curl` observe the same network identity. Follow the access and image rules of your cluster before using a debug image.

The word “same” matters at several layers. `curl orders` from a Pod in another namespace may resolve a different fully qualified name. A debug Pod with different labels may be allowed by a NetworkPolicy that denies `frontend`. A Pod on another node may avoid the broken node route. A request outside the mesh sidecar may bypass interception. The closer the diagnostic process is to the real caller, the fewer of those variables change silently.

## What does each error tell you?
<!-- section-summary: An error shows how far the request travelled and suggests the next boundary to inspect. -->

An error is a clue about the furthest layer that responded.

### A. `NXDOMAIN` or “unknown host”

The DNS resolver finished the lookup and returned zero matching records. Check the Service name, namespace, and the caller's DNS search path.

For example, a Pod in `shop` that requests `orders` searches for `orders.shop.svc.cluster.local`, whereas a Pod in `payments` searches for `orders.payments.svc.cluster.local`.

### B. “Connection refused”

The request reached an address and a TCP response rejected the connection. This commonly means that the application listens on a different port or interface.

For example, the Service may forward to `targetPort: 3000` while the orders process listens on `8080`. The address is reachable; the socket contract is wrong.

A refusal is stronger evidence than a silent timeout because some network component returned a TCP reset. The reset can come from the destination host or from Service forwarding behaviour when usable endpoints are absent, so it narrows the path without identifying one component by itself.

### C. A connection timeout

The client deadline expired before a useful response arrived. Packet filtering, an unreachable route, or an application that accepts a connection and then stalls can all create this result. A timeout identifies a broad part of the path, so use the next check to split it into smaller questions.

### D. HTTP `404`, `500`, `502`, or `503`

An HTTP-speaking component answered. Identify that component before changing the cluster.

- A JSON `404` from the orders API suggests that the route reached application code and `/api/orders` is the next thing to inspect.
- A Gateway controller's default `404` suggests that the hostname or path matched zero routes.
- A proxy-generated `503` often points toward an empty or unhealthy backend set.

Headers, response bodies, controller logs, and application logs help identify the responder.

### E. One request in three fails

The ratio may match the backend count. A Service with three endpoints can send roughly one third of requests to a single unhealthy Pod. Test each endpoint directly and compare its listener, readiness, image version, and logs with the other replicas.

Other results fit the same evidence model:

| Result | What has probably happened | Next boundary |
|---|---|---|
| DNS query timeout | The resolver received no DNS answer | DNS Service reachability, CoreDNS, caller egress |
| `Network is unreachable` or `No route to host` | The kernel lacks a usable route to the destination | CNI routes, node networking, destination address |
| TLS handshake or certificate error | TCP reached a TLS endpoint | SNI hostname, certificate, listener configuration |
| HTTP `401` or `403` | An HTTP component processed the request | Authentication, authorisation, or proxy policy |
| TCP connects and the response hangs | A listener accepted the connection | Application protocol, dependency call, or return path |

Status codes and transport errors remain clues rather than universal proofs. The responsible proxy, CNI, and Service implementation can shape the exact error, so pair the client result with object status and component logs.

## How do you trace a Service name to ready Pods?
<!-- section-summary: Resolve the name, inspect the Service contract, and read the EndpointSlices produced from its selector. -->

Begin with the name used by the application. `getent` exercises the operating-system resolver path used by many applications, while `nslookup` sends an explicit DNS query and shows the DNS answer:

```bash
kubectl exec -n shop <frontend-pod> -- getent hosts orders
```

Then inspect the DNS answer directly:

```bash
kubectl exec -n shop <frontend-pod> -- nslookup orders
```

Assume the answer is `10.96.42.10`. That address should match the orders Service:

```bash
kubectl -n shop get service orders -o wide
kubectl -n shop get service orders -o yaml
```

That expectation applies to an ordinary ClusterIP Service. A headless Service has `clusterIP: None`, and its DNS answer can contain Pod or endpoint addresses directly. Check the Service type before treating the absence of a virtual IP as a DNS failure.

Inspect the Service:

```bash
kubectl get svc orders -n shop -o yaml
```

The Service contains two related port values:

```yaml
spec:
  clusterIP: 10.96.42.10
  selector:
    app: orders
  ports:
    - port: 8080
      targetPort: 3000
```

`port: 8080` is the port used by callers. `targetPort: 3000` is the port used on a ready orders Pod.

Next, read the computed backend list:

```bash
kubectl get pods -n shop \
  -l app=orders \
  -o wide

kubectl get endpointslices -n shop \
  -l kubernetes.io/service-name=orders
```

EndpointSlices connect the Service definition to real Pod addresses. Their contents lead to a few common explanations:

```yaml
endpoints:
  - addresses:
      - 10.244.2.17
    conditions:
      ready: true
      serving: true
      terminating: false
    targetRef:
      kind: Pod
      name: orders-6d78bf5c7f-k2p9v
ports:
  - port: 3000
```

This record says that Kubernetes currently associates one usable orders Pod with endpoint port `3000`. The address, conditions, Pod reference, and port are the concrete state consumed by the Service data plane.

- **The endpoint list is empty.** Compare the Service selector with Pod labels, then inspect Pod readiness. A Pod can run while its readiness condition keeps it out of the ready endpoint set.
- **The endpoint port differs from the application port.** Compare `targetPort`, named container ports, and the process listener.
- **Several endpoints appear and one behaves differently.** Request each Pod address directly and compare the outlier with the healthy replicas.

Endpoint readiness has one deliberate exception. A Service with `publishNotReadyAddresses: true` can publish endpoints before they become ready, often for peer discovery. Inspect that Service field before treating every published address as evidence that the application is ready for ordinary traffic.

Use a Pod address from the EndpointSlice and its endpoint port for a direct test:

```bash
kubectl exec -n shop <frontend-pod> -- \
  curl -v http://10.244.2.17:3000/health
```

This request bypasses the Service address while keeping the same source. When the Pod request succeeds and the Service request fails, the Service data path deserves attention. When both fail, continue toward the listener and policy checks.

Test every ready address when results are intermittent:

```text
10.244.2.17:3000 -> 200
10.244.3.22:3000 -> 200
10.244.5.31:3000 -> timeout
```

The pattern changes “the Service sometimes fails” into “the original caller cannot reach one specific endpoint.” Compare that Pod's node, readiness, listener, labels, policy selection, and CNI path with the two healthy endpoints. The Service abstraction is still useful, but direct tests reveal the concrete member that disagrees with it.

![A decision path traces orders from DNS to the Service, EndpointSlices, one direct Pod request, and the application listener](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/service-debugging-path.png)

*Each result chooses the next boundary to inspect.*

## How do you separate an application problem from a network problem?
<!-- section-summary: Compare loopback, Pod-address, and real-caller requests, then inspect policy for the remaining boundary. -->

Three requests reveal three different boundaries.

### A. Request the application through loopback

```bash
kubectl exec -n shop <orders-pod> -- \
  wget -qO- http://127.0.0.1:3000/health
```

This asks whether the process can answer inside its own container. An application error here directs attention to startup state, configuration, logs, and the requested path.

Check the socket when the request fails or the expected port is unclear:

```bash
kubectl exec -n shop <orders-pod> -- ss -lnt
```

An entry for `127.0.0.1:3000` accepts only loopback traffic. An entry for `0.0.0.0:3000` accepts traffic arriving through the Pod's network interface as well.

### B. Request the application through the Pod address

Use the direct `10.244.2.17:3000/health` request from the original caller. This preserves the caller's network context while bypassing Service translation.

When loopback works and the Pod address fails, inspect the bind address. A process bound to `127.0.0.1` serves only loopback traffic. A server intended for Pod traffic commonly binds to `0.0.0.0` or the Pod address.

### C. Request the Pod from the original caller

The direct endpoint request from `frontend` adds the Pod network and policy to the path. If the same Pod answers locally and times out from `frontend`, inspect the policies that select both ends:

```bash
kubectl get networkpolicy -A
```

Kubernetes evaluates egress and ingress separately. For `frontend -> orders:3000`:

1. Policies selecting `frontend` determine which egress flows it can send.
2. Policies selecting orders Pods determine which ingress flows they can receive.
3. An isolated connection needs an allowed result in both directions.

NetworkPolicies combine additively. When several policies select one Pod, their allowed flows form a union. Read all selecting policies before assuming that one file contains the whole policy result.

### D. Inspect packets after the logical checks agree

Packet capture becomes useful when the name, Service, EndpointSlice, target port, application listener, and policy intent all look correct while the real connection still times out. Capture close to both ends through the debugging method supported by the cluster.

Use `tcpdump` from a supported Pod or Node debugging environment and keep the capture scoped to the current endpoint, port, and time window.

If the caller repeatedly sends TCP `SYN` packets while the destination sees zero packets, the loss occurs between the source and destination. If the destination sees the `SYN` and sends `SYN-ACK` while the caller never receives it, the return path is the next boundary. If the three-way handshake completes, the investigation moves to TLS or the application protocol.

Packets report what the data plane actually carried. They are most useful after the object-level checks have reduced the question to a specific source, destination address, port, and time window.

## How does the path change for traffic from outside the cluster?
<!-- section-summary: External traffic adds public DNS, an edge address, TLS, and an Ingress or Gateway route before the Service. -->

A request from another Pod starts near the Service. A request from a browser begins several layers earlier:

An external request crosses a sequence of independently testable boundaries: public DNS, the public address, the TCP and TLS listener, the hostname and path route, the Service port, the EndpointSlice backend set, and finally the Pod listener. Test them in that order so each result narrows the remaining search.

Gateway API is the recommended starting point for new Kubernetes edge-routing designs. Ingress remains stable and supported, while its API is frozen. The debugging method stays the same for either choice: prove the additional edge layers before revisiting the already-working internal Service path.

For an outside request, test public DNS, the edge address, TLS, host and path routing, the Service, and the current endpoints in that order. Preserve the real hostname when testing a particular edge address so TLS and HTTP routing receive the same name a user supplies.

For example, `--resolve` can direct one hostname to a chosen load-balancer address while preserving both TLS SNI and the HTTP `Host` value:

```bash
curl -vk \
  --resolve api.example.com:443:<LOAD_BALANCER_IP> \
  https://api.example.com/orders
```

If this works while the normal public name fails, the added evidence points toward public DNS. If it reaches the controller and returns its default `404`, public addressing and the edge listener worked far enough for hostname or path matching to become the next boundary. If internal Service access already works, retain that evidence instead of restarting at Pod networking.

The response suggests the next layer:

| Result | Layer that answered | Next check |
|---|---|---|
| DNS returns zero addresses | Public DNS | Record name and published address |
| TLS certificate error | Edge listener | Hostname, certificate, Secret, listener status |
| Controller-generated `404` | HTTP edge | Hostname and path rules |
| Controller-generated `502` or `503` | Route and upstream selection | Service port, endpoints, policy, backend readiness |
| Catalog API returns `500` | Application | Application logs and dependencies |

Controller implementations use different status fields and response formats. Compare the response with route conditions and the relevant controller logs.

## How do you confirm the repair?
<!-- section-summary: Repeat the original request and one boundary check after changing the smallest responsible configuration. -->

A repair is not confirmed until the original failing request succeeds from the original caller.

Repeat the original request:

```bash
kubectl exec -n shop <frontend-pod> -- curl -sv http://orders:8080
```

One success can still miss a faulty replica. Repeat the Service request enough times to exercise the backend set, or call every current EndpointSlice address directly. Confirm that all expected endpoints are ready and that the repair preserved the intended policy boundary instead of routing around it.

The complete workflow is compact enough to reuse:

1. Reproduce the exact request from the original caller.
2. Resolve the name and compare the answer with the Service.
3. Inspect the Service selector, `port`, and `targetPort`.
4. Read the EndpointSlices and test each Pod endpoint from the caller.
5. Compare loopback, Pod-address, and ClusterIP requests to isolate the application, Pod network, and Service data plane.
6. Inspect source egress and destination ingress policies when the direct Pod path fails.
7. Use packet capture when the logical state agrees but the real path still drops packets.
8. Repeat the original request after the repair.

At every step, write down the last result that worked and the first result that failed. That boundary gives the next command a clear, immediate, reproducible purpose.

Recording both results also makes the diagnosis reproducible: another operator can repeat the same boundary test instead of beginning again from a vague report.

## Check Your Answers
<!-- section-summary: Revisit the request path from its first handoff through the final repair check. -->

:::expand[What are you looking for when a request fails?]{kind="recap"}
Follow one request and find the first handoff that produces an unexpected result. If DNS returns the correct Service address and the EndpointSlice is empty, DNS has completed its part. The Service selector and Pod readiness are the next checks.
:::

:::expand[Why should you test from the original caller?]{kind="recap"}
The source Pod determines DNS search paths, network identity, routes, and policy selection. A request from the original caller exercises the same path as the application. A laptop or a Pod in another namespace exercises a different path.
:::

:::expand[What does each error tell you?]{kind="recap"}
An unknown-name result points to DNS. A quick refusal points toward the listener or port. A timeout covers routing, filtering, and a stalled application. An HTTP response identifies a proxy or application that handled the request. The result tells you which boundary to inspect next.
:::

:::expand[How do you trace a Service name to ready Pods?]{kind="recap"}
Resolve the application name from the caller, compare the answer with the Service ClusterIP, inspect `port`, `targetPort`, selector, and Pod labels, and then read the EndpointSlices. A direct request to each endpoint separates a shared Service-path problem from a single backend problem.
:::

:::expand[How do you separate an application problem from a network problem?]{kind="recap"}
Request the application through loopback, then through its Pod address, and finally from the original caller. These checks add the bind interface, Pod network, and policy one layer at a time. The first change in result identifies the boundary to inspect.
:::

:::expand[How does the path change for traffic from outside the cluster?]{kind="recap"}
External traffic adds public DNS, an edge address, TLS, and an Ingress or Gateway route before the Service. Preserve the real hostname in tests, then use the response, route conditions, and controller logs to identify the layer that answered.
:::

:::expand[How do you confirm the repair?]{kind="recap"}
Repeat the original request from the original caller. Then exercise the relevant backend set or inspect every EndpointSlice address so one successful request does not hide a failing replica.
:::

## References

- [Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Official flow for checking a Service, DNS, EndpointSlices, and Pods.
- [Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/) - Official checks for Pod resolver configuration and cluster DNS components.
- [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Official `kubectl exec` and ephemeral-container techniques.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Service and port-mapping behaviour.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Official backend discovery and endpoint conditions.
- [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Official ingress, egress, isolation, and additive-rule behaviour.
- [Gateway API Status](https://gateway-api.sigs.k8s.io/guides/status/) - Official status conditions for Gateway API resources.

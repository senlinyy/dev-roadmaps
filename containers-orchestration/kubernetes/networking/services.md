---
title: "Services"
description: "Understand how a Kubernetes Service gives callers one stable application identity while Pods are replaced, scaled, and moved."
overview: "Pods are temporary application instances. A Service is the stable application identity, EndpointSlices record its current instances, readiness decides which instances may receive traffic, and the cluster data plane steers each connection."
tags: ["services", "selectors", "endpoints", "dns", "kubectl"]
order: 1
id: article-containers-orchestration-kubernetes-networking-services
---

## Table of Contents

1. [Why is a Pod IP a poor application address?](#why-is-a-pod-ip-a-poor-application-address)
2. [What stays stable when you create a Service?](#what-stays-stable-when-you-create-a-service)
3. [How does a Service know which Pods belong to it?](#how-does-a-service-know-which-pods-belong-to-it)
4. [What happens to one request?](#what-happens-to-one-request)
5. [Why can a Running Pod be left out?](#why-can-a-running-pod-be-left-out)
6. [When would a Service work differently?](#when-would-a-service-work-differently)
7. [How do you find the broken link?](#how-do-you-find-the-broken-link)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

Kubernetes has to solve a basic identity problem: an application can remain the same while every process implementing it changes.

Suppose a payments application currently runs as three Pods:

```text
payments application

Pod A    10.244.1.7
Pod B    10.244.2.4
Pod C    10.244.3.9
```

Another application needs to send a payment request. It could connect to `10.244.2.4`, but that address means “this particular Pod.” The caller really means “the payments application,” regardless of which replicas happen to be alive when the request arrives.

A Kubernetes Service separates those two identities. The caller uses one stable application name and port. Kubernetes maintains the changing set of Pod addresses behind that name.

The central model for this article is:

- **Pods are application instances.** They are created, replaced, rescheduled, and removed.
- **A Service is the stable identity of the application.** Callers depend on this identity.
- **EndpointSlices are the current mapping from that identity to concrete instances.** They record the addresses and conditions the networking data plane can use.

That model leads to seven questions:

1. **Why is a Pod IP a poor application address?**
2. **What stays stable when you create a Service?**
3. **How does a Service know which Pods belong to it?**
4. **What happens to one request?**
5. **Why can a Running Pod be left out?**
6. **When would a Service work differently?**
7. **How do you find the broken link?**

## Why is a Pod IP a poor application address?
<!-- section-summary: A Pod IP reaches one temporary instance, while a caller needs the stable identity of the application implemented by many changing instances. -->

A Pod IP is a real, usable network address. Kubernetes networking is designed so that Pods can communicate directly through their Pod IPs. The problem is the meaning and lifetime of that address.

`10.244.2.4` identifies one Pod. The payments application can outlive that Pod and every other member of the current replica set.

Imagine that a Deployment maintains three payments replicas. Today their addresses are:

```text
10.244.1.7
10.244.2.4
10.244.3.9
```

When the team deploys a new version, Kubernetes may terminate all three and create replacements:

```text
10.244.2.19
10.244.4.12
10.244.5.3
```

The application is still logically `payments`, but every concrete network location has changed. A node failure can cause the same replacement. Autoscaling changes the set even when the software version stays the same:

```text
10:00    3 Pods
10:05    8 Pods
10:20    4 Pods
```

If every caller stored the Pod list, each caller would have to watch Kubernetes, detect newly created Pods, wait until they were usable, remove terminating Pods, and choose a destination for every connection. Each client would become a small and incomplete Kubernetes controller.

The Service adds one level of indirection:

1. the caller asks for the stable payments identity;
2. Kubernetes finds the current eligible instances behind that identity;
3. the network sends the connection to one of those instances.

![A payments caller keeps one Service name while old Pod addresses retire and newly ready Pod addresses join the backend set](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/service-stable-contract.png)

*The caller keeps the application identity. Kubernetes keeps the changing list of concrete locations.*

This separation is what allows a Deployment to roll out a release or an autoscaler to change the replica count without forcing every client to update its configuration at the same moment.

Follow the alternative to see the cost. If frontend stores three Pod IPs, it must learn when a rollout creates replacements, decide whether each replacement is ready, remove terminating instances, and distribute the changed list before making requests. Every other caller must repeat the same control-plane work. A Service centralizes that changing membership behind one identity designed for clients to depend on.

The Service does not make Pods permanent. It makes their replacement ordinary. A new ready payments Pod can enter the EndpointSlice, an old Pod can leave, and callers continue using `payments:80`. Stable discovery and dynamic membership are different state, updated by different parts of Kubernetes.

## What stays stable when you create a Service?
<!-- section-summary: A normal Service provides a stable DNS name, virtual ClusterIP, and caller-facing port while backend Pod names, addresses, count, and readiness change. -->

Consider a normal Service for the payments application:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments
spec:
  selector:
    app: payments
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Kubernetes may allocate this contract:

```text
Service name: payments
ClusterIP:    10.96.18.42
Service port: 80
```

A Pod in the same namespace can normally call `http://payments:80`. The full cluster DNS name is commonly `payments.default.svc.cluster.local`.

For a regular Service, cluster DNS resolves that name to the ClusterIP:

The DNS answer maps `payments.default.svc.cluster.local` to `10.96.18.42`.

The caller-facing contract and the backend runtime change at different speeds:

| Stable Service contract | Changing backend state |
|---|---|
| Service name | Pod names |
| ClusterIP | Pod IP addresses |
| Service port | Number of Pods and their readiness |

The ClusterIP is a **virtual IP**. It exists as cluster networking state rather than as an address owned by one machine, one network interface, or one Service process. The cluster networking data plane treats packets sent to that virtual address as traffic for the Service and redirects each connection to an eligible backend.

The two port fields describe opposite sides of the contract:

- `port: 80` is the port callers use on the Service;
- `targetPort: 8080` is the port where the application listens inside each backend Pod.

Therefore a connection to `payments:80` can be delivered to `10.244.2.4:8080`. A useful way to remember the distinction is that `port` belongs to the stable public contract inside the cluster, while `targetPort` belongs to the backend implementation.

Kubernetes also supports named target ports, which are useful when the backend implementation evolves while callers continue using the same Service port.

For example, callers can keep using `payments:80` while the Service targets a container port named `http`. During a rollout, old and new Pod templates can associate that name with the application port appropriate to each version. The Service contract stays on port `80`; the backend implementation retains room to evolve behind it.

This is another indirection boundary:

```text
caller contract: payments:80
Service mapping: port 80 -> targetPort http
Pod contract:    named port http -> application listener
```

Diagnosis should verify every mapping rather than assume that seeing port `80` on the Service means the process itself listens on `80`.

A Service is responsible for stable discovery and routing. Workload controllers create the payments Pods and replace failed processes, while the application defines what healthy enough to receive traffic means. The Service provides a stable route to the endpoints Kubernetes currently considers eligible.

## How does a Service know which Pods belong to it?
<!-- section-summary: A selector defines logical membership, while EndpointSlices record the concrete addresses, ports, and conditions produced from that membership. -->

The Service needs a membership rule that survives replacement. Generated Pod names and Pod IPs change, so Kubernetes normally uses labels and a selector.

Suppose two payments Pods and one inventory Pod have these labels:

```yaml
# payments Pod A
metadata:
  labels:
    app: payments

# payments Pod B
metadata:
  labels:
    app: payments

# inventory Pod C
metadata:
  labels:
    app: inventory
```

The Service selector asks for `app: payments`. Pod A and Pod B belong to the logical backend set. Pod C belongs to inventory and stays outside this set.

The changing Pod-IP list lives in **EndpointSlice** objects rather than inside the Service object. A control-plane component watches Services and Pods, evaluates the selector, and maintains those EndpointSlices. An EndpointSlice is a Kubernetes API object containing concrete backend addresses, ports, address family information, and conditions such as readiness.

For example, the control plane may publish `10.244.1.7` with `ready: true` and `10.244.2.4` with `ready: false`.

This object makes the Service model concrete. The Service stores a stable identity and selector; the EndpointSlice stores the current network destinations and their conditions.

![The payments Service selector admits Pods with the payments label, readiness removes a warming candidate, and the EndpointSlice publishes the current usable address](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/selector-endpointslice-flow.png)

*Labels define membership. Endpoint conditions determine which members are eligible for ordinary traffic.*

Three separate questions now have separate answers:

| Question | Kubernetes object or field that answers it |
|---|---|
| Who are callers trying to reach? | Service name and ClusterIP |
| Which Pods belong to that application? | Service selector and Pod labels |
| Where are those Pods now, and are they usable? | EndpointSlices |

That distinction is especially valuable during debugging. If a Pod is absent from the EndpointSlice, first inspect whether its labels match the selector. If it is present with `ready: false`, membership succeeded and readiness is the next boundary to investigate.

A one-character mismatch is enough to create an empty backend set:

```yaml
# Service selector
selector:
  app: payments

# Pod label
labels:
  app: payment
```

Both the Service and the Pod can exist, and the Pod can be Running, but the selector matches nothing. These commands expose each part of the relationship:

```bash
kubectl get service payments -o yaml
kubectl get pods -l app=payments --show-labels
kubectl get endpointslices \
  -l kubernetes.io/service-name=payments -o yaml
```

## What happens to one request?
<!-- section-summary: DNS resolves the stable name, the caller connects to the virtual Service IP and port, and programmed network rules translate that connection to one eligible Pod address and target port. -->

Suppose a frontend Pod sends:

```http
GET http://payments/orders/123
```

Cluster DNS first resolves `payments` to the virtual Service address `10.96.18.42`. The frontend then tries to establish a connection to `10.96.18.42:80`.

At this point it is easy to imagine a Service process accepting the request and proxying it to a Pod. The virtual IP is instead implemented by the cluster's networking data plane and its packet-processing rules.

With the standard Kubernetes implementation, kube-proxy watches Services and EndpointSlices. It programs node networking rules so that traffic for a Service address can be translated to a selected backend. Depending on the cluster, those rules may use nftables, iptables, or another implementation. Some networking systems replace kube-proxy and program their own data plane, but they consume the same Service and endpoint intent.

Kube-proxy's usual role is to prepare the node's packet-processing rules. Those rules handle the traffic directly instead of sending every application request through a kube-proxy userspace forwarding loop.

For one chosen endpoint, the packet can effectively change from:

```text
before backend selection
src = 10.244.5.10
dst = 10.96.18.42:80

after backend selection
src = 10.244.5.10
dst = 10.244.2.4:8080
```

This destination translation is commonly described as destination network address translation, or DNAT. The cluster's Pod network then carries the packet to `10.244.2.4`, even when that Pod is running on another node.

An ordinary Service operates mainly at the transport layer. Its common protocols are TCP, UDP, and SCTP. An HTTP path such as `/orders/123` remains opaque to this backend selection.

For TCP, backend selection is best understood at the connection level:

1. the frontend opens a TCP connection to the Service;
2. the data plane chooses an eligible endpoint for that connection;
3. all HTTP requests reused over that keep-alive connection normally continue through the same connection.

Ten HTTP requests on one persistent connection provide one connection-level selection sample. Ten independently opened connections provide ten opportunities to select a backend. Higher-level routing based on hosts, paths, headers, or request weights belongs to systems such as Ingress, Gateway API, or a service mesh, which appear later in the roadmap.

This explains why a simple request count can give a surprising distribution. A client that opens one keep-alive connection and sends many HTTP operations through it may remain with one selected Pod. The Service data plane did choose an endpoint; it chose it for the transport connection rather than re-reading each HTTP path. The Service is not an HTTP proxy and has no basis for routing `/orders/123` differently from `/health` on that same connection.

## Why can a Running Pod be left out?
<!-- section-summary: Running reports that containers have started, while readiness reports whether an endpoint should receive new Service traffic. -->

A Pod can be Running while its application is still loading configuration, opening database connections, warming caches, or waiting for another required dependency. The process exists, but sending new payment traffic to it would fail.

This is why Kubernetes keeps **running state** and **readiness** separate. A readiness probe answers the traffic question: “Should this replica receive new connections now?”

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
```

Suppose the cluster reports:

| Pod | Process running? | Ready? | Ordinary Service traffic? |
|---|---:|---:|---:|
| Pod A, `10.244.1.7` | Yes | Yes | Yes |
| Pod B, `10.244.2.4` | Yes | No | No |
| Pod C, `10.244.3.9` | Yes | Yes | Yes |

Pod B remains available for logs and inspection, while the failing readiness probe marks its endpoint unready. Normal Service routing generally avoids that endpoint until the probe succeeds.

During startup, this gives a clean handoff. The process can start and the Pod can become Running while initialization continues. Only after `/ready` succeeds does endpoint eligibility turn true and ordinary new Service traffic begin. During shutdown, terminating and serving conditions let the endpoint move out of the normal new-traffic set while existing work is drained according to the surrounding implementation.

Readiness therefore protects callers as well as the Pod. It prevents a replica that is alive but unable to serve correctly from becoming part of the stable application promise. A probe that checks an irrelevant condition weakens that promise; a probe tied to the application's ability to receive its real traffic makes endpoint eligibility meaningful.

Selector failure looks different from readiness failure:

- **Absent from EndpointSlices:** investigate selector matching and whether the control plane has published the Pod as a member.
- **Present with `ready: false`:** membership succeeded, and the Pod is currently ineligible for normal new traffic.

EndpointSlices can also distinguish `serving` and `terminating`. A terminating endpoint may still be serving existing work while Kubernetes removes it from ordinary new traffic. During shutdown, these conditions help the data plane drain traffic instead of treating every endpoint as simply present or absent. Kubernetes has fallback behavior when all available endpoints are terminating, so inspect the actual conditions when shutdown behavior matters.

## When would a Service work differently?
<!-- section-summary: Service types and special discovery modes keep some form of stable identity while changing the entry point, DNS answer, backend source, or component that chooses the concrete destination. -->

The normal model built so far has four stages: DNS resolves the Service name, the caller connects to the ClusterIP, the Service data plane selects an endpoint, and the connection reaches one ready Pod.

That is a `ClusterIP` Service, the default type. Kubernetes supports variations because callers may live outside the cluster, clients may need individual member identities, or the backend may come from a separately managed endpoint set.

| Service form | What changes |
|---|---|
| `ClusterIP` | A stable internal virtual IP leads to backend endpoints. |
| `NodePort` | A port on each node provides another entry point into the Service. |
| `LoadBalancer` | The environment can add an external load-balancer address in front of the Service. |
| Headless Service | No ClusterIP is allocated; DNS exposes backend endpoint addresses. |
| `ExternalName` | DNS returns an alias to an external hostname; Kubernetes performs no Service proxying. |
| Service without a selector | EndpointSlices are supplied separately instead of being derived from matching Pods. |

NodePort and LoadBalancer generally build on the ClusterIP mechanism. The next article follows those extra network boundaries in detail.

A headless Service explicitly requests a different discovery contract:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments
spec:
  clusterIP: None
  selector:
    app: payments
```

DNS can now return addresses such as `10.244.1.7`, `10.244.2.4`, and `10.244.3.9` instead of one ClusterIP. This Service skips the normal virtual-IP proxying path. The client sees individual members and decides how to connect to them.

This model is useful when backend identity matters, as it can for StatefulSets, databases, and distributed systems.

A selectorless Service keeps the stable Service identity but obtains its endpoints from separately managed EndpointSlices.

An ExternalName Service behaves differently again. It creates a DNS alias to an external hostname. The connection follows DNS to that outside destination, bypassing ClusterIP routing and Kubernetes endpoint selection.

## How do you find the broken link?
<!-- section-summary: Prove the Service path in order from caller and DNS through the Service contract, selector, EndpointSlice, readiness, data plane, Pod network, and application. -->

A Service is a chain of responsibilities:

1. the caller uses the expected name and port;
2. DNS resolves the name;
3. the Service object exposes the expected ClusterIP, port, target port, and selector;
4. Pods match the selector;
5. EndpointSlices publish the expected addresses and conditions;
6. the network data plane can steer traffic to an endpoint;
7. the Pod network can carry the packet;
8. the application is listening and responds.

Begin with the Service object:

```bash
kubectl get service payments -o wide
kubectl describe service payments
```

Confirm values such as:

```text
ClusterIP:   10.96.18.42
Port:        80
TargetPort:  8080
Selector:    app=payments
```

Next, ask whether any Pods match the selector:

```bash
kubectl get pods -l app=payments --show-labels
```

If this returns zero Pods, the Service exists but its membership rule currently identifies no backend. Inspecting node rules before fixing the selector would skip the first known failure.

Then inspect what Kubernetes has published as the actual backend set:

```bash
kubectl get endpointslices \
  -l kubernetes.io/service-name=payments

kubectl get endpointslices \
  -l kubernetes.io/service-name=payments \
  -o yaml
```

Look for endpoint entries and their conditions:

```yaml
endpoints:
  - addresses:
      - 10.244.1.7
    conditions:
      ready: true
```

If the Pod is present but unready, inspect the Pod's readiness and events:

```bash
kubectl get pods
kubectl describe pod payments-abc
```

Now bypass the Service and test one endpoint directly from a suitable debug Pod:

```bash
curl http://10.244.1.7:8080
```

If the direct endpoint fails, investigate the application listener, target port, Pod networking, and any NetworkPolicy affecting the caller before moving outward to the Service virtual IP. If the endpoint works directly while `curl http://payments:80` fails, the backend application path has been proved and the Service path remains to be explained.

Test from the original caller where possible. Another Pod can have a different namespace search path, source label, egress policy, node route, or service-mesh interception. A direct endpoint request from the real caller preserves those source properties while removing only DNS and Service translation from the path.

The comparison creates strong evidence:

```text
localhost on payments Pod fails -> application or listener
localhost works, caller to Pod IP fails -> Pod network, policy, or bind address
caller to Pod IP works, ClusterIP fails -> Service mapping or data plane
ClusterIP works, Service name fails -> DNS or resolver context
```

Change one layer per test and keep the source, port, and protocol constant. The first result that changes identifies the boundary that deserves the next investigation.

Test DNS from the same namespace and network context as the real caller:

```bash
nslookup payments
```

For a regular Service, the answer should normally include the Service ClusterIP. If DNS, the Service object, matching Pods, EndpointSlices, readiness, and direct Pod connectivity all look correct, move to the remaining networking layer: kube-proxy or its replacement, the CNI-managed Pod network, NetworkPolicies, and node-level data-plane rules.

![A Service investigation proves each boundary from the real caller through DNS, the Service contract, EndpointSlices, policy and network, and the application response](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/service-debugging-summary.png)

*Stop at the first failed proof. Repair that responsibility, then repeat the original request from the original caller.*

The full model now has a control-plane side and a data-plane side. The Service selector and EndpointSlice controller maintain the mapping from application identity to current endpoints. Kube-proxy or an alternative watches that state and programs the network. Packets then travel from the Service virtual IP to a concrete Pod address.

Condensed into one relationship:

> Stable application identity + dynamic healthy membership + network forwarding = a Kubernetes Service.

When a Service fails, identify which term in that relationship is missing. This turns “Service networking” from one opaque mechanism into a short sequence of testable responsibilities.

## Check Your Answers
<!-- section-summary: Reconstruct a Service from its stable identity, dynamic membership, endpoint eligibility, packet steering, and application response. -->

:::expand[Why is a Pod IP a poor application address?]{kind="recap"}
A Pod IP identifies one current application instance. Rollouts, rescheduling, and autoscaling replace or resize that instance set. Callers need the stable application identity while Kubernetes maintains the changing locations.
:::

:::expand[What stays stable when you create a Service?]{kind="recap"}
A normal Service gives callers a stable DNS name, virtual ClusterIP, and Service port. Pod names, Pod addresses, replica count, readiness, and the concrete endpoint chosen for a connection can change behind that contract.
:::

:::expand[How does a Service know which Pods belong to it?]{kind="recap"}
The Service selector matches Pod labels. The control plane turns that logical membership into EndpointSlices containing concrete addresses, ports, and conditions. The Service says who callers mean; EndpointSlices say where the current instances are.
:::

:::expand[What happens to one request?]{kind="recap"}
DNS resolves the Service name to a virtual ClusterIP. The caller opens a connection to the Service port, and network rules programmed by kube-proxy or another implementation translate the destination to one eligible Pod address and target port. The Pod network carries the packet to the application.
:::

:::expand[Why can a Running Pod be left out?]{kind="recap"}
Running means that the Pod's containers have started. Readiness answers whether the application should receive new Service traffic. A matching Pod can therefore remain Running while its EndpointSlice entry is marked unready and excluded from ordinary new connections.
:::

:::expand[When would a Service work differently?]{kind="recap"}
NodePort and LoadBalancer add entry points, a headless Service returns endpoint addresses instead of a ClusterIP, a selectorless Service uses separately managed EndpointSlices, and ExternalName returns a DNS alias. Each changes who discovers or chooses the concrete destination.
:::

:::expand[How do you find the broken link?]{kind="recap"}
Repeat the real request from the real caller, then prove DNS, the Service contract, selector matches, EndpointSlices, readiness, direct endpoint connectivity, policy, the data plane, and the application. The first failed proof identifies the next responsibility to inspect.
:::

## References

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Service behavior, selectors, ports, headless Services, selectorless Services, and ExternalName.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Official backend discovery model and endpoint conditions.
- [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) - Official description of Service virtual IPs, kube-proxy modes, and traffic policies.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Official naming behavior for regular and headless Services.
- [Configure Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official readiness-probe behavior.
- [Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Official layered checks for Service failures.

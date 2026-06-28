---
title: "DNS Inside the Cluster"
description: "Resolve Kubernetes Services by name, understand namespace search paths, and diagnose cluster DNS failures."
overview: "Cluster DNS lets workloads call Services by stable names instead of temporary IP addresses. This article follows devpolaris-web as it calls devpolaris-orders-api, then separates DNS evidence from Service, endpoint, policy, and application evidence."
tags: ["dns", "coredns", "services", "namespaces"]
order: 5
id: article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster
---

## Table of Contents

1. [Start with One Service Name](#start-with-one-service-name)
2. [Why Cluster DNS Exists](#why-cluster-dns-exists)
3. [Service DNS Names Have Pieces](#service-dns-names-have-pieces)
4. [The Pod Resolver Expands Short Names](#the-pod-resolver-expands-short-names)
5. [CoreDNS Answers From Cluster State](#coredns-answers-from-cluster-state)
6. [A DNS Answer Is Only the First Proof](#a-dns-answer-is-only-the-first-proof)
7. [How DNS Itself Fails](#how-dns-itself-fails)
8. [Headless Services Give Clients Pod Addresses](#headless-services-give-clients-pod-addresses)
9. [Production DNS Habits](#production-dns-habits)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Start with One Service Name
<!-- section-summary: Cluster DNS lets an app carry a stable Service name while Kubernetes turns that name into an address. -->

Start with one app setting. The `devpolaris-web` Pods need to call the orders API, so their config can say `http://devpolaris-orders-api.orders`. That value is readable for a human, but the runtime still needs an IP address before it can open a network connection.

**Cluster DNS** is the in-cluster name lookup system that answers that first question. The web Pod asks for the Service name, DNS returns the Service address, and then the normal Kubernetes Service path can continue toward ready backend Pods. Later checks may involve endpoints, policy, ports, and application health, but DNS is the first proof: can the name turn into an address?

Here is the request path we will build toward. The first part is DNS, and the later parts only make sense after the name lookup succeeds.

![Kubernetes cluster DNS request path from devpolaris-web through Pod resolver, kube-dns Service, CoreDNS Pods, Service record, ClusterIP answer, EndpointSlices, and orders API Pods](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/cluster-dns-request-path.png)

*DNS proves the name lookup first. The Service, EndpointSlices, policy, and application response still need their own proof after the address comes back.*

The useful habit is to keep the pieces separate during a real incident. If the name fails, DNS needs attention. If the name resolves and the Service has no endpoints, the selector, Pod labels, or readiness need attention. If the name resolves and endpoints exist, the next checks move toward policy, ports, and application behavior.

## Why Cluster DNS Exists
<!-- section-summary: Kubernetes DNS lets applications use stable Service names while Pods and endpoint IPs change during normal operations. -->

**Cluster DNS** is the DNS system Kubernetes provides inside the cluster. DNS means a name lookup system: an application asks for a readable name, and the resolver returns an address. In Kubernetes, the most common name an application asks for is a Service name such as `devpolaris-orders-api.orders.svc.cluster.local`.

The reason this exists is ordinary Kubernetes movement. A rollout replaces Pods. A node drain moves Pods away from a machine. Autoscaling adds more replicas during busy traffic. Each Pod can receive a new IP address, so application config should point at a stable Service name instead of a temporary Pod address such as `10.244.3.18`.

A **Service** gives the orders API a stable in-cluster identity. For a normal ClusterIP Service, Kubernetes creates a Service IP and publishes a DNS record for the Service name. The app calls the name, DNS returns the Service IP, and the Service sends traffic to ready backend Pods.

Start from the value the application should carry. The web app needs the orders API name, not a Pod IP:

```yaml
env:
  - name: ORDERS_API_BASE_URL
    value: http://devpolaris-orders-api.orders
```

That value has two concrete parts. `devpolaris-orders-api` is the Service name, and `orders` is the namespace. A web Pod in the `web` namespace needs both parts because the target Service lives in a different namespace.

The Service behind that name can stay small. The selector connects the stable Service name to the actual orders API Pods:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  selector:
    app.kubernetes.io/name: devpolaris-orders-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

That short namespace-qualified name is enough for normal in-cluster calls. The fully qualified form, `http://devpolaris-orders-api.orders.svc.cluster.local`, carries the same destination with every DNS piece written out.

## Service DNS Names Have Pieces
<!-- section-summary: A Kubernetes Service DNS name includes the Service, namespace, service record marker, and cluster domain. -->

A **Service DNS name** is the DNS name Kubernetes publishes for a Service. For a normal Service, the A or AAAA record resolves to the Service cluster IP. For our orders API, the full name usually looks like this:

```bash
devpolaris-orders-api.orders.svc.cluster.local
```

The pieces read from specific to broad. Writing them out helps reviewers see the exact namespace and cluster DNS area involved.

| Piece | Meaning in this article |
|---|---|
| `devpolaris-orders-api` | The Service name |
| `orders` | The namespace that owns the Service |
| `svc` | The DNS area for Kubernetes Services |
| `cluster.local` | The cluster domain, which many clusters use by default |

The cluster domain can be different in a real platform. Some clusters use a custom suffix, and platform teams usually document it beside the cluster bootstrap settings. Application teams should still rely on the Service name and namespace because those pieces carry the application intent.

The namespace piece is the part beginners most often miss. A Pod in the `orders` namespace can usually call `http://devpolaris-orders-api` because the resolver starts in the caller's namespace. A Pod in the `web` namespace should call `http://devpolaris-orders-api.orders` because the target Service lives somewhere else.

Here is the Service evidence an operator would expect. The cluster IP in this output should match the DNS answer for a normal ClusterIP Service.

```bash
kubectl -n orders get svc devpolaris-orders-api -o wide
```

```bash
NAME                    TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
devpolaris-orders-api   ClusterIP   10.96.42.18   <none>        80/TCP    12m   app.kubernetes.io/name=devpolaris-orders-api
```

The DNS answer for a normal ClusterIP Service should match the Service cluster IP. That IP can change if the Service gets recreated, so the app config should continue to store the name.

## The Pod Resolver Expands Short Names
<!-- section-summary: kubelet writes resolver settings into each Pod, and those settings decide how short names expand. -->

A **resolver** is the piece of the operating system or runtime that performs DNS lookups for a process. In Kubernetes, kubelet writes DNS settings into each Pod's `/etc/resolv.conf`. That file tells containers which DNS server to ask and which search suffixes to try for short names.

Inside a `devpolaris-web` Pod, the file often looks like this. This is one of the first files an operator should capture during DNS debugging.

```bash
kubectl -n web exec deploy/devpolaris-web -- cat /etc/resolv.conf
```

```bash
search web.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

The `nameserver` line points at the cluster DNS Service IP. The `search` line starts with the caller namespace, so a lookup for `devpolaris-orders-api` first expands under `web.svc.cluster.local`. The `ndots:5` option influences whether the resolver tries search-suffix forms before treating a name as complete.

Now the cross-namespace bug makes sense. If the web app asks for only `devpolaris-orders-api`, the resolver tries the `web` namespace first. The orders Service lives in `orders`, so the lookup returns a name error unless another Service with that short name exists in `web`.

```bash
kubectl -n web exec deploy/devpolaris-web -- nslookup devpolaris-orders-api
```

```bash
** server can't find devpolaris-orders-api.web.svc.cluster.local: NXDOMAIN
```

`NXDOMAIN` means the resolver received an answer saying the name has no record at that location. In this scenario, the useful fix is to include the destination namespace in application config.

```bash
kubectl -n web exec deploy/devpolaris-web -- nslookup devpolaris-orders-api.orders
```

```bash
Name:      devpolaris-orders-api.orders.svc.cluster.local
Address:   10.96.42.18
```

That output proves the Service name resolves from the same namespace as the caller. The next question is the server that returned this answer.

![Pod resolver search path showing a short name failing in the web namespace and a namespace-qualified Service name resolving in the orders namespace](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/resolver-search-path.png)

*A cross-namespace caller should include the destination namespace so the resolver does not stop in the caller's namespace first.*

## CoreDNS Answers From Cluster State
<!-- section-summary: Pods usually query the kube-dns Service, which routes DNS traffic to ready CoreDNS Pods. -->

**CoreDNS** is the common DNS server implementation used by Kubernetes clusters. Kubernetes usually exposes it through a Service named `kube-dns` in the `kube-system` namespace. The Service name stays `kube-dns` for compatibility, even when the actual Pods run CoreDNS.

The web Pod sends DNS traffic to the nameserver IP from `/etc/resolv.conf`. That IP usually belongs to the `kube-dns` Service. Kubernetes routes the DNS packet to a ready CoreDNS Pod, and CoreDNS answers Service and Pod DNS questions by watching Kubernetes objects through the API.

```bash
kubectl -n kube-system get svc kube-dns
```

```bash
NAME       TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
kube-dns   ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   46d
```

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns
```

```bash
NAME                       READY   STATUS    RESTARTS   AGE
coredns-6f6b679f8f-jh6w7   1/1     Running   0          46d
coredns-6f6b679f8f-vkwm2   1/1     Running   0          46d
```

```bash
kubectl -n kube-system get endpointslice -l kubernetes.io/service-name=kube-dns
```

```bash
NAME             ADDRESSTYPE   PORTS   ENDPOINTS                  AGE
kube-dns-x7m8r   IPv4          53      10.244.0.14,10.244.2.9     46d
```

The label `k8s-app=kube-dns` appears in Kubernetes documentation and many clusters. Managed platforms can add their own labels, so a team runbook should record the selector that works in that environment.

Now we have the first half of the request path. The app asks for a name, the Pod resolver sends the query to the cluster DNS Service, and CoreDNS returns the Service IP. The HTTP request still has more gates to pass.

## A DNS Answer Is Only the First Proof
<!-- section-summary: DNS success proves name resolution, while EndpointSlices and HTTP checks prove the backend path. -->

A successful DNS lookup answers one question: "Can this caller resolve this Service name?" The next proofs cover whether the Service has ready Pods, whether a NetworkPolicy allows the connection, and whether the app process is listening on the right port. Production debugging gets much clearer when those proofs stay separate.

For the web-to-orders path, the first proof is the lookup from the caller namespace. A lookup from another namespace can use a different search path and a different egress policy, so it can tell a different story.

```bash
kubectl -n web exec deploy/devpolaris-web -- nslookup devpolaris-orders-api.orders
```

```bash
Name:      devpolaris-orders-api.orders.svc.cluster.local
Address:   10.96.42.18
```

The second proof is the backend list for the Service. **EndpointSlices** are Kubernetes objects that store slices of backend endpoints for a Service, usually Pod IPs and ports. They are the better modern evidence source compared with the older Endpoints object, especially for larger Services and dual-stack clusters.

```bash
kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api
```

```bash
NAME                          ADDRESSTYPE   PORTS   ENDPOINTS                 AGE
devpolaris-orders-api-5xzl8   IPv4          3000    10.244.3.18,10.244.4.22   12m
```

The third proof is an actual application response through the same name the app uses. The health endpoint gives a small, bounded request instead of a full user workflow.

```bash
kubectl -n web exec deploy/devpolaris-web -- curl -sS -m 3 http://devpolaris-orders-api.orders/healthz
```

```bash
{"status":"ok","service":"orders-api"}
```

These checks separate common failure zones. The exact next step should follow the first failing row.

| Evidence | Likely area to inspect next |
|---|---|
| `NXDOMAIN` for `devpolaris-orders-api` from `web` | Service name, namespace, or missing Service |
| DNS resolves, EndpointSlices empty | Service selector, Pod labels, readiness, Deployment status |
| DNS resolves, endpoints exist, request times out | NetworkPolicy, CNI path, kube-proxy, target port, app listener |
| DNS resolves, HTTP returns `503` or app error | Application health, dependencies, logs, readiness design |

Here is a very normal incident shape. DNS returns `10.96.42.18`, and the Service has no ready endpoints. The next useful checks are Service selectors, Pod labels, readiness probes, and rollout status.

```bash
kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api
```

```bash
No resources found in orders namespace.
```

That output means the name exists and the backend list is empty. CoreDNS already did its job for the Service name.

## How DNS Itself Fails
<!-- section-summary: DNS troubleshooting starts from the caller Pod, then checks Pod resolver config, CoreDNS Pods, the kube-dns Service, EndpointSlices, logs, and policy. -->

DNS itself enters the investigation when a known cluster name fails from the caller Pod. A useful baseline name is `kubernetes.default`, because Kubernetes creates the default API Service in the `default` namespace. If that lookup times out from `devpolaris-web`, the problem is broader than the orders Service name.

```bash
kubectl -n web exec deploy/devpolaris-web -- nslookup kubernetes.default
```

```bash
;; connection timed out; no servers could be reached
```

A tight DNS debug bundle starts with the caller Pod's resolver file. This proves which nameserver the container is using and which search suffixes its resolver will try.

```bash
kubectl -n web exec deploy/devpolaris-web -- cat /etc/resolv.conf
```

```bash
search web.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

Then the bundle checks the DNS add-on path in `kube-system`. These commands focus on the shared DNS layer rather than the orders Service.

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system get svc kube-dns
kubectl -n kube-system get endpointslice -l kubernetes.io/service-name=kube-dns
kubectl logs --namespace=kube-system -l k8s-app=kube-dns --tail=50
```

Healthy evidence shows running CoreDNS Pods, a `kube-dns` Service on TCP and UDP port 53, ready EndpointSlices behind that Service, and CoreDNS logs without repeated errors. If the Pods are crashing, the logs and the CoreDNS ConfigMap become platform-team evidence.

NetworkPolicy can also create DNS symptoms. A namespace with default-deny egress blocks DNS traffic until a policy allows egress to the cluster DNS Pods on UDP and TCP port 53. The exact labels should come from the cluster, but this is the common shape for allowing `devpolaris-web` to query CoreDNS:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: web
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-web
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

This policy belongs in the networking review for locked-down namespaces. The next article goes deeper into NetworkPolicy, but DNS is the first egress rule many teams need after they enable default deny.

## Headless Services Give Clients Pod Addresses
<!-- section-summary: Headless Services return backend Pod addresses directly, which fits peer discovery for systems that need individual members. -->

A **headless Service** is a Service with `clusterIP: None`. A normal ClusterIP Service gives clients one Service IP, and Kubernetes distributes traffic to ready endpoints behind it. A headless Service publishes DNS answers for the backend Pods directly, so the client can see individual members.

This fits systems that need peer discovery. A database cluster, cache cluster, or message broker may need stable member names such as `orders-db-0`, `orders-db-1`, and `orders-db-2`. An ordinary HTTP API such as `devpolaris-orders-api` usually wants a normal Service because callers want the API rather than a list of individual API replicas.

Here is the headless Service shape for an orders database. This Service is meant for peer discovery instead of ordinary web-to-api traffic.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-db
  namespace: orders
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: orders-db
  ports:
    - name: postgres
      port: 5432
```

With a StatefulSet that uses `serviceName: orders-db`, members can receive stable DNS names like these. Those names identify individual members, which is the point of using this pattern.

```bash
orders-db-0.orders-db.orders.svc.cluster.local
orders-db-1.orders-db.orders.svc.cluster.local
orders-db-2.orders-db.orders.svc.cluster.local
```

Readiness still matters. Kubernetes DNS records for Pod hostnames through a headless Service normally depend on the Pod being ready, unless the Service sets `publishNotReadyAddresses: true`. Some peer-discovery systems need early records during bootstrap, but that setting should be a deliberate platform choice because clients may receive addresses for members that are still starting.

## Production DNS Habits
<!-- section-summary: Production teams keep names explicit, test from the caller, separate lookup evidence from traffic evidence, and watch DNS load. -->

The first habit is explicit config. Same-namespace callers can use the short Service name, and cross-namespace callers should include the destination namespace. For shared charts, incident notes, and platform examples, the fully qualified form removes guesswork.

```yaml
env:
  - name: ORDERS_API_BASE_URL
    value: http://devpolaris-orders-api.orders.svc.cluster.local
```

The second habit is testing from the real caller. A lookup from a laptop, CI runner, or random debug Pod may use a different namespace, resolver file, egress policy, and network path. The strongest evidence comes from the workload namespace and a Pod with the same labels and policies as the application.

The third habit is reducing noisy DNS behavior in busy services. Long-lived HTTP clients, connection pooling, and reasonable client DNS caching reduce repeated lookups. On clusters with high DNS query volume, platform teams may add **NodeLocal DNSCache**, which runs a caching DNS agent on each node and forwards cache misses to the cluster DNS Service.

The fourth habit is keeping DNS visible in release evidence. A small release note can include the intended name, the Service IP answer, EndpointSlice output, and one HTTP health check. That evidence gives the next engineer a clean starting point during a rollback or incident handoff.

```bash
caller namespace: web
caller workload: deploy/devpolaris-web
target Service: orders/devpolaris-orders-api
name used by app: devpolaris-orders-api.orders
DNS result: 10.96.42.18
endpoint result: 10.244.3.18:3000,10.244.4.22:3000
HTTP result: 200 from /healthz
```

The fifth habit is treating CoreDNS as shared platform infrastructure. Application teams can prove symptoms from their Pods, while platform teams own CoreDNS scaling, Corefile changes, NodeLocal DNSCache, upstream forwarding, and cluster-domain configuration.

## Putting It All Together
<!-- section-summary: The whole request path starts with the Service name, then moves through Pod resolver config, CoreDNS, Service records, EndpointSlices, policy, and the app. -->

Now the original environment variable carries a full story. It names the dependency without tying the app to any current Pod.

```yaml
env:
  - name: ORDERS_API_BASE_URL
    value: http://devpolaris-orders-api.orders
```

The web process asks its resolver for `devpolaris-orders-api.orders`. kubelet configured the Pod with a cluster DNS nameserver and search suffixes. The query reaches the `kube-dns` Service, Kubernetes sends it to a ready CoreDNS Pod, and CoreDNS returns the Service IP for `devpolaris-orders-api.orders.svc.cluster.local`.

After that, the HTTP path continues through the Service and its EndpointSlices. The Service selector finds ready orders API Pods, the network plugin and policies decide whether the packet can move, and the application process on port `3000` handles `/healthz`.

The useful production check keeps each proof in order. The commands move from name to Service to endpoints to HTTP response.

```bash
kubectl -n web exec deploy/devpolaris-web -- nslookup devpolaris-orders-api.orders
kubectl -n orders get svc devpolaris-orders-api -o wide
kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api
kubectl -n web exec deploy/devpolaris-web -- curl -sS -m 3 http://devpolaris-orders-api.orders/healthz
```

That sequence gives a plain incident story. The app used the intended name, the cluster resolved it to the intended Service, the Service had ready backends, and the application answered.

![Kubernetes DNS production habits summary separating DNS proof from traffic proof and showing headless Services returning Pod addresses](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/dns-production-summary.png)

*A successful lookup proves only the name. Production evidence stays stronger when DNS proof and traffic proof stay separate.*

## What's Next

DNS gives the web app a name for the orders API, and Services plus EndpointSlices give that name a backend path. The next production question is who should be allowed to use that path.

The next article covers **NetworkPolicies**. We will take the same `web` to `orders` flow and write label-based rules that allow the intended connection while blocking traffic from workloads that have no reason to talk to the orders API.

---

**References**

- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Official Kubernetes behavior for Service DNS names, namespace search paths, Pod resolver configuration, Service records, headless Service records, SRV records, and Pod DNS records.
- [Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/) - Official Kubernetes troubleshooting flow for checking CoreDNS Pods, the `kube-dns` Service, EndpointSlices, logs, and CoreDNS query handling.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Service concepts, including EndpointSlices and the relationship between Services and backend endpoints.
- [Service API reference](https://kubernetes.io/docs/reference/kubernetes-api/core/service-v1/) - Documents Service fields such as `publishNotReadyAddresses`, selectors, ports, and traffic-related settings.
- [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Documents egress isolation, selector behavior, and the DNS impact of default-deny egress policies.
- [Using NodeLocal DNSCache in Kubernetes Clusters](https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/) - Explains node-local DNS caching, cache-miss forwarding, and the performance motivation for high-query clusters.

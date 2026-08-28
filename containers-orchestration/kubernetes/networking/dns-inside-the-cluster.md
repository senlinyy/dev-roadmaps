---
title: "DNS Inside the Cluster"
description: "Kubernetes DNS is a dynamically generated address book over Kubernetes API objects."
overview: "The Kubernetes API is the source of truth. DNS projects that changing state into stable names that applications can use."
tags: ["dns", "coredns", "services", "namespaces"]
order: 5
id: article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster
---

## Table of Contents

1. [Why does Kubernetes need its own address book?](#why-does-kubernetes-need-its-own-address-book)
2. [What does a Service name actually identify?](#what-does-a-service-name-actually-identify)
3. [Why can the same short name mean different things?](#why-can-the-same-short-name-mean-different-things)
4. [What happens during one DNS lookup?](#what-happens-during-one-dns-lookup)
5. [Why would DNS return Pod addresses instead?](#why-would-dns-return-pod-addresses-instead)
6. [How can you tell whether DNS is really the problem?](#how-can-you-tell-whether-dns-is-really-the-problem)
7. [Check Your Answers](#check-your-answers)
8. [References](#references)

Kubernetes DNS is a dynamically generated address book built from Kubernetes API objects. The API server holds the cluster's current Services, Pods, namespaces, and EndpointSlices. The DNS system turns that changing state into names that applications can use.

That is why a frontend can call `http://payments:8080` instead of storing `http://10.96.42.17:8080`. The name expresses which application the frontend needs, while Kubernetes maintains the changing network locations behind it.

Start with a system outside Kubernetes. If `payments` always ran on one machine at `10.20.30.40`, ordinary DNS could map the name `payments` to that permanent address. The application identity and its network location would remain together.

Kubernetes deliberately separates those two ideas. Imagine that three Pods currently run the `payments` application:

- Pod A has IP address `10.244.1.18`.
- Pod B has IP address `10.244.2.31`.
- Pod C has IP address `10.244.3.7`.

Keep these questions in view as you work through the lesson:

1. **Why does Kubernetes need its own address book?**
2. **What does a Service name actually identify?**
3. **Why can the same short name mean different things?**
4. **What happens during one DNS lookup?**
5. **Why would DNS return Pod addresses instead?**
6. **How can you tell whether DNS is really the problem?**

## Why does Kubernetes need its own address book?
<!-- section-summary: Kubernetes DNS gives a changing set of Pods a stable application name derived from Kubernetes API state. -->

Pod A can disappear because its process crashes, its node is drained, or a rollout replaces it. Kubernetes may create Pod D at `10.244.4.22`. The application remains `payments` even though one of its locations changed. Its identity therefore has to remain separate from any one Pod IP.

A Service gives that changing workload a stable identity. A Service named `payments` selects the matching Pods, while EndpointSlices record the network endpoints that currently belong behind it. When Pods appear, disappear, or become unready, Kubernetes updates those EndpointSlices and callers continue using the same Service name.

DNS makes the Service identity usable as a network name. Instead of teaching every application about Services and EndpointSlices, Kubernetes lets the caller use a familiar name such as `payments.default.svc.cluster.local`. The important chain is:

1. The caller asks for a DNS name.
2. That name identifies a Kubernetes Service.
3. The Service is associated with EndpointSlices.
4. The EndpointSlices contain the current usable Pod addresses.

![A stable payments DNS name resolves to a Service front door while EndpointSlices track changing Pod addresses behind it](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/service-dns-vs-dataplane.png)

*The application keeps one stable name while Kubernetes updates the Pods and endpoint addresses behind it.*

This is more dynamic than ordinary public DNS. Cluster DNS needs to understand Kubernetes namespaces, Services, Pods, and EndpointSlices, and it must react when those objects change. The Kubernetes API remains the source of truth; DNS is a convenient view of that truth for software that needs to connect by name.

That model also explains where a cluster DNS record comes from. Nobody needs to maintain a separate zone file for every Service. When a Service is created, changed, or removed through the Kubernetes API, the cluster DNS system can synthesize the corresponding answer from the new state.

Consider a replacement cycle. Three `payments` Pods may be replaced by three others with new Pod IPs. EndpointSlices change to reflect those locations, while the Service identity and its normal DNS name remain stable. Callers keep asking for `payments`; they do not need a configuration update for every Pod replacement.

```text
stable identity: payments.shop.svc.cluster.local
stable front door: Service ClusterIP
changing locations: EndpointSlice Pod addresses
```

This is the distinction between **identity** and **location**. DNS publishes an address for the durable Service identity. Kubernetes networking continuously relates that front door to the current locations. Without the separation, every caller would need to discover and track short-lived Pod IPs itself.

## What does a Service name actually identify?
<!-- section-summary: A normal Service name resolves to the Service ClusterIP; the Service data plane later chooses a backend Pod. -->

Consider this Service in the `shop` namespace:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments
  namespace: shop
spec:
  selector:
    app: payments
  ports:
    - port: 8080
```

Suppose Kubernetes assigns the Service a ClusterIP of `10.96.42.17`, and its EndpointSlices currently contain three Pod addresses: `10.244.1.18`, `10.244.2.31`, and `10.244.3.7`.

For a normal Service, the Service's A or AAAA record resolves to its ClusterIP for the relevant IP family. In this IPv4 example, a lookup for `payments.shop.svc.cluster.local` returns `10.96.42.17` rather than the three Pod IPs. That distinction separates name resolution from traffic routing.

DNS answers one question: **what stable address belongs to the `payments` Service?** The Service data plane answers a later question: **which ready backend should receive this connection?** A cluster may implement that second decision with kube-proxy or another networking data plane, including an eBPF-based implementation, but it happens after DNS has returned an address.

The complete Service name also describes where this identity lives:

| Name piece | Meaning |
|---|---|
| `payments` | The Service name |
| `shop` | The namespace that owns the Service |
| `svc` | The Kubernetes DNS area used for Services |
| `cluster.local` | The cluster DNS domain |

The general form is `<Service>.<Namespace>.svc.<ClusterDomain>`. `cluster.local` is common, while the cluster configuration can choose a different suffix.

This naming hierarchy is another projection of Kubernetes objects. The name includes the Service and namespace because those are part of the object's identity in the API. For a normal Service, CoreDNS uses that Service state to produce a record whose value is the ClusterIP. EndpointSlices are still important, but they belong to the next network step, when the Service forwards a connection to a backend.

Suppose a lookup returns `10.96.42.17`, but an HTTP request to `payments:8080` fails. The correct DNS answer proves that the name reached the stable Service address. The remaining investigation should move to the Service ports, EndpointSlices, NetworkPolicy, network data plane, or application process, because each of those later layers needs its own evidence.

This boundary is worth remembering in one sentence: DNS maps a normal Service name to its ClusterIP; Service networking maps that ClusterIP to one backend Pod.

The boundary also changes the meaning of a healthy test. `nslookup payments` returning the ClusterIP proves the name-to-Service mapping. It does not exercise TCP port `8080`, the Service's `targetPort`, the endpoint readiness set, NetworkPolicy, or the payments process. A subsequent connection test begins those later checks. Keeping the two requests separate prevents “DNS works” from being mistaken for “the application works.”

## Why can the same short name mean different things?
<!-- section-summary: A Pod resolver adds namespace-specific search domains, so the same short name can expand to different complete Service names. -->

Kubernetes allows different namespaces to contain Services with the same name. A `development` namespace can contain a Service named `database`, and a `production` namespace can contain another Service named `database`. Their full identities are different:

- `database.development.svc.cluster.local`
- `database.production.svc.cluster.local`

An application inside the `development` namespace may still call `database` without writing the full name. The caller's operating-system resolver supplies the namespace context before it sends the query to the DNS server.

Kubelet normally writes resolver settings into each Pod. In a Pod from the `development` namespace, `/etc/resolv.conf` may look like this:

```text
nameserver 10.96.0.10
search development.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

The application asks to resolve `database`. Because the name is short, the resolver tries the search domains and can form `database.development.svc.cluster.local`. A Pod in `production` receives a different first search suffix, so the same short name can become `database.production.svc.cluster.local`.

The caller's own resolver supplies the namespace context by expanding the short name with the search list that kubelet placed in that Pod. CoreDNS receives a complete query such as `database.development.svc.cluster.local` or `database.production.svc.cluster.local` and answers that exact name.

This means short names are convenient and context-dependent at the same time. They make same-namespace calls concise, but moving identical application configuration into another namespace changes which Service that short name denotes. A namespace-qualified name such as `database.production` states the cross-namespace dependency explicitly and lets the resolver form the intended complete Service name.

![Two Pods use their own namespace search suffixes to expand the same short database name into different complete Service names](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/namespace-search-expansion.png)

*The short name stays the same; the search domain supplied to each Pod provides the namespace context.*

This behavior gives same-namespace calls a concise form. It also explains a common cross-namespace mistake. If a Pod in `shop` needs a Service named `payments` in `finance`, the short name `payments` first refers to the `shop` namespace. The caller should use `payments.finance` or the full name `payments.finance.svc.cluster.local` to identify the intended Service.

The `ndots:5` setting affects how the resolver treats names that already contain dots. A name with fewer than five dots may be tried with cluster search suffixes before it is tried as an absolute name. For example, `api.example.com` can lead to attempts resembling:

```text
api.example.com.shop.svc.cluster.local
api.example.com.svc.cluster.local
api.example.com.cluster.local
api.example.com
```

Those extra attempts can add DNS queries, latency, and CoreDNS load. A trailing dot, as in `api.example.com.`, marks a name as complete so the resolver skips the search domains.

The search list, `ndots`, runtime behavior, and resolver implementation can affect the exact query order. The reliable first-principles rule is simpler: a short Service name only becomes complete after the Pod resolver applies its configured search context.

## What happens during one DNS lookup?
<!-- section-summary: A lookup moves from the application resolver to the cluster DNS Service and CoreDNS, then returns a Service address before any application connection begins. -->

Follow one lookup from a frontend Pod in the `shop` namespace. The Pod wants the `payments` Service, whose ClusterIP is `10.96.42.17`.

The application begins with a normal operating-system call such as `getaddrinfo("payments", ...)`. Its language runtime or system library passes the name to the Pod's resolver, which reads `/etc/resolv.conf` to find both the DNS server and the search domains.

With the default `ClusterFirst` DNS policy, kubelet normally configures the Pod to use the cluster DNS Service. The resolver sees that `payments` is a short name, applies `shop.svc.cluster.local`, and asks for `payments.shop.svc.cluster.local` at the nameserver address, such as `10.96.0.10`.

That nameserver address usually belongs to a Kubernetes Service for cluster DNS. Behind the Service are CoreDNS Pods listening on UDP and TCP port 53. The DNS query therefore follows an ordinary Service path to a ready CoreDNS instance.

CoreDNS can answer Kubernetes names because its Kubernetes integration watches API state. Conceptually, it already knows that a Service named `payments` exists in `shop` and has ClusterIP `10.96.42.17`. It synthesizes an A record answer from that state and sends the address back through the resolver to the application.

![The complete lookup path from an application short name through the Pod resolver, cluster DNS Service, CoreDNS, Kubernetes API state, and back to the caller](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/cluster-dns-lookup-steps.png)

*CoreDNS returns an address derived from Kubernetes state; the application connection begins only after that answer comes back.*

At this point, DNS has finished its job. The application opens a connection to `10.96.42.17:8080`. Service networking then selects one ready endpoint, perhaps `10.244.2.31:8080`, and forwards the connection. DNS translated `payments` into the stable Service address; the data plane selected Pod B.

The complete lookup crosses two Services in a typical cluster. First, the caller sends UDP or TCP port 53 traffic to the cluster DNS Service, which selects a CoreDNS Pod. CoreDNS returns the payments ClusterIP. Then the caller opens an application connection to the payments Service, which selects a payments endpoint. Both use Kubernetes Service machinery, but only the first connection is the DNS protocol.

That detail helps when DNS queries time out. CoreDNS may be healthy while the caller cannot reach the DNS Service because of egress policy or Pod networking. Conversely, the DNS Service can be reachable while CoreDNS lacks API permission to observe Services and EndpointSlices. The same symptom is divided by checking reachability, CoreDNS logs, and Kubernetes-resource access in order.

The distinction creates two connected but separate paths:

| Stage | Input | Output |
|---|---|---|
| DNS resolution | `payments.shop.svc.cluster.local` | Service ClusterIP `10.96.42.17` |
| Service networking | Connection to `10.96.42.17:8080` | One ready backend such as `10.244.2.31:8080` |

CoreDNS also handles names outside Kubernetes by forwarding them according to its configuration. That creates another useful troubleshooting boundary: if cluster names work but internet names fail, investigate upstream forwarding; if internet names work but valid `*.svc.cluster.local` names fail, investigate the Kubernetes integration and API access.

Pod DNS policy can change the path as well. The default `ClusterFirst` behavior sends cluster names to cluster DNS. Pods using `hostNetwork` commonly need `ClusterFirstWithHostNet` if they should retain cluster DNS behavior. Explicit `dnsConfig` settings can also change nameservers, searches, or options. These settings matter because the application can only use the lookup path installed inside its own Pod.

## Why would DNS return Pod addresses instead?
<!-- section-summary: A headless Service removes the virtual ClusterIP so DNS can expose backend addresses for client-side discovery and stable members. -->

A normal Service deliberately hides its individual backends. Callers receive one ClusterIP, and Kubernetes chooses a ready Pod for each connection. That is a good fit when the replicas are interchangeable and the caller only cares about reaching the application.

Some systems need to discover the members themselves. A database cluster may contain `postgres-0`, `postgres-1`, and `postgres-2`, with one leader and two replicas. Peers may need to connect to a particular member, form a quorum, or perform their own load balancing. A single virtual Service address would hide the information the client needs.

A headless Service changes the DNS contract by setting `clusterIP: None`:

```yaml
spec:
  clusterIP: None
```

Setting `clusterIP: None` replaces the virtual front door with direct endpoint records. Its A or AAAA records can therefore return backing endpoint addresses such as `10.244.1.10`, `10.244.2.11`, and `10.244.3.12` instead of a Service ClusterIP. The client now sees the set of members and takes on more responsibility for selecting or contacting them.

![A normal Service returns one ClusterIP and uses the data plane to choose a Pod, while a headless Service returns multiple Pod addresses directly](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/normal-vs-headless-service-dns.png)

*Normal Service DNS hides the replicas behind one front door; headless Service DNS exposes the current members.*

This is especially useful with StatefulSets because their Pods have stable ordinal names. When a StatefulSet uses the headless Service, individual members can receive names such as:

```text
postgres-0.postgres.shop.svc.cluster.local
postgres-1.postgres.shop.svc.cluster.local
postgres-2.postgres.shop.svc.cluster.local
```

The Service name can be used to discover the set, while a member-specific name identifies one Pod. This is service discovery rather than ordinary load balancing: the caller is learning which members exist and can choose a particular one.

That additional visibility transfers responsibility to the client. With a normal Service, the Kubernetes data plane selects a ready endpoint behind one virtual address. With a headless Service, the client receives endpoint addresses and may need to choose a member, retry another address, or respect member roles such as leader and replica. Headless DNS exposes the set; it does not turn every member into an interchangeable backend.

The records remain dynamic. If `postgres-1` is recreated with a new address, Kubernetes API and EndpointSlice state changes, and the DNS projection can eventually reflect that new location while the member's stable name remains the discovery identity. Stable naming does not mean a permanently fixed Pod IP.

The way records are derived also changes. For a normal Service, the Service object produces a DNS record whose value is the ClusterIP. For a headless Service, CoreDNS uses the Service together with its EndpointSlices to produce records for endpoint addresses. Both answers still come from Kubernetes API state; they expose different levels of that state because the two Service types promise different behavior.

## How can you tell whether DNS is really the problem?
<!-- section-summary: Troubleshooting tests name resolution first, then moves through the Service, EndpointSlices, networking, listener, and application protocol. -->

An application-reported connection failure can originate from several subsystems. A connection crosses name resolution, Service addressing, Service routing, endpoint selection, Pod networking, the application listener, and finally the application protocol. A useful investigation tests those layers in order and moves beyond DNS once the name has resolved correctly.

![A DNS troubleshooting path that starts in the affected Pod and narrows the failure through resolver settings, Service state, EndpointSlices, CoreDNS, and the application connection](/content-assets/articles/article-containers-orchestration-kubernetes-networking-dns-inside-the-cluster/dns-debugging-order.png)

*Each check proves one layer, so the next command follows the first failed result instead of restarting the investigation at DNS.*

**Start from the affected Pod.** Resolver settings, namespace context, DNS policy, and NetworkPolicy can differ between workloads. Test the same name the application uses:

```bash
kubectl exec -it <pod> -- nslookup payments
```

or:

```bash
kubectl exec -it <pod> -- getent hosts payments
```

If the output includes `10.96.42.17 payments.shop.svc.cluster.local`, basic name resolution is working. Compare the short name with the full name:

```bash
nslookup payments
nslookup payments.shop.svc.cluster.local
```

If the full name works while the short name fails, inspect namespace expectations, `dnsPolicy`, and the search list in `/etc/resolv.conf`:

```bash
kubectl exec -it <pod> -- cat /etc/resolv.conf
```

The file should contain the expected cluster DNS nameserver and search domains. A Pod using `hostNetwork`, a custom `dnsConfig`, or an unexpected policy can receive a different resolver path.

**Confirm that the requested Kubernetes object exists.** An `NXDOMAIN` answer often means the Service name or namespace is wrong:

```bash
kubectl get svc -n shop payments
```

If the caller is in `shop` but the Service is in `finance`, `payments` and `payments.finance` identify different names. Use the namespace-qualified or full name when crossing that boundary.

**Compare the DNS answer with the Service.** For a normal Service, these two commands should lead to the same ClusterIP:

```bash
kubectl get svc payments -n shop -o wide
nslookup payments.shop.svc.cluster.local
```

If both show `10.96.42.17`, DNS has returned the address stored on the Service. Test that address directly:

```bash
curl http://10.96.42.17:8080
```

If both the name-based request and the direct ClusterIP request fail, the evidence points beyond DNS. Investigate Service ports and `targetPort`, the network data plane, NetworkPolicy, or the application listener.

If the direct ClusterIP succeeds while the name-based request fails, the two tests have isolated the difference to name resolution. Return to the affected Pod's resolver configuration, search domains, DNS policy, cluster DNS reachability, and the exact query name. The application and Service path have already produced a successful response by address, so changing endpoint selectors would not explain the name-only failure.

**Inspect the current backends.** EndpointSlices show which addresses the Service can use:

```bash
kubectl get endpointslices -n shop \
  -l kubernetes.io/service-name=payments

kubectl describe endpointslice <name> -n shop
```

For the running example, healthy EndpointSlices might include `10.244.1.18`, `10.244.2.31`, and `10.244.3.7`. If DNS returns the correct ClusterIP while the EndpointSlice is empty, likely causes include a wrong Service selector, mismatched Pod labels, unready Pods, or incorrect ports. The evidence is now `DNS ✓`, `Service ✓`, `endpoints ✗`.

**Inspect CoreDNS when cluster lookups themselves fail or time out.** Check the DNS Pods, logs, Service, and configuration:

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns
kubectl get svc -n kube-system
kubectl get configmap coredns -n kube-system -o yaml
```

The `k8s-app=kube-dns` label is commonly used for CoreDNS deployments despite its historical name. CoreDNS also needs permission to watch the Kubernetes resources used to answer names, including Services, namespaces, Pods, and EndpointSlices. Logs that show API watch or permission failures therefore belong to the DNS investigation.

The following symptoms summarize how these checks divide the system:

| Symptom | Likely area |
|---|---|
| `payments` fails, but the full name works | Search domain, namespace, or resolver configuration |
| The full name returns `NXDOMAIN` | Missing Service, wrong name or namespace, or CoreDNS Kubernetes integration |
| DNS requests time out | DNS Service reachability, NetworkPolicy, or CoreDNS Pods |
| DNS returns the correct ClusterIP, but the connection fails | Service, EndpointSlices, networking, port mapping, or application |
| The Service works by IP while its name fails | DNS or resolver path |
| A headless Service returns several Pod IPs | Expected headless discovery behavior |
| Cluster names work, but internet names fail | CoreDNS upstream forwarding |
| Internet names work, but `*.svc.cluster.local` names fail | CoreDNS Kubernetes integration or API access |
| Short-name results differ across namespaces | Namespace-specific search context |

Finally, keep DNS's contract narrow. If `nslookup payments` returns `10.96.42.17` and `curl payments:8080` reports `Connection refused`, DNS succeeded. The listening process, `targetPort`, TLS setup, policy decision, and HTTP response all belong to later layers and require separate checks.

## Check Your Answers

:::expand[Why does Kubernetes need its own address book?]{kind="recap"}
Pod addresses change as workloads restart, move, and scale, while applications still need a stable identity for each dependency. Kubernetes DNS projects Service and endpoint state from the API into names that survive those location changes.
:::

:::expand[What does a Service name actually identify?]{kind="recap"}
For a normal Service, its DNS name resolves to the Service ClusterIP. Service networking then uses the Service's endpoints to choose a ready backend for the connection.
:::

:::expand[Why can the same short name mean different things?]{kind="recap"}
Each Pod receives namespace-specific DNS search domains. Its resolver combines a short name with that context, so `database` in `development` can resolve to a different Service from `database` in `production`.
:::

:::expand[What happens during one DNS lookup?]{kind="recap"}
The application asks its resolver, the resolver applies search rules and queries the cluster DNS Service, and CoreDNS answers from Kubernetes API state. After the address returns, the application starts a separate network connection through the Service data plane.
:::

:::expand[Why would DNS return Pod addresses instead?]{kind="recap"}
A headless Service uses `clusterIP: None`, so DNS can return its endpoint addresses directly. This supports clients that need member discovery or stable StatefulSet Pod identities instead of one load-balanced front door.
:::

:::expand[How can you tell whether DNS is really the problem?]{kind="recap"}
Test resolution from the affected Pod, compare the answer with the Service, and then inspect EndpointSlices and the direct connection. Once DNS returns the correct address, move the investigation to the next failing network or application layer.
:::

## References

- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Official Kubernetes behavior for Service DNS names, namespace search paths, Pod resolver configuration, and headless Service records.
- [Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/) - Official Kubernetes checks for Pod resolver settings, CoreDNS Pods, the cluster DNS Service, logs, permissions, and EndpointSlices.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Service and EndpointSlice concepts behind stable addresses and backend selection.

---
title: "ClusterIP, NodePort, and LoadBalancer"
description: "Understand how Kubernetes Service types change who can reach an application: private cluster callers, node-level callers, or infrastructure-managed external callers."
overview: "A Kubernetes Service gives stable access to changing Pods. A checkout platform shows the same orders API staying private with ClusterIP, getting node-level access with NodePort, and reaching external infrastructure through LoadBalancer."
tags: ["clusterip", "nodeport", "loadbalancer", "services"]
order: 2
id: article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer
---
## Table of Contents

1. [Service Types Choose The Audience](#service-types-choose-the-audience)
2. [The Exposure Knobs Each Type Reuses](#the-exposure-knobs-each-type-reuses)
3. [ClusterIP for Private Calls](#clusterip-for-private-calls)
4. [NodePort for Node-Level Access](#nodeport-for-node-level-access)
5. [LoadBalancer for Infrastructure Entry](#loadbalancer-for-infrastructure-entry)
6. [How the Types Stack Together](#how-the-types-stack-together)
7. [Choosing the Type](#choosing-the-type)
8. [Debugging the Path](#debugging-the-path)
9. [Changing Exposure Safely](#changing-exposure-safely)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)
12. [References](#references)

## Service Types Choose The Audience
<!-- section-summary: ClusterIP, NodePort, and LoadBalancer answer the same question at three different scopes: cluster callers, node callers, and infrastructure-managed callers. -->

A Service gives Kubernetes workloads a stable way to reach changing Pods. The **Service type** decides where that stable address is published: only inside the cluster, on each node, or through external infrastructure.

The `orders-api` in a checkout platform gives us one concrete backend. `checkout-web` calls `orders-api`, and `orders-api` calls `inventory-api`. The Service already answers which Pods sit behind the stable name. The Service type answers a different question: which callers should be able to reach it?

The comparison uses `ClusterIP`, `NodePort`, and `LoadBalancer` through the same Service contract. Each type has a plain job, a concrete use case, a manifest shape, and a debugging path that tells you where traffic entered and where it stopped.

DevPolaris runs a checkout platform in Kubernetes. A Pod called `checkout-web` receives browser traffic, then it calls `orders-api` to create an order, and `orders-api` calls `inventory-api` to reserve stock. Pods come and go during rollouts, failures, autoscaling, and node maintenance, so the web app should never hardcode a Pod IP.

A **Kubernetes Service** gives a stable network name and port for a changing group of Pods. The Service selects Pods by labels, Kubernetes tracks the ready backend Pods through EndpointSlices, and clients call the Service instead of chasing individual Pod IPs.

The next practical question is: **who should be able to reach that Service?** `ClusterIP`, `NodePort`, and `LoadBalancer` are Service types. The type controls where Kubernetes publishes the Service contract.

| Service type | Main audience | What Kubernetes publishes |
|---|---|---|
| **ClusterIP** | Pods and other in-cluster clients | A cluster-internal virtual IP and Service DNS name |
| **NodePort** | Clients that can reach Kubernetes node IPs | A static port on every node, plus the ClusterIP behavior |
| **LoadBalancer** | Clients that enter through cloud or platform infrastructure | An external load balancer address, plus Service behavior behind it |

![ClusterIP, NodePort, and LoadBalancer audience map showing inside-cluster callers, node-network callers, external callers, and shared ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer/service-type-audience-map.png)

*The Service type changes the audience. The backend contract still depends on the same selector, target port, EndpointSlices, and ready Pods.*

The narrow private choice is `ClusterIP` when `checkout-web` calls `orders-api` inside the cluster. A lab or bare-metal platform can use `NodePort` when clients deliberately enter through node IPs. A cloud or platform load balancer can use `LoadBalancer` when infrastructure needs to publish an address.

The examples below keep returning to the same `orders-api` Service. That makes the difference clear: the application can stay the same, while the Service type changes the audience.

## The Exposure Knobs Each Type Reuses
<!-- section-summary: Service types reuse the same backend selector and port contract, then add different exposure fields for different audiences. -->

The same backend fields appear in all three Service types. The key decision is where the Service publishes access: only inside the cluster, on node IPs, or through infrastructure that creates an external address.

For the checkout path, the backend identity stays steady. `checkout-web` calls `orders-api`, and every Service type below still selects the same orders Pods. The type only decides which callers can enter that path.

These fields are the exposure review vocabulary:

| Field | Simple meaning | Example in this scenario |
|---|---|---|
| **port** | The port clients use on the Service | `80` |
| **targetPort** | The port Kubernetes sends traffic to on the selected Pods | `http` or `8080` |
| **nodePort** | The high port opened on nodes for a NodePort Service | `31080` |
| **clusterIP** | The virtual IP inside the cluster for the Service | `10.96.42.18` |
| **status.loadBalancer** | The address a load balancer implementation reports back | `203.0.113.42` or a cloud hostname |

The orders Pods still need stable labels so every Service type can find the same backends:

```yaml
template:
  metadata:
    labels:
      app.kubernetes.io/name: orders-api
```

The container also names its HTTP port. A named port lets the Service point at `http` instead of hardcoding `8080` everywhere:

```yaml
ports:
  - name: http
    containerPort: 8080
```

The Deployment still has replicas, a selector, an image, probes, and rollout settings in a real manifest. In this simplified backend slice, the label and the named port are the reused backend pieces. The Service can expose port `80` to clients, while the Pods listen on container port `8080`. Later, if the application moves its HTTP listener to `8081`, the team can update the Pod port named `http` and keep the Service port stable for clients.

That stable backend contract is the common base. The next sections change only the audience around it.

## ClusterIP for Private Calls
<!-- section-summary: ClusterIP is the default Service type and the usual choice for backend application calls inside the cluster. -->

**ClusterIP** exposes a Service on a cluster-internal virtual IP address. Kubernetes also gives the Service a DNS name, so Pods can call the Service by name instead of calling the cluster IP directly. This is the default Service type, so a Service without `spec.type` uses ClusterIP.

For `orders-api`, ClusterIP is the normal starting point. The caller, `checkout-web`, already runs inside Kubernetes. A private cluster address gives it everything it needs, while the orders backend stays away from node-level and cloud load balancer exposure.

The smallest useful Service shell names the Service and keeps the type private:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  type: ClusterIP
```

Then add the selector that finds the orders Pods:

```yaml
  selector:
    app.kubernetes.io/name: orders-api
```

Then add the caller-facing port and the backend port:

```yaml
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
```

Those three pieces make the complete ClusterIP Service: stable name, private audience, selected Pods, and port mapping. The caller sees `orders-api.orders:80`; the selected Pods receive traffic on their named `http` port.

The fields carry the Service contract:

- `type: ClusterIP` publishes the Service only inside the cluster.
- `selector.app.kubernetes.io/name: orders-api` chooses the backend Pods.
- `ports[].name: http` gives the Service port a stable name.
- `ports[].port: 80` is the port callers use on the Service.
- `ports[].targetPort: http` forwards to the named container port on each selected Pod.

Inside the `orders` namespace, a client can use `http://orders-api`. From another namespace, a client should qualify the name as `orders-api.orders` or use the full name `orders-api.orders.svc.cluster.local`. That namespace part matters in real clusters because many teams reuse simple Service names such as `api`, `web`, or `worker` in different namespaces.

The live Service should show a cluster IP and no external address. This proves the API server accepted the internal Service shape.

```bash
kubectl -n orders get svc orders-api -o wide
```

```bash
NAME         TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
orders-api   ClusterIP   10.96.42.18   <none>        80/TCP    4m    app.kubernetes.io/name=orders-api
```

The `<none>` value under `EXTERNAL-IP` is healthy for this design. It says Kubernetes created an internal Service contract with only a cluster-facing address. A laptop outside the cluster will usually fail if it tries to curl `10.96.42.18`, because that address belongs to the cluster network.

A useful smoke test comes from a Pod, because the intended caller also lives inside the cluster. The command below creates a temporary BusyBox Pod in the `checkout` namespace and removes it after the check.

```bash
kubectl -n checkout run orders-smoke --rm -it --restart=Never --image=busybox:1.36 -- \
  wget -qO- http://orders-api.orders/healthz
```

Expected output can stay tiny:

```bash
{"status":"ok","service":"orders-api"}
```

The important detail is the caller location. A ClusterIP test from inside the cluster proves the path that `checkout-web` actually uses. A failed curl from a developer laptop proves very little about this Service, because the laptop sits outside the audience that ClusterIP serves.

Most backend Services in production stay here. Public HTTP traffic often reaches an Ingress controller or Gateway implementation first, and that edge component forwards to ClusterIP Services behind the scenes. The platform keeps one public entry point for hostnames, TLS, routing, authentication hooks, rate limits, and web-facing policy, while backend Services stay private.

## NodePort for Node-Level Access
<!-- section-summary: NodePort adds a static high port on every node, which can help labs and custom load balancer designs while widening the network audience. -->

**NodePort** exposes a Service on every node IP at a static port. Kubernetes still creates the internal ClusterIP behavior, then it adds a node-level entry path. By default, Kubernetes allocates the node port from the configured Service node port range, commonly `30000-32767`.

Imagine the platform team runs a small bare-metal cluster in a training lab. There is no cloud load balancer integration. A network appliance can reach the Kubernetes worker nodes and forward traffic to a fixed node port. In that world, NodePort gives the appliance something stable to target.

The Service type is the main new field. The selector and normal Service port stay familiar, and `nodePort` adds the node-facing port:

```yaml
type: NodePort
ports:
  - name: http
    port: 80
    targetPort: http
    nodePort: 31080
```

In the full Service, that snippet sits under `spec` beside the same selector used by the ClusterIP example. The Service now has two useful addresses. Pods inside the cluster can still call `http://orders-api-nodeport.orders:80`. Clients that can route to a worker node can call `http://<node-ip>:31080`.

The new fields mean:

- `type: NodePort` keeps the normal Service behavior and adds node-level reachability.
- `port: 80` remains the Service port for cluster callers.
- `targetPort: http` still points to the Pod's named application port.
- `nodePort: 31080` opens that fixed high port on the node network path.


```bash
kubectl -n orders get svc orders-api-nodeport
```

```bash
NAME                  TYPE       CLUSTER-IP    EXTERNAL-IP   PORT(S)        AGE
orders-api-nodeport   NodePort   10.96.81.22   <none>        80:31080/TCP   2m
```

That `80:31080/TCP` value packs two facts into one column. The Service port is `80`, and the node port is `31080`. A client inside Kubernetes usually uses port `80` on the Service name. A client outside Kubernetes, with network access to a node, uses port `31080` on a node IP.

NodePort has real uses. It works well for local clusters, training environments, and bare-metal patterns where another load balancer already owns the public address. It can also act as a simple diagnostic tool because the path is easy to see: client, node IP, node port, Service, ready Pods.

The production risk is reachability. A node port opens on node interfaces selected by kube-proxy configuration. If node IPs sit on a corporate network, a VPN, a peered VPC, or a public subnet, the Service may reach many more clients than the application team had in mind. Security groups, firewall rules, routing tables, and the kube-proxy node port address settings belong in the review.

For the checkout platform, a direct NodePort usually adds exposure without helping the normal workflow. `checkout-web` already runs in the cluster, so ClusterIP serves that call. If an engineer needs a temporary local debugging path, `kubectl port-forward` keeps the Service private and creates a short-lived tunnel through the Kubernetes API:

```bash
kubectl -n orders port-forward svc/orders-api 8080:80
curl -i http://127.0.0.1:8080/healthz
```

That port-forward path suits a person debugging a specific issue. NodePort suits a platform design where node-level access is intentional and reviewed.

## LoadBalancer for Infrastructure Entry
<!-- section-summary: LoadBalancer asks a cloud provider or load balancer controller to create an external address and report it on the Service status. -->

**LoadBalancer** exposes a Service through infrastructure outside the Kubernetes API server. In a managed cloud cluster, the cloud controller usually creates a cloud load balancer. In a bare-metal cluster, a controller such as MetalLB or another platform integration can provide a similar result.

Kubernetes hands the external load balancer work to the provider or load balancer controller. The Service object records the request, and the provider or controller fulfills it. That controller creates or configures infrastructure, then writes the resulting IP address or hostname into the Service status.

A direct LoadBalancer for `orders-api` could look like this. It helps explain the type before the production design narrows the public entry point.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api-public
  namespace: orders
spec:
  type: LoadBalancer
  selector:
    app.kubernetes.io/name: orders-api
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
```

The important Service fields are:

- `type: LoadBalancer` asks the configured provider or controller to create an external entry point.
- `selector.app.kubernetes.io/name: orders-api` keeps the backend Pods the same as the private Service examples.
- `ports[].port: 80` is the load-balancer-facing Service port.
- `ports[].targetPort: http` forwards to the Pods through the named container port.

Right after the apply, the external address may stay pending while the provider creates the infrastructure. That short waiting period is normal for cloud and platform controllers.

```bash
kubectl -n orders get svc orders-api-public
```

```bash
NAME                TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
orders-api-public   LoadBalancer   10.96.10.44    <pending>     80:31872/TCP   18s
```

After the controller finishes, the Service status should show an address. Some providers return an IP address, while others return a hostname.

```bash
NAME                TYPE           CLUSTER-IP     EXTERNAL-IP                             PORT(S)        AGE
orders-api-public   LoadBalancer   10.96.10.44    a1b2c3d4.us-east-1.elb.amazonaws.com   80:31872/TCP   3m
```

The `PORT(S)` column often still shows a node port because many LoadBalancer implementations start by creating NodePort behavior, then point the external load balancer at that node port. Some implementations can route directly to Pods and can use `spec.allocateLoadBalancerNodePorts: false`, depending on the provider. A LoadBalancer review should always name the cluster's implementation so reviewers know whether node ports, direct Pod routing, or provider-specific health checks are involved.

LoadBalancer fits cases where the Service itself represents a network entry point. Common examples include an Ingress controller Service, a Gateway controller Service, a private TCP endpoint for systems outside the cluster, or a public layer 4 service where TCP or UDP routing belongs directly at the Service.

For `orders-api`, direct public LoadBalancer exposure would usually skip too much of the platform's edge design. A more common production path looks like this:

![LoadBalancer edge pattern showing public traffic entering a Gateway or Ingress and routing to private ClusterIP backend Services](/content-assets/articles/article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer/loadbalancer-edge-pattern.png)

*A common production shape publishes the platform edge with LoadBalancer while application backends stay private behind ClusterIP Services.*

In that design, the LoadBalancer publishes the platform edge, and the application backends remain ClusterIP. The Gateway or Ingress layer owns hostnames, TLS certificates, HTTP paths, request headers, web timeouts, and route attachment rules. The orders backend can focus on being an internal API.

LoadBalancer also brings cloud and platform details into the Service review. The team should know whether the load balancer is public or private, which subnets or networks it uses, which firewall rules allow clients, how health checks work, how DNS points to the address, and where TLS terminates. On many providers, annotations or `loadBalancerClass` choose a particular load balancer implementation or scheme, so a small Service change can create real infrastructure.

## How the Types Stack Together
<!-- section-summary: The Service types usually add layers: ClusterIP gives internal reachability, NodePort adds node reachability, and LoadBalancer adds infrastructure reachability. -->

The three types form layers around the same Service contract. ClusterIP gives the stable internal Service address. NodePort keeps that and adds a static port on nodes. LoadBalancer usually keeps those pieces and asks outside infrastructure to forward traffic into the Service path.

This is why the same selector and target port keep showing up in every example. The exposure layer can change, but the backend still needs ready Pods behind the Service. For `orders-api`, changing the type answers who may enter the path; it never replaces the need for correct labels, EndpointSlices, readiness, and a working application port.

The stack works in this order:

| Service type | Caller path | Shared dependency |
|---|---|---|
| ClusterIP | Pod client -> Service DNS -> ClusterIP | Ready Pods selected by the Service |
| NodePort | Node-network client -> node IP and static port -> Service routing | Ready Pods selected by the Service |
| LoadBalancer | External client -> load balancer address -> provider path | Ready Pods selected by the Service |

This layered view helps during design reviews. A request to "make it LoadBalancer" usually means the team wants an address outside the cluster. That request still depends on the Service selector, the target port, Pod readiness, NetworkPolicy, node health, provider health checks, and firewall rules. The external address adds front-door reachability, while selector, readiness, and target port still decide whether any request reaches a healthy Pod.

The same view also helps with naming. A backend Service can stay named `orders-api` with ClusterIP, while the edge object has a separate name such as `public-gateway` or `checkout-ingress-controller`. That separation keeps internal callers from depending on an external exposure object. It also gives the team a cleaner rollback path because removing the public edge leaves internal names and calls untouched.

There are a few advanced fields worth knowing about, even for a beginner review. `externalTrafficPolicy: Local` tells Kubernetes to preserve client source IP for external traffic in supported paths, and it also changes how nodes without local ready endpoints participate in load balancer health checks. `loadBalancerClass` tells Kubernetes which load balancer implementation should handle a LoadBalancer Service. `allocateLoadBalancerNodePorts: false` skips node port allocation only for load balancer implementations that can route without node ports.

Those fields should appear when the platform needs them. A regular Service can usually leave them out. The first beginner habit stays the same: name the intended caller, then choose the narrowest Service type that serves that caller.

## Choosing the Type
<!-- section-summary: The right Service type follows the intended caller, the network owner, and the controls needed around the entry point. -->

The simplest review question is: **where does the normal caller sit?** If the caller is a Pod, ClusterIP usually fits. If the caller reaches node IPs through a deliberate network path, NodePort may fit. If the caller enters through cloud or platform infrastructure, LoadBalancer may fit.

For the checkout platform, this question keeps the design grounded in the real traffic story. `checkout-web` already sits inside the cluster, so it needs a private Service path. A partner, browser, or external appliance sits somewhere else, so the review has to name the network it comes from and the controls around that entry point before choosing a wider Service type.

| Situation | Service type that usually fits | Why it fits |
|---|---|---|
| `checkout-web` calls `orders-api` inside Kubernetes | **ClusterIP** | The caller already has cluster DNS and cluster network access. |
| An engineer needs a temporary local debug path | **ClusterIP plus port-forward** | The Service stays private while the tunnel exists only for the debugging session. |
| A local lab needs simple access from the host machine | **NodePort** | The node IP and high port give a visible path for a controlled environment. |
| A bare-metal cluster uses an existing appliance in front of nodes | **NodePort** | The appliance can target node IPs and the fixed node port. |
| A public HTTP platform needs one entry for many apps | **LoadBalancer for Gateway or Ingress, then ClusterIP backends** | The edge layer owns HTTP routing, TLS, and policy while backends stay private. |
| A private TCP service needs a stable address outside the cluster | **LoadBalancer** | The Service itself is the network entry point and the infrastructure controller owns the address. |

The checkout platform gives a concrete answer. `orders-api` is a backend API used by `checkout-web`, so ClusterIP is the starting point. The public browser path should land on a Gateway or Ingress controller, and that controller can call the internal Services.

Now imagine the business adds a partner integration. Partners need to create orders from outside the cluster. Publishing `orders-api` directly as a public LoadBalancer might look fast. The production path should still include authentication, rate limits, audit logs, versioned routes, TLS, monitoring, and a clear owner for the public contract. A Gateway route or Ingress path usually gives the team a cleaner place to manage those controls.

Direct LoadBalancer exposure fits some layer 4 designs. A database proxy, message broker, game server, or custom TCP service may need a stable layer 4 endpoint. In those cases, the review should name the protocol, client networks, allowed source ranges, health check behavior, DNS record, TLS or mTLS plan, and rollback plan before the Service goes live.

Cost belongs in the choice too. A ClusterIP Service costs no external load balancer. A LoadBalancer Service can create billable cloud resources, public IPs, data processing charges, firewall objects, and DNS work. A Service type can look like a tiny YAML field, and it may create infrastructure with an invoice and an attack surface.

## Debugging the Path
<!-- section-summary: Good Service debugging follows the same order every time: Service, DNS, ports, EndpointSlices, Pods, and then the exposure layer. -->

Service debugging stays clearer when the team follows the request path in order. The team starts with the Service object, then proves DNS, ports, EndpointSlices, Pods, and finally the exposure layer such as node networking or cloud load balancer events.

The first question is whether the internal Service is healthy before the team spends time on node ports or load balancer status. A NodePort or LoadBalancer can publish a visible entry point while the backend selector finds no ready Pods. That is why the first commands check the Service and EndpointSlices that every Service type still depends on.

For the internal ClusterIP path, the team can check the Service and its selected backends:

```bash
kubectl -n orders get svc orders-api -o wide
kubectl -n orders get endpointslices -l kubernetes.io/service-name=orders-api -o wide
kubectl -n orders get pods -l app.kubernetes.io/name=orders-api
```

An empty EndpointSlice usually points to a selector, label, readiness, or namespace problem. Changing the Service from ClusterIP to NodePort or LoadBalancer will still publish an empty backend. The external path may look alive while every request fails because no ready Pods sit behind the Service.

The next check should come from the same kind of place as the real caller. For an in-cluster caller, a temporary Pod in the caller namespace can test DNS and HTTP:

```bash
kubectl -n checkout run netcheck --rm -it --restart=Never --image=busybox:1.36 -- \
  sh -c 'nslookup orders-api.orders && wget -S -O- http://orders-api.orders/healthz'
```

Healthy output should show both the DNS answer and the application response:

```bash
Name:      orders-api.orders.svc.cluster.local
Address:   10.96.42.18
  HTTP/1.1 200 OK
{"status":"ok","service":"orders-api"}
```

For NodePort, the Kubernetes object only tells part of the story. The team also needs node addresses and network reachability:

```bash
kubectl -n orders get svc orders-api-nodeport -o jsonpath='{.spec.ports[*].nodePort}{"\n"}'
kubectl get nodes -o wide
```

If one network can reach the node port and another network fails, the cause often sits outside the Service object. Routes, firewall rules, cloud security groups, node public IPs, private IPs, and kube-proxy node port address configuration all decide who can connect to `<node-ip>:<node-port>`.

For LoadBalancer, a pending external address usually starts with Service events:

```bash
kubectl -n orders describe svc orders-api-public
```

The events may show a missing cloud integration, rejected annotations, quota limits, unsupported subnet choices, address allocation failures, or controller errors. After that, the platform owner checks the cloud controller or load balancer controller logs using the namespace and deployment names for that cluster.

Requests can also fail after the load balancer exists. In that case, the team should prove the backend again before editing the exposure layer:

```bash
kubectl -n orders describe svc orders-api-public
kubectl -n orders get endpointslices -l kubernetes.io/service-name=orders-api-public -o wide
kubectl -n orders get pods -l app.kubernetes.io/name=orders-api -o wide
```

The common mistakes are ordinary: the Service selector misses the Pod labels, `targetPort` points to the wrong container port name, readiness probes keep Pods out of the endpoint list, NetworkPolicy blocks the caller, or the load balancer health check points at a path outside the application's served routes.

## Changing Exposure Safely
<!-- section-summary: Exposure changes need a staged plan because they can widen reachability, create infrastructure, affect DNS and TLS, and change rollback behavior. -->

Changing a Service from ClusterIP to NodePort or LoadBalancer is a production exposure change. It deserves the same care as opening a firewall rule because it changes who can reach the application.

A safe pull request should include the intended caller, the Service type, the selected port, the target port, the expected external address style, the network controls, and the smoke test location. For the checkout platform, that means the reviewer can see whether the caller is `checkout-web`, a partner network, a public browser, or a platform edge controller.

The manifest diff gives reviewers the first concrete evidence. It shows whether the change only adjusts labels and ports or actually widens the Service audience.

```bash
kubectl diff -f k8s/orders-api-service.yaml
```

The review should answer these questions. Each answer ties the YAML field back to the real production path.

| Question | Why it matters |
|---|---|
| **Who is the intended caller?** | The caller audience decides whether ClusterIP, NodePort, or LoadBalancer fits. |
| **Which Service owns the stable internal name?** | Internal clients should keep a stable ClusterIP contract during edge changes. |
| **Which port do clients call?** | `port`, `targetPort`, and `nodePort` represent different parts of the path. |
| **Which networks can reach the entry point?** | NodePort and LoadBalancer depend on node routing, firewalls, subnets, and provider settings. |
| **Where do TLS and authentication happen?** | Public HTTP usually needs Gateway, Ingress, or another edge component to own these controls. |
| **What proves the backend is ready?** | EndpointSlices, readiness, logs, metrics, and smoke tests should match the intended caller path. |
| **What removes the exposure quickly?** | The rollback should return the live cluster and the Git source of truth to the safe design. |

For many teams, the safest public rollout creates a separate edge Service instead of changing the backend Service that internal callers already use. The backend can remain `orders-api` as ClusterIP, while `public-gateway` or `ingress-nginx-controller` receives the LoadBalancer address. This keeps application-to-application calls stable during the edge rollout.

After a LoadBalancer apply, the evidence should include the Service status, events, and the actual smoke test from the intended client network:

```bash
kubectl -n platform get svc public-gateway -o wide
kubectl -n platform describe svc public-gateway
curl -i https://checkout.devpolaris.example.com/healthz
```

If the design uses a private load balancer, the smoke test should come from the private network that real clients use. If the design uses a public hostname, the smoke test should use the real DNS name and TLS path instead of stopping at the raw load balancer address.

An emergency rollback can remove a direct external Service path by changing the Service type back to ClusterIP. This is a sharp tool for incidents, so the Git source of truth needs attention right after the live fix.

```bash
kubectl -n orders patch service orders-api-public --type=merge -p '{"spec":{"type":"ClusterIP"}}'
```

That kind of live patch can help during an incident, and the repository still needs the matching Git change afterward. In GitOps environments, the live patch is only a temporary incident action. The declared manifest remains the long-term source of truth.

## Putting It All Together
<!-- section-summary: ClusterIP, NodePort, and LoadBalancer are exposure choices, and the safest choice follows the real caller path. -->

ClusterIP, NodePort, and LoadBalancer all share the same Service idea: a stable address for changing backend Pods. ClusterIP publishes that address inside the cluster. NodePort adds a static high port on nodes. LoadBalancer asks infrastructure to publish an external address and connect that address back to the Service.

The checkout platform gives the practical pattern. `checkout-web` calls `orders-api` through a ClusterIP Service. A lab may use NodePort because the node-level path is intentional and visible. A production public entry usually uses a LoadBalancer Service for the Gateway or Ingress controller, then routes to ClusterIP backends.

The Service type is small YAML, and it controls audience, infrastructure, cost, and security review. A good team names the caller first, proves the backend with EndpointSlices and smoke tests, and only widens exposure for a clear reason.

![Kubernetes Service type review board centered on who the caller is, with checks for port, targetPort, EndpointSlices, firewall, DNS, TLS, rollback, and cost](/content-assets/articles/article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer/service-type-review-summary.png)

*The safest Service type choice starts with the caller, then checks the backend evidence and the exposure controls before production apply.*

## What's Next

LoadBalancer can publish an address. Public HTTP usually needs more than an address. The next article moves into Ingress, where hostnames, paths, TLS, and routing rules decide how web traffic reaches internal Services.

## References

- [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Defines Services, selectors, `port`, `targetPort`, ClusterIP, NodePort, LoadBalancer, NodePort ranges, load balancer status, and LoadBalancer implementation details.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Documents Service DNS names, namespace-qualified lookups, and how normal Services resolve to cluster IPs.
- [Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Shows the official troubleshooting flow for Service existence, DNS, IP reachability, Service definitions, EndpointSlices, Pods, and kube-proxy.
- [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Explains how Ingress exposes HTTP and HTTPS routes to Services, including load balancing, TLS termination, and name-based virtual hosting.
- [Gateway API overview](https://gateway-api.sigs.k8s.io/docs/concepts/api-overview/) - Describes Gateway, GatewayClass, and Route objects for translating external or infrastructure traffic to Services inside a cluster.
- [Using source IP](https://kubernetes.io/docs/tutorials/services/source-ip/) - Demonstrates how `externalTrafficPolicy: Local` affects source IP preservation and load balancer health check behavior.

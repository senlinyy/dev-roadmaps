---
title: "ClusterIP, NodePort, and LoadBalancer"
description: "Choose a Kubernetes Service type by understanding where the caller lives and which network boundary the request must cross."
overview: "ClusterIP, NodePort, and LoadBalancer publish the same stable application at progressively wider network boundaries. Begin with the caller's location, then add only the reachable entrance that caller needs."
tags: ["clusterip", "nodeport", "loadbalancer", "services"]
order: 2
id: article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer
---

## Table of Contents

1. [Why does the caller's location matter?](#why-does-the-callers-location-matter)
2. [What does ClusterIP make reachable?](#what-does-clusterip-make-reachable)
3. [What extra door does NodePort open?](#what-extra-door-does-nodeport-open)
4. [What does LoadBalancer ask the platform to build?](#what-does-loadbalancer-ask-the-platform-to-build)
5. [Which type fits the actual audience?](#which-type-fits-the-actual-audience)
6. [What changes when source IP must be preserved?](#what-changes-when-source-ip-must-be-preserved)
7. [How do you prove the added boundary works?](#how-do-you-prove-the-added-boundary-works)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

The clearest way to understand `ClusterIP`, `NodePort`, and `LoadBalancer` is to begin with one networking question:

> From where should a caller be able to send a packet that eventually reaches these Pods?

The previous article established the common Service model: a Service gives a changing set of ready Pods one stable identity, and the cluster data plane forwards connections to current endpoints. The **Service type** answers a different question. It decides where a reachable entrance to that stable identity should exist.

The three types form progressively wider levels of exposure:

| Service type | Entrance it provides |
|---|---|
| `ClusterIP` | A virtual Service address inside the cluster network |
| `NodePort` | The ClusterIP path plus the same reserved port on reachable node addresses |
| `LoadBalancer` | An infrastructure-managed address outside the cluster, with forwarding into the Service path |

Kubernetes commonly implements these as nested layers. NodePort builds on ClusterIP. LoadBalancer commonly builds on NodePort, although modern load-balancer implementations can route directly to Pods or another cluster data path.

Keep these questions in view as you work through the lesson:

1. **Why does the caller's location matter?**
2. **What does ClusterIP make reachable?**
3. **What extra door does NodePort open?**
4. **What does LoadBalancer ask the platform to build?**
5. **Which type fits the actual audience?**
6. **What changes when source IP must be preserved?**
7. **How do you prove the added boundary works?**

## Why does the caller's location matter?
<!-- section-summary: A Service address is useful only when the caller's network has a route to it; each Service type adds an entrance at a wider routing boundary. -->

Every Service type starts with the same problem from the Services article. Three API Pods may currently have these addresses:

```text
api-7fd8    10.244.1.17
api-a932    10.244.2.31
api-b551    10.244.3.22
```

A replacement Pod may appear later at `10.244.4.93`. The stable Service identity protects callers from that changing endpoint set. Suppose Kubernetes assigns the Service a ClusterIP of `10.96.42.10` on port `80`.

The next issue is routing. An address is useful only when the caller can send packets toward the network containing that address.

A Pod inside the cluster may have a route for the Service network, such as `10.96.0.0/12`, so it can reach `10.96.42.10`. A developer's laptop on home Wi-Fi or a public customer's router usually lacks an entry for that internal Service range. Publishing the number leaves those routing tables unchanged.

This is the first principle behind all three types:

> Exposure means adding a reachable entrance at the network boundary where the intended caller currently stops.

There are three useful boundaries:

1. **Cluster network:** Pods and other systems with routes into the cluster Service network can use ClusterIP.
2. **Node network:** Systems able to reach Kubernetes node addresses can use a NodePort entrance.
3. **External network:** Public or private external clients can use an address provisioned by a load-balancer integration.

![An internal Pod, a machine on a node-reachable network, and an external client use ClusterIP, NodePort, and LoadBalancer entrances that converge on one Service backend](/content-assets/articles/article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer/service-type-audience-map.png)

*The intended caller determines the required entrance; the ready Service endpoints remain the shared destination.*

The wider types add reachability rather than improving the application. The selector, EndpointSlices, ready Pods, and target port can remain identical. The new type adds one more address and forwarding responsibility before that common backend path.

Reachability and permission also remain separate. A route answers whether a packet can reach an address. NetworkPolicy, firewalls, application authentication, and authorization answer whether that communication should be allowed. Service type supplies an entrance; the security layers supply trust and permission.

## What does ClusterIP make reachable?
<!-- section-summary: ClusterIP gives callers on the cluster network one stable virtual address and DNS name while leaving node-level and external routing unchanged. -->

`ClusterIP` is the default Service type. It allocates a virtual IP from the cluster's Service network and connects that stable address to the current ready endpoints.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments
spec:
  type: ClusterIP
  selector:
    app: payments
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Suppose the allocated address is `10.96.20.50`. A Pod in the cluster can call the IP directly:

```bash
curl http://10.96.20.50
```

It will normally use the DNS name instead:

```bash
curl http://payments
```

Cluster DNS resolves the Service name to `10.96.20.50`. The Service data plane then selects a ready EndpointSlice address and forwards the connection from Service port `80` to target port `8080`.

For example, the packet can begin with these addresses:

```text
caller Pod: 10.244.2.8
destination: 10.96.20.50:80
```

After endpoint selection, the destination may become:

```text
backend Pod: 10.244.3.42:8080
```

ClusterIP adds no node-level port and requests no external load balancer. An ordinary internet router has no reason to know how to reach `10.96.20.50`.

The natural uses are internal application relationships:

- a frontend calling a backend API;
- a worker calling an internal job service;
- an API calling a private database proxy;
- a metrics collector with cluster network access scraping an application;
- Ingress or Gateway components forwarding to application backends.

“Internal” describes the normal routing scope of the virtual address. Authorization is a separate control. A Pod in another namespace may still reach the Service when routing and policy allow it. NetworkPolicy or application authorization supplies the communication boundary when only specific callers should use the Service.

ClusterIP is therefore the normal starting point, including for applications that eventually serve public traffic. A shared Ingress or Gateway can receive public HTTP requests while every application behind it remains a private ClusterIP Service.

## What extra door does NodePort open?
<!-- section-summary: NodePort reserves one Service port on node addresses, making the Service reachable to callers that can already route to those nodes. -->

Suppose a client's routing table reaches the private addresses of the Kubernetes nodes while the ClusterIP range remains outside that table:

```text
node1    192.168.10.11
node2    192.168.10.12
node3    192.168.10.13
```

A NodePort Service reserves the same high port on eligible node addresses and connects that node-level entrance to the Service backend.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments
  namespace: platform
spec:
  type: NodePort
  selector:
    app: payments
  ports:
    - name: http
      port: 80
      targetPort: 8080
      nodePort: 31234
```

The default NodePort allocation range is `30000-32767`, although cluster operators can configure a different range. If `31234` is allocated, the same Service now has these entrances:

```text
ClusterIP:               10.96.20.50:80
node1 NodePort:      192.168.10.11:31234
node2 NodePort:      192.168.10.12:31234
node3 NodePort:      192.168.10.13:31234
```

Kubernetes normally implements this through node networking rules rather than by starting an application process that calls `listen(31234)` on every node. Packets addressed to a node IP and the NodePort are recognized as Service traffic and sent toward a ready endpoint.

With the common `externalTrafficPolicy: Cluster` behavior, the chosen backend can live on a different node. A request arriving at node 2 may cross the Pod network to a ready Pod on node 3. The entrance node and the workload node are separate decisions.

NodePort creates a node-network entrance. Actual reachability still depends on the surrounding network:

- the caller needs a route to a node address;
- host or cloud firewalls must allow the reserved port;
- cloud security groups and network ACLs may control the path;
- private nodes may require a VPN or private network connection;
- NAT and public-address configuration determine whether an internet client can reach the node.

This is why NodePort can be useful without being public. A monitoring appliance inside a company network, a test client connected through a VPN, or an external load balancer managed outside Kubernetes may deliberately use node addresses. The NodePort supplies the Kubernetes-side primitive; the operator supplies and protects the network path to the nodes.

That primitive also explains why NodePort exists. Kubernetes controls its nodes and can define “port `31234` on these node addresses means this Service.” Provisioning a public IP, cloud load balancer, MetalLB address, F5 appliance, or another external system requires infrastructure-specific integration. NodePort is the wider entrance Kubernetes can provide with its own node data plane.

For end users, a raw address such as `https://192.0.2.17:31467` is usually an infrastructure entry point rather than a durable web identity. Node replacement can change addresses, and NodePort has no hostname routing, shared TLS policy, or path routing. Those requirements lead naturally to an external load balancer, Ingress, or Gateway.

## What does LoadBalancer ask the platform to build?
<!-- section-summary: LoadBalancer stores an infrastructure request in Kubernetes; an external controller must create an address, health checks, and forwarding path before traffic can use it. -->

An outside client needs an address that its own network can route to. The application team may want `203.0.113.50:443` rather than a list of node addresses and high ports.

A LoadBalancer Service declares that intent:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  type: LoadBalancer
  selector:
    app: api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

The Kubernetes API server stores the Service immediately. External implementations supply the platform-specific work for AWS, Azure, Google Cloud, MetalLB, F5, and other load-balancing systems. A cloud integration or load-balancer controller watches for Services of this type and reconciles that infrastructure.

That controller may:

1. allocate or attach an external IP address;
2. create or configure a load balancer;
3. configure listeners and forwarding targets;
4. create health checks;
5. publish the usable address in `.status.loadBalancer.ingress`.

While no controller has fulfilled the request, the Service can show:

```text
NAME   TYPE           CLUSTER-IP     EXTERNAL-IP
api    LoadBalancer   10.96.20.50    <pending>
```

The desired Kubernetes object exists, while the external entrance is still missing. On a bare-metal cluster with no load-balancer implementation, `<pending>` can remain indefinitely because no component is present to perform the infrastructure work.

![A LoadBalancer Service is reconciled by an infrastructure controller into an external address, health checks, and a working path to ready endpoints](/content-assets/articles/article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer/loadbalancer-edge-pattern.png)

*Applying the Service records intent; status and a real request prove that infrastructure fulfilled it.*

The common historical path is:

1. an external client connects to the load-balancer address;
2. the load balancer forwards to a node IP and NodePort;
3. the Service data plane selects an endpoint;
4. the Pod receives the connection on its target port.

That explains why LoadBalancer is often taught as ClusterIP plus NodePort plus an external entrance. The implementation can differ. A load-balancer controller may route directly to Pod addresses or another data path, removing the node port from the actual packet journey.

Kubernetes supports that design with:

```yaml
spec:
  type: LoadBalancer
  allocateLoadBalancerNodePorts: false
```

This setting is appropriate when the load-balancer implementation can reach its targets without allocated NodePorts. The default remains to allocate them. The durable mental model is therefore an externally reachable frontend plus platform-managed forwarding to Service endpoints, with the exact hops determined by the environment.

The external address can be public or private. A public load balancer may serve internet users. An internal load balancer may expose the application only inside a corporate VPC. `type: LoadBalancer` describes who provisions the entrance, while controller annotations, classes, and platform configuration usually determine its precise network scope.

The type also creates infrastructure lifecycle and cost. Several LoadBalancer Services may create several billable load balancers and addresses. Deleting the Service may cause the controller to delete that infrastructure. Shared HTTP applications often use one LoadBalancer in front of an Ingress or Gateway so hostnames and paths can share the same managed edge.

## Which type fits the actual audience?
<!-- section-summary: Choose the narrowest entrance that the real caller can reach, treating Service types as exposure mechanisms rather than quality tiers. -->

The decision begins with the intended caller:

| Actual caller | Natural starting point |
|---|---|
| Another Pod or internal service | ClusterIP |
| Internal monitoring system with cluster connectivity | Usually ClusterIP |
| Machine that can reach node addresses | Possibly NodePort |
| External load balancer managed by the operator | Often NodePort |
| Client inside a private cloud network | Often an internal LoadBalancer |
| Public internet user | Usually LoadBalancer, Ingress, or Gateway |
| HTTP clients using several hostnames or routes | Ingress or Gateway forwarding to ClusterIP Services |

Choose the smallest network audience that satisfies the requirement. The three types are different exposure mechanisms, and each can be the correct production choice. A private ClusterIP Service fits an internal dependency, while a public LoadBalancer would widen that dependency's audience and operating responsibilities.

A building entrance is a useful analogy for the routing boundaries:

- **ClusterIP:** an internal reception desk serves people who have already entered the building.
- **NodePort:** the same numbered entrance exists on each eligible side of the building; arriving at any reachable entrance leads toward an available office.
- **LoadBalancer:** an organized entrance outside the building receives visitors and directs them into the appropriate internal path.

The analogy also shows why the entrances can be nested. A public traffic director may send visitors through one of the node entrances, while the internal reception system still maps the application identity to a current office.

Protocol requirements can change the final architecture. One externally reachable TCP service may fit a LoadBalancer Service directly. Thirty HTTP applications would be awkward as thirty node ports or thirty public load balancers. A shared Gateway or Ingress can accept port `443`, choose a backend from the hostname or path, and forward to private ClusterIP Services:

| Incoming HTTP request | Shared edge decision | Private backend |
|---|---|---|
| `shop.example.com` | Host `shop.example.com` | `shop` ClusterIP |
| `api.example.com` | Host `api.example.com` | `api` ClusterIP |
| `admin.example.com` | Host `admin.example.com` | `admin` ClusterIP |

Every wider boundary adds operational responsibilities: routes, firewall policy, TLS where relevant, denial-of-service protection, monitoring, cost ownership, infrastructure health, and rollback. Keeping the audience as narrow as the requirement keeps those responsibilities proportionate.

## What changes when source IP must be preserved?
<!-- section-summary: externalTrafficPolicy controls whether an entry node may use any cluster endpoint or only local endpoints, trading broad distribution for source-IP preservation and fewer hops. -->

Suppose an outside client has address `203.0.113.77`. The application may need that address for rate limiting, audit trails, security analysis, or regional decisions.

External Service traffic introduces a choice through `externalTrafficPolicy`:

```yaml
spec:
  externalTrafficPolicy: Cluster
```

`Cluster` allows traffic entering one node to use a ready endpoint anywhere in the cluster. If a connection arrives at node A while the chosen Pod runs on node B, Kubernetes can forward across the Pod network.

This provides three useful properties:

- every ready endpoint remains available;
- every eligible entry node can accept traffic;
- the cluster can distribute work across the full endpoint set.

The cross-node path can require source network address translation. The Pod may observe a node address such as `10.0.1.10` as its peer instead of the original client address `203.0.113.77`.

For workloads that must preserve the original source, the Service can use:

```yaml
spec:
  externalTrafficPolicy: Local
```

`Local` tells a node to send externally arriving Service traffic only to endpoints running on that same node. Avoiding the cross-node forwarding path allows the original client address to remain visible to the Pod and removes one network hop.

The trade-off appears when ready Pods occupy only some nodes:

| Node | Local ready payments Pod? | Safe target with `Local`? |
|---|---:|---:|
| node A | Yes | Yes |
| node B | No | No |
| node C | Yes | Yes |

Traffic arriving at node B has no local endpoint. Forwarding it to node C would break the `Local` promise. For a LoadBalancer Service, platform health checks must therefore remove node B from the target set. The external load balancer should send new connections only to nodes A and C.

The two policies can be compared directly:

| Policy | Eligible endpoints | Possible cross-node hop | Source IP seen by application | Main trade-off |
|---|---|---:|---|---|
| `Cluster` | Ready endpoints across the cluster | Yes | May be translated to a node address | Broad distribution and endpoint use |
| `Local` | Ready endpoints on the entry node | No | Original client address can be preserved | Uneven distribution and dependency on node-aware health checks |

Provider and data-plane implementations can change the physical path, especially when a load balancer routes directly to Pods. Verify the actual platform behavior rather than treating one node-based drawing as universal.

Source-IP preservation should be proved through observation. An application endpoint can report the peer address it sees. Record the request ID, receiving Pod, node, and observed source:

```text
request    receiving Pod    node     observed source
1          api-a            node1    203.0.113.77
2          api-c            node3    203.0.113.77
3          api-a            node1    203.0.113.77
```

Repeat the experiment under `Cluster` and `Local`. The configuration field expresses intent; the application's peer address proves the resulting data path.

## How do you prove the added boundary works?
<!-- section-summary: Test the common Service backend once, then observe each added entrance from a caller on the network that entrance is meant to serve. -->

Inspection shows desired configuration. Reachability requires a packet from the intended caller.

Suppose one Service reports:

```text
Service name: api
ClusterIP:    10.96.20.50
NodePort:     31234
External IP:  203.0.113.50
```

Use three observers:

1. a Pod inside the cluster;
2. a machine able to reach the node network;
3. a machine on the actual external network the load balancer serves.

Begin by proving the shared backend from inside the cluster. That keeps the Service and its application endpoints constant before you examine a wider entrance.

### Prove the ClusterIP boundary

From another Pod, call the name or ClusterIP:

```bash
curl http://api
curl http://10.96.20.50
```

A successful request proves cluster DNS or the virtual address, Service forwarding, and an application endpoint. Test the ClusterIP from a normal outside machine as well. An absent Service-network route should make that outside request fail. Together, the observations prove the intended scope: cluster callers can reach it, while ordinary outside callers remain outside its routing boundary.

### Prove the NodePort boundary

Read the allocated port and node addresses:

```bash
kubectl get svc api
kubectl get nodes -o wide
```

From a machine that should reach the nodes, test several node addresses:

```bash
curl http://NODE_1_IP:31234
curl http://NODE_2_IP:31234
curl http://NODE_3_IP:31234
```

Under `externalTrafficPolicy: Cluster`, each reachable eligible node should normally accept Service traffic even when the chosen backend Pod lives elsewhere. If ClusterIP succeeds while every NodePort attempt times out, preserve the proved Service backend and inspect node routes, firewalls, security groups, the allocated port, and node-level data-plane rules.

### Prove the LoadBalancer boundary

Inspect controller progress and Service status:

```bash
kubectl get svc api
```

Once the external address appears, call it from the intended external network:

```bash
curl http://203.0.113.50
```

For a public load balancer, a public client should reach the address. For an internal load balancer, a VPC or corporate client should reach it while a public internet client should fail. This tests the network audience rather than merely checking for HTTP `200` from one convenient machine.

If NodePort works while `EXTERNAL-IP` remains `<pending>`, investigate the controller, infrastructure permissions, address quota, or missing load-balancer implementation. If the external address accepts a connection but health checks reject every backend, compare the configured health path and port with the actual Service and endpoint path.

![A Service exposure investigation proves selector, ports, EndpointSlices, and ready Pods once, then isolates the additional ClusterIP, NodePort, or LoadBalancer boundary](/content-assets/articles/article-containers-orchestration-kubernetes-networking-clusterip-nodeport-loadbalancer/service-type-review-summary.png)

*Keep the healthy backend fixed while testing the entrance added for the intended caller.*

For a difficult path, write down the concrete addresses in the order a packet encounters them:

| Stage | Example address |
|---|---|
| Caller | `203.0.113.77` |
| External load balancer | `198.51.100.10:443` |
| NodePort, when used | `10.0.1.12:31443` |
| ClusterIP and Service port | `10.96.15.8:443` |
| Pod IP and target port | `10.244.3.17:8443` |

At each transition, answer six questions:

1. Does the caller have a route to the next address?
2. Do firewalls, security groups, NetworkPolicy, and other controls allow the packet?
3. Which component translates or forwards the destination?
4. Which endpoints are eligible at this point?
5. Does source or destination NAT occur?
6. Which source and destination addresses will the next component observe?

This method turns a large “Kubernetes networking” failure into a specific unproved boundary. Repair that boundary and repeat the original request before removing the previous entrance or changing the healthy backend.

## Check Your Answers
<!-- section-summary: Explain Service types through caller location, added entrances, infrastructure ownership, source-IP policy, and evidence from the real network boundary. -->

:::expand[Why does the caller's location matter?]{kind="recap"}
An address works only when the caller's network can route packets to it. ClusterIP, NodePort, and LoadBalancer add entrances at the cluster, node, and external boundaries while converging on the same Service endpoints.
:::

:::expand[What does ClusterIP make reachable?]{kind="recap"}
ClusterIP gives callers with cluster-network routing a stable virtual Service address and DNS name. It leaves node-level and external entrances unchanged, making it the normal choice for internal dependencies and backends behind a shared edge.
:::

:::expand[What extra door does NodePort open?]{kind="recap"}
NodePort reserves the same high port on eligible node addresses and connects it to the Service. Kubernetes supplies the node-side entry; routes, firewalls, VPNs, public addresses, DNS, and TLS determine who can actually use it.
:::

:::expand[What does LoadBalancer ask the platform to build?]{kind="recap"}
The Service records a request for an infrastructure-managed external address and forwarding path. A controller must allocate the address, configure listeners and health checks, connect the path to Service endpoints, and publish the result in status.
:::

:::expand[Which type fits the actual audience?]{kind="recap"}
Choose the narrowest entrance that reaches the real caller: ClusterIP for cluster-network clients, NodePort for deliberate node-network access, and LoadBalancer for a managed outside entrance. Shared HTTP hostnames and routes often fit Ingress or Gateway over ClusterIP backends.
:::

:::expand[What changes when source IP must be preserved?]{kind="recap"}
`externalTrafficPolicy: Cluster` can use ready endpoints across nodes but may add a cross-node hop and source translation. `Local` restricts traffic to node-local endpoints, which can preserve the client address while requiring node-aware health checks and accepting less even distribution.
:::

:::expand[How do you prove the added boundary works?]{kind="recap"}
Prove the selector, ports, EndpointSlices, ready Pods, and application once. Then test ClusterIP from the cluster, NodePort from a node-reachable machine, and LoadBalancer from its intended external network. Record each address and stop at the first unproved transition.
:::

## References

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official ClusterIP, NodePort, LoadBalancer, NodePort allocation, and load-balancer behavior.
- [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) - Official Service virtual-address and traffic-policy implementation model.
- [Using Source IP](https://kubernetes.io/docs/tutorials/services/source-ip/) - Official source-IP behavior for Service traffic.
- [Create an External Load Balancer](https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/) - Official external load-balancer and traffic-policy guidance.
- [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official shared HTTP and HTTPS routing model.
- [Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/) - Official role-oriented shared traffic model.

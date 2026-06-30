---
title: "Services"
description: "Use Kubernetes Services to give changing Pods a stable name, port, and backend discovery point."
overview: "A Service is the stable network contract in front of changing Pods. A checkout example traces Pod IP churn, Service DNS, selectors, EndpointSlices, readiness, and production debugging."
tags: ["services", "selectors", "endpoints", "dns", "kubectl"]
order: 1
id: article-containers-orchestration-kubernetes-networking-services
---
## Table of Contents

1. [Services Give Callers A Stable Address](#services-give-callers-a-stable-address)
2. [The First Service](#the-first-service)
3. [Selectors Choose the Backends](#selectors-choose-the-backends)
4. [EndpointSlices Show the Real Backend List](#endpointslices-show-the-real-backend-list)
5. [Ports Separate the Caller Contract From the Container](#ports-separate-the-caller-contract-from-the-container)
6. [DNS Gives the Service a Name](#dns-gives-the-service-a-name)
7. [Readiness Decides Who Receives Traffic](#readiness-decides-who-receives-traffic)
8. [Debugging a Service in Production](#debugging-a-service-in-production)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Services Give Callers A Stable Address
<!-- section-summary: Pods move and get replaced, so callers need a stable Service name instead of a changing list of Pod IPs. -->

A caller inside Kubernetes needs a stable place to send traffic even while backend Pods move. In the checkout path, `checkout-web` should call the orders API every time a customer submits an order, but the orders Pods can restart, roll forward, scale out, or move to other nodes.

A **Service** is the Kubernetes object that gives those changing Pods a stable network contract. It gives callers a name and port, then Kubernetes keeps a live backend list of the Pods that match the Service selector and pass readiness checks.

At first, a direct Pod IP can look tempting. A quick Pod listing may show one orders Pod at `10.244.2.17`, and someone might wire `checkout-web` to call `http://10.244.2.17:8080`. That shortcut works during a demo because one Pod happens to exist at that address at that moment.

Then the orders team ships version `2.4.2`, Kubernetes creates a replacement Pod, and the old Pod disappears. `checkout-web` still carries the old address, so its next health check can time out even though the orders API is healthy on a newer Pod. The caller needs a stable way to say, "I want the orders API," while Kubernetes keeps replacing the actual processes behind it.

![Kubernetes Service stable contract showing checkout-web calling a orders-api Service while EndpointSlices track replaceable ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/service-stable-contract.png)

*The Service is the caller-facing contract. Pod IPs can churn during rollouts or repairs while the name, port, selector, and EndpointSlices keep the backend path stable.*

For the checkout path, `checkout-web` should call a Service name such as `http://orders-api.orders.svc.cluster.local`. That name means the `orders-api` Service in the `orders` namespace. The caller can keep using that name while the orders Deployment rolls from version `2.4.1` to `2.4.2`, scales from two replicas to six, or moves Pods across nodes during maintenance.

So the first job is clear. The orders team needs to publish a stable Service in front of changing Pods.

## The First Service
<!-- section-summary: A basic ClusterIP Service publishes an internal name and port for Pods selected by labels. -->

A **ClusterIP Service** is the default Service type. It gives the Service an internal cluster IP and makes it reachable from inside the cluster. This is the normal starting point for one backend calling another backend, like `checkout-web` calling `orders-api`.

The Service is the first object where the orders team publishes a contract for callers. `checkout-web` should know a stable name and port, while the orders Deployment can keep changing Pod IPs behind that contract. A beginner can treat the Service as a small promise: this name exists in this namespace, this selector finds the backend Pods, and this port is safe for callers to use.

A complete first Service can stay small. The orders Deployment still needs matching Pod labels and a named container port, but the Service object is the caller-facing contract reviewers usually read first:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: orders-api
    app.kubernetes.io/component: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

Each field has a concrete job:

- `metadata.name: orders-api` gives callers the Service name.
- `metadata.namespace: orders` places that name inside the `orders` namespace.
- `spec.type: ClusterIP` keeps the Service reachable only through the cluster network.
- `spec.selector` chooses Pods that carry both orders labels.
- `spec.ports[].name: http` gives the port a stable name that other objects can reference.
- `spec.ports[].port: 80` is the caller-facing Service port.
- `spec.ports[].targetPort: http` sends traffic to the Pod port named `http`.

The Deployment side must line up with that contract. The Pod template should carry `app.kubernetes.io/name=orders-api` and `app.kubernetes.io/component=api`, and the container should expose a port named `http` on `8080`. Kubernetes uses TCP when `protocol` is omitted, so this example keeps the Service short. In production, teams treat these fields with the same care they give an API route. If `checkout-web` calls `orders-api.orders` on port `80`, a casual rename or port change can break checkout even while every orders Pod looks healthy.

Now the next question is the important one. How does Kubernetes know which Pods belong behind this Service?

## Selectors Choose the Backends
<!-- section-summary: A Service selector is a label query, and a selector typo gives you a Service with no useful backends. -->

A **label** is a key-value pair attached to a Kubernetes object. A **selector** is a query over those labels. In a Service, the selector tells Kubernetes which Pods should receive traffic for that Service.

The orders Service uses two selector labels: `app.kubernetes.io/name=orders-api` and `app.kubernetes.io/component=api`. A Pod needs both labels to belong behind the Service. The Deployment template puts those labels on every new orders Pod, so the Service can find them.

This is simple, and it is also one of the easiest places to make a production mistake. If the Deployment uses `app.kubernetes.io/name: order-api` and the Service selector uses `app.kubernetes.io/name: orders-api`, the Service still exists, DNS can still resolve, and the Service still has a cluster IP. It just has no matching Pods. From the caller side, that often looks like a timeout or connection failure.

Here is the first check a team usually runs:

```bash
kubectl -n orders get pods -l app.kubernetes.io/name=orders-api,app.kubernetes.io/component=api --show-labels
```

Healthy output should show the orders Pods and the labels the Service expects:

```bash
NAME                            READY   STATUS    RESTARTS   AGE   LABELS
orders-api-65dc7c9f4d-7sk2c   1/1     Running   0          12m   app.kubernetes.io/name=orders-api,app.kubernetes.io/component=api,app.kubernetes.io/part-of=shop-platform
orders-api-65dc7c9f4d-cb9mh   1/1     Running   0          12m   app.kubernetes.io/name=orders-api,app.kubernetes.io/component=api,app.kubernetes.io/part-of=shop-platform
orders-api-65dc7c9f4d-q6x4z   1/1     Running   0          12m   app.kubernetes.io/name=orders-api,app.kubernetes.io/component=api,app.kubernetes.io/part-of=shop-platform
```

The Service selector only finds Pods in the same namespace as the Service. If the Service lives in `orders` and a Deployment accidentally lands in `checkout`, the selector will not cross the namespace boundary. That matters in real clusters because teams often split namespaces by application, environment, or ownership.

Selectors answer which Pods should be used. The next useful object shows which Pod IPs Kubernetes actually selected.

## EndpointSlices Show the Real Backend List
<!-- section-summary: EndpointSlices list the current backend IPs and ports behind a Service, which makes Service state visible during debugging. -->

An **EndpointSlice** is a Kubernetes discovery object that stores a slice of network endpoints for a Service. For a normal selector-based Service, the control plane watches Pods, evaluates the Service selector, and writes the matching backend addresses into EndpointSlices.

This gives operators a very practical view. The Service is the contract that callers use. EndpointSlices are the current backend list behind that contract.

For the orders example, this is where the article stops trusting the manifest and checks live cluster state. The Service YAML can look correct while a rollout, readiness probe, or label typo leaves the real backend list empty. EndpointSlices answer the question that matters during an incident: which Pod IPs and ports can receive traffic right now?

For the orders Service, this command shows the selected backend addresses:

```bash
kubectl -n orders get endpointslices -l kubernetes.io/service-name=orders-api -o wide
```

Typical output looks like this:

```bash
NAME                  ADDRESSTYPE   PORTS   ENDPOINTS
orders-api-p8mq9    IPv4          8080    10.244.1.32,10.244.2.18,10.244.3.44
```

That output tells a very concrete story. The Service named `orders-api` has backend endpoints on port `8080`, and Kubernetes currently sees three Pod IPs behind it. If the `ENDPOINTS` column is empty, the selector did not find ready backends, or every selected backend is currently excluded from traffic.

![Service selector and EndpointSlice flow showing Pod labels, readiness, selected endpoints, and unready Pods left out of traffic](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/selector-endpointslice-flow.png)

*Selectors decide which Pods belong behind the Service, and readiness decides which selected Pods should actually receive traffic.*

EndpointSlices also matter as Services grow. Kubernetes can create multiple EndpointSlice objects for one Service instead of forcing every backend into one giant object. The lookup label `kubernetes.io/service-name=orders-api` is the normal way to gather all the slices that belong to the Service.

Now we know how the Service finds Pods. The next piece is where traffic enters the Service and where it lands inside each Pod.

## Ports Separate the Caller Contract From the Container
<!-- section-summary: The Service port belongs to callers, while targetPort points to the backend Pod port. -->

A Service usually has two port ideas. The **Service port** is the port callers use on the Service. The **target port** is the port Kubernetes sends traffic to on the backend Pods.

In our manifest, callers use Service port `80`. The target port is `http`, and the Deployment says the container port named `http` is `8080`. So the path is: `checkout-web` calls `orders-api.orders:80`, the Service chooses one ready backend, and Kubernetes sends the request to port `8080` on an orders Pod.

Named target ports are useful during rollouts. Imagine the orders team moves the application from port `8080` to port `9090` in version `2.5.0`. If every Pod still exposes a port named `http`, the Service can keep `targetPort: http` while old and new Pods overlap during the rollout. The application team can change the container implementation while the caller-facing Service contract stays stable. The web app still calls the same Service name and port.

When a Service fails, this port split deserves a careful check. A common mistake is `port: 80` with `targetPort: 3000` while the application actually listens on `8080`. Another common mistake is `targetPort: http` while the Pods expose a port named `web`. Kubernetes cannot route to the port you meant in your head; it routes to the number or name in the manifest.

With selector and ports in place, the caller still needs a clean way to find the Service. That is where Kubernetes DNS enters the story.

## DNS Gives the Service a Name
<!-- section-summary: Kubernetes DNS lets Pods call Services by stable names, and namespace-qualified names prevent cross-namespace confusion. -->

Kubernetes creates DNS records for Services. That means a Pod can call a Service by name instead of hardcoding the Service cluster IP.

For our example, a Pod inside the `orders` namespace can usually call `http://orders-api/healthz`. A Pod in another namespace should use `http://orders-api.orders/healthz`. The fully qualified form, `http://orders-api.orders.svc.cluster.local/healthz`, is useful in runbooks and incident notes because every DNS piece is visible.

The namespace piece matters. If `checkout-web` runs in the `checkout` namespace and calls `http://orders-api/healthz`, Kubernetes DNS will first look for a Service named `orders-api` in `checkout`. If the real Service lives in `orders`, the caller should use `orders-api.orders` or the full name.

Here is a practical DNS check from the caller namespace:

```bash
kubectl -n checkout run service-dns-check --rm -it --restart=Never --image=busybox:1.36 -- \
  nslookup orders-api.orders.svc.cluster.local
```

The response should resolve to the Service's cluster IP for a normal ClusterIP Service:

```bash
Name:      orders-api.orders.svc.cluster.local
Address:   10.96.41.23
```

DNS gives the caller a stable name. Selectors and EndpointSlices give Kubernetes a backend list. There is one more traffic decision before a Pod should receive requests: readiness.

## Readiness Decides Who Receives Traffic
<!-- section-summary: Readiness probes keep Pods out of Service traffic until the application can actually handle requests. -->

A **readiness probe** tells Kubernetes whether a container is ready to receive traffic. A process can be running while the application still cannot serve useful requests. It might be loading configuration, opening a database connection, warming caches, or waiting for a dependency.

Readiness is the link between application health and Service traffic. Without it, a new orders Pod could receive checkout requests as soon as the container starts, even if the app has not loaded its inventory service config yet. The probe gives Kubernetes a small application-level signal before the Pod joins the Service backend list.

Here is a readiness probe for the orders API:

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: http
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```

With this probe, Kubernetes checks `/readyz` on the named `http` port. When the probe succeeds, the Pod can receive Service traffic. When the probe fails, Kubernetes can remove that Pod's IP from the EndpointSlices for matching Services.

The readiness fields control that decision:

- `httpGet.path: /readyz` names the application endpoint Kubernetes calls.
- `httpGet.port: http` uses the named container port instead of a raw number.
- `initialDelaySeconds: 5` gives the app a short startup window before checks run.
- `periodSeconds: 10` checks readiness every ten seconds.
- `failureThreshold: 3` removes the Pod from ready traffic after three failed checks.

Services and rollouts fit together through that readiness decision. During a rollout, Kubernetes creates a new orders Pod, waits for readiness, adds it to the backend list, and then continues replacing old Pods according to the Deployment strategy. `checkout-web` keeps using the Service name while the backend membership changes.

The ready condition is visible in EndpointSlices. This proof is useful because it reads the backend membership Kubernetes will use for Service traffic:

```bash
kubectl -n orders get endpointslices \
  -l kubernetes.io/service-name=orders-api \
  -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{" ready="}{.conditions.ready}{"\n"}{end}'
```

Healthy output should look like this:

```bash
10.244.1.32 ready=true
10.244.2.18 ready=true
10.244.3.44 ready=true
```

If every endpoint shows `ready=false`, the Service can exist, DNS can resolve, and callers can still fail because no backend is ready to accept traffic. The next checks are readiness events on the selected Pods and recent application logs from the orders Deployment.

The readiness endpoint should describe whether the application can serve requests, rather than only whether the process is alive. For an orders API, `/readyz` might check that required configuration is loaded and the inventory service client can be initialized. Teams often keep deeper dependency checks lightweight because a slow or flaky readiness endpoint can remove healthy Pods from traffic.

Now we have all the main pieces. The final job is to use them in a repeatable debugging flow.

## Debugging a Service in Production
<!-- section-summary: Service debugging should move from caller evidence to DNS, Service definition, EndpointSlices, Pods, and application behavior. -->

Service incidents usually arrive as simple symptoms. Checkout fails, `checkout-web` returns `502`, or a worker reports `connection refused`. The useful response is to check one Service layer at a time and keep one proof per layer.

The Service is the caller-facing contract, so it deserves the first look. From there, each check moves one step closer to the actual application: DNS name, selector, EndpointSlice, Pod readiness, target port, and application response. This keeps the team from changing several objects at once before they know which layer failed.

The first useful evidence is the Service object. It should show the expected type, cluster IP, Service port, target port, and selector:

```bash
NAME           TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
orders-api   ClusterIP   10.96.41.23   <none>        80/TCP    18m   app.kubernetes.io/component=api,app.kubernetes.io/name=orders-api
```

The rest of the ladder can stay compact:

| Layer | Proof to capture | What a failure usually means |
|---|---|---|
| Caller namespace | Smoke request from `checkout` to `http://orders-api.orders/healthz` | The symptom is reproducible from the same side as the app |
| DNS | Lookup of `orders-api.orders.svc.cluster.local` from `checkout` | Wrong name, missing namespace, or cluster DNS trouble |
| EndpointSlice | Backend list labeled `kubernetes.io/service-name=orders-api` | Selector mismatch, unready Pods, or no matching Pods |
| Pod labels and readiness | Selected Pods with labels, `READY`, events, and recent logs | Label drift, readiness failure, crash, or bad startup config |
| Application path | Direct backend proof through port-forward or a caller-side Pod request | App listener, port, or Service routing problem |

A port-forward to the Deployment gives a local application proof without adding another caller path:

```bash
kubectl -n orders port-forward deployment/orders-api 8080:8080
curl -i http://127.0.0.1:8080/healthz
```

This gives a clean split. If the port-forwarded application fails, the problem is inside the Pod or application. If the port-forwarded application works and the Service path fails, the issue sits in the Service definition, target port, DNS, NetworkPolicy, node Service implementation, or something between caller and backend.

Here is a compact review table for the common cases:

| Symptom | First useful check | Common cause |
|---|---|---|
| Caller gets `Name or service not known` | `nslookup orders-api.orders.svc.cluster.local` from the caller namespace | Wrong Service name, missing namespace, or DNS problem |
| DNS resolves but requests time out | `kubectl -n orders get endpointslices -l kubernetes.io/service-name=orders-api -o wide` | No ready endpoints, blocked traffic, or wrong backend port |
| EndpointSlices are empty | `kubectl -n orders get pods --show-labels` | Selector misses the Pod labels or Pods are in another namespace |
| EndpointSlices show the wrong port | `kubectl -n orders get svc orders-api -o yaml` | `targetPort` points to the wrong number or missing named port |
| Service works for one namespace but fails for another | `kubectl -n orders get networkpolicy` | NetworkPolicy allows one caller and blocks another |
| Direct Pod or port-forward works, Service fails | `kubectl -n orders describe svc orders-api` and node Service proxy checks | Service routing layer needs deeper platform investigation |

Production review has the same shape. A good Service change includes the manifest diff, the live Service, EndpointSlice evidence, a caller-namespace smoke test, and a rollback path. The review note can say which Service file changed, what the live selector and port are, how many ready endpoints exist, and whether a caller in `checkout` reached `/healthz`.

Teams usually avoid renaming Services during routine changes. A safer migration creates a new Service beside the old one, moves callers deliberately, checks logs and metrics for remaining old-name traffic, and removes the old Service after the migration is complete. That keeps checkout alive while the contract changes.

## Putting It All Together
<!-- section-summary: A Service is the stable caller contract, while selectors, EndpointSlices, ports, DNS, and readiness keep that contract connected to real Pods. -->

The orders Service gives `checkout-web` one stable way to reach the orders API. The caller uses the Service name and port. The selector finds matching Pods. EndpointSlices show the current backend addresses. The Service port stays stable for callers while `targetPort` maps to the container. DNS gives Pods a name to call. Readiness decides which Pods should receive traffic.

This is the practical shape to remember in production. A Service issue has visible objects behind it: the Service, DNS response from the caller namespace, EndpointSlices, Pod labels, readiness state, and application behavior from logs or port-forwarding. Each piece removes guesswork and turns a vague networking problem into a specific Kubernetes object or application behavior.

![Kubernetes Service debugging path with caller, Service, DNS, EndpointSlice, readiness, and app response evidence](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/service-debugging-summary.png)

*A Service incident needs one small proof at each layer instead of several object changes at once.*

Once Services make one internal backend reachable, the next question is how different Service types expose traffic in different ways.

## What's Next
<!-- section-summary: The next article compares ClusterIP, NodePort, and LoadBalancer so you can choose the right exposure path. -->

The core Service object gives the stable in-cluster name, selector, endpoint discovery, ports, DNS, readiness, and debugging evidence.

The next article compares **ClusterIP**, **NodePort**, and **LoadBalancer**. Those types decide whether a Service stays inside the cluster, opens a port on each node, or asks the platform for an external load balancer.

## References

- [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Defines Services as a network abstraction for groups of Pods, documents selectors, ports, EndpointSlices, and Service types.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Documents labels and selectors, the metadata query system that Services use to choose Pods.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Documents Service DNS names, namespace-qualified lookups, and how normal Services resolve to cluster IPs.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Explains how Kubernetes tracks Service endpoints through EndpointSlice objects and labels them by Service name.
- [Pod lifecycle: readiness probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#readiness-probe) - Explains readiness probes and how failed readiness removes Pod IPs from matching Service EndpointSlices.
- [Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Provides the official Service troubleshooting path for Service existence, DNS, Service IP, definition, EndpointSlices, Pods, and kube-proxy.

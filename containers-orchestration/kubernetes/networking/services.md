---
title: "Services"
description: "Use Kubernetes Services to give changing Pods a stable name, port, and backend discovery point."
overview: "A Service is the stable network contract in front of changing Pods. This article follows a checkout application from Pod IP chaos to Service DNS, selectors, EndpointSlices, readiness, and production debugging."
tags: ["services", "selectors", "endpoints", "dns", "kubectl"]
order: 1
id: article-containers-orchestration-kubernetes-networking-services
---

## Table of Contents

1. [Why Pod IPs Need a Stable Contract](#why-pod-ips-need-a-stable-contract)
2. [The First Service](#the-first-service)
3. [Selectors Choose the Backends](#selectors-choose-the-backends)
4. [EndpointSlices Show the Real Backend List](#endpointslices-show-the-real-backend-list)
5. [Ports Separate the Caller Contract From the Container](#ports-separate-the-caller-contract-from-the-container)
6. [DNS Gives the Service a Name](#dns-gives-the-service-a-name)
7. [Readiness Decides Who Receives Traffic](#readiness-decides-who-receives-traffic)
8. [Debugging a Service in Production](#debugging-a-service-in-production)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Pod IPs Need a Stable Contract
<!-- section-summary: Pods move and get replaced, so callers need a stable Service name instead of a changing list of Pod IPs. -->

Imagine a small shop platform running in Kubernetes. There is a `checkout-web` app that handles the browser flow, and there is a `payments-api` app that talks to the payment provider. The web app needs to call the payments API every time someone pays for an order.

At first, a direct Pod IP can look like an easy answer. You run `kubectl get pods -o wide`, see that one payments Pod has the IP `10.244.2.17`, and wire the web app to call `http://10.244.2.17:8080`. That works for a short demo because one Pod happens to exist at that address right now.

Kubernetes changes that address during normal operations. A Deployment rollout creates new Pods and removes old Pods. A node drain moves Pods away from a node. A failed Pod gets replaced. A scale-up adds more Pods. Each new Pod gets its own IP, and the old IP can disappear. The caller needs a stable way to say, "I want the payments API," while Kubernetes keeps replacing the actual processes behind it.

A **Service** is the Kubernetes object that gives a group of Pods a stable network identity. A Service has a name, a namespace, a virtual IP for normal in-cluster Services, one or more ports, and a rule for finding backend Pods. The caller talks to the Service. Kubernetes tracks the current Pods behind that Service.

![Kubernetes Service stable contract showing checkout-web calling a payments-api Service while EndpointSlices track replaceable ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/service-stable-contract.png)

*The Service is the caller-facing contract. Pod IPs can churn during rollouts or repairs while the name, port, selector, and EndpointSlices keep the backend path stable.*

For the shop platform, `checkout-web` should call a Service name like this:

```bash
http://payments-api.shop.svc.cluster.local
```

That name means the `payments-api` Service in the `shop` namespace. The caller can keep using that name while the payments Deployment rolls from version `2.4.1` to `2.4.2`, scales from two replicas to six, or moves Pods across nodes during maintenance.

So the first job is clear. The payments team needs to publish a stable Service in front of changing Pods.

## The First Service
<!-- section-summary: A basic ClusterIP Service publishes an internal name and port for Pods selected by labels. -->

A **ClusterIP Service** is the default Service type. It gives the Service an internal cluster IP and makes it reachable from inside the cluster. This is the normal starting point for one backend calling another backend, like `checkout-web` calling `payments-api`.

Here is the Deployment behind our example. The important part for this article is the label under `template.metadata.labels`. That label goes onto every Pod created by the Deployment.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: payments-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payments-api
        app.kubernetes.io/component: api
        app.kubernetes.io/part-of: shop-platform
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/payments-api:2.4.1
          ports:
            - name: http
              containerPort: 8080
```

Now here is the Service. It publishes port `80` to callers and sends traffic to the container port named `http`.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments-api
  namespace: shop
  labels:
    app.kubernetes.io/name: payments-api
    app.kubernetes.io/part-of: shop-platform
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: payments-api
    app.kubernetes.io/component: api
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
```

This little manifest creates a real contract. `metadata.name` gives callers the Service name. `metadata.namespace` places that name inside `shop`. `spec.type` keeps the Service internal to the cluster. `spec.selector` chooses the Pods. `spec.ports[].port` tells callers which port to use. `spec.ports[].targetPort` tells Kubernetes where traffic should land on the selected Pods.

In production, teams treat these fields with the same care they give an API route. If `checkout-web` calls `payments-api.shop` on port `80`, a casual rename or port change can break checkout even while every payments Pod looks healthy.

Now the next question is the important one. How does Kubernetes know which Pods belong behind this Service?

## Selectors Choose the Backends
<!-- section-summary: A Service selector is a label query, and a selector typo gives you a Service with no useful backends. -->

A **label** is a key-value pair attached to a Kubernetes object. A **selector** is a query over those labels. In a Service, the selector tells Kubernetes which Pods should receive traffic for that Service.

The payments Service uses this selector:

```yaml
selector:
  app.kubernetes.io/name: payments-api
  app.kubernetes.io/component: api
```

That means a Pod needs both labels to belong behind the Service. The Deployment template puts those labels on every new payments Pod, so the Service can find them.

This is simple, and it is also one of the easiest places to make a production mistake. If the Deployment uses `app.kubernetes.io/name: payment-api` and the Service selector uses `app.kubernetes.io/name: payments-api`, the Service still exists, DNS can still resolve, and the Service still has a cluster IP. It just has no matching Pods. From the caller side, that often looks like a timeout or connection failure.

Here is the first check a team usually runs:

```bash
kubectl -n shop get pods -l app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api --show-labels
```

Healthy output should show the payments Pods and the labels the Service expects:

```bash
NAME                            READY   STATUS    RESTARTS   AGE   LABELS
payments-api-65dc7c9f4d-7sk2c   1/1     Running   0          12m   app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api,app.kubernetes.io/part-of=shop-platform
payments-api-65dc7c9f4d-cb9mh   1/1     Running   0          12m   app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api,app.kubernetes.io/part-of=shop-platform
payments-api-65dc7c9f4d-q6x4z   1/1     Running   0          12m   app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api,app.kubernetes.io/part-of=shop-platform
```

The Service selector only finds Pods in the same namespace as the Service. If the Service lives in `shop` and the Pods live in `payments`, the selector will not cross the namespace boundary. That matters in real clusters because teams often split namespaces by application, environment, or ownership.

Selectors answer which Pods should be used. The next useful object shows which Pod IPs Kubernetes actually selected.

## EndpointSlices Show the Real Backend List
<!-- section-summary: EndpointSlices list the current backend IPs and ports behind a Service, which makes Service state visible during debugging. -->

An **EndpointSlice** is a Kubernetes discovery object that stores a slice of network endpoints for a Service. For a normal selector-based Service, the control plane watches Pods, evaluates the Service selector, and writes the matching backend addresses into EndpointSlices.

This gives operators a very practical view. The Service is the contract that callers use. EndpointSlices are the current backend list behind that contract.

For the payments Service, this command shows the selected backend addresses:

```bash
kubectl -n shop get endpointslices -l kubernetes.io/service-name=payments-api -o wide
```

Typical output looks like this:

```bash
NAME                  ADDRESSTYPE   PORTS   ENDPOINTS
payments-api-p8mq9    IPv4          8080    10.244.1.32,10.244.2.18,10.244.3.44
```

That output tells a very concrete story. The Service named `payments-api` has backend endpoints on port `8080`, and Kubernetes currently sees three Pod IPs behind it. If the `ENDPOINTS` column is empty, the selector did not find ready backends, or every selected backend is currently excluded from traffic.

![Service selector and EndpointSlice flow showing Pod labels, readiness, selected endpoints, and unready Pods left out of traffic](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/selector-endpointslice-flow.png)

*Selectors decide which Pods belong behind the Service, and readiness decides which selected Pods should actually receive traffic.*

EndpointSlices also matter as Services grow. Kubernetes can create multiple EndpointSlice objects for one Service instead of forcing every backend into one giant object. The lookup label `kubernetes.io/service-name=payments-api` is the normal way to gather all the slices that belong to the Service.

Now we know how the Service finds Pods. The next piece is where traffic enters the Service and where it lands inside each Pod.

## Ports Separate the Caller Contract From the Container
<!-- section-summary: The Service port belongs to callers, while targetPort points to the backend Pod port. -->

A Service usually has two port ideas. The **Service port** is the port callers use on the Service. The **target port** is the port Kubernetes sends traffic to on the backend Pods.

In our manifest, callers use port `80`:

```yaml
ports:
  - name: http
    protocol: TCP
    port: 80
    targetPort: http
```

The target port is `http`, and the Deployment says that the container port named `http` is `8080`:

```yaml
ports:
  - name: http
    containerPort: 8080
```

So the path is: `checkout-web` calls `payments-api.shop:80`, the Service chooses one ready backend, and Kubernetes sends the request to port `8080` on a payments Pod.

Named target ports are useful during rollouts. Imagine the payments team moves the application from port `8080` to port `9090` in version `2.5.0`. If every Pod still exposes a port named `http`, the Service can keep `targetPort: http` while old and new Pods overlap during the rollout.

```yaml
containers:
  - name: api
    image: ghcr.io/devpolaris/payments-api:2.5.0
    ports:
      - name: http
        containerPort: 9090
```

That gives the application team room to change the container implementation while the caller-facing Service contract stays stable. The web app still calls the same Service name and port.

When a Service fails, this port split deserves a careful check. A common mistake is `port: 80` with `targetPort: 3000` while the application actually listens on `8080`. Another common mistake is `targetPort: http` while the Pods expose a port named `web`. Kubernetes cannot route to the port you meant in your head; it routes to the number or name in the manifest.

With selector and ports in place, the caller still needs a clean way to find the Service. That is where Kubernetes DNS enters the story.

## DNS Gives the Service a Name
<!-- section-summary: Kubernetes DNS lets Pods call Services by stable names, and namespace-qualified names prevent cross-namespace confusion. -->

Kubernetes creates DNS records for Services. That means a Pod can call a Service by name instead of hardcoding the Service cluster IP.

For our example, a Pod inside the `shop` namespace can usually call the short name:

```bash
wget -qO- http://payments-api/healthz
```

A Pod in another namespace should use the namespace-qualified name:

```bash
wget -qO- http://payments-api.shop/healthz
```

The fully qualified name is useful in runbooks and incident notes:

```bash
wget -qO- http://payments-api.shop.svc.cluster.local/healthz
```

The namespace piece matters. If `checkout-web` runs in the `frontend` namespace and calls `http://payments-api/healthz`, Kubernetes DNS will first look for a Service named `payments-api` in `frontend`. If the real Service lives in `shop`, the caller should use `payments-api.shop` or the full name.

Here is a practical DNS check from the caller namespace:

```bash
kubectl -n frontend run service-dns-check --rm -it --restart=Never --image=busybox:1.36 -- \
  nslookup payments-api.shop.svc.cluster.local
```

The response should resolve to the Service's cluster IP for a normal ClusterIP Service:

```bash
Name:      payments-api.shop.svc.cluster.local
Address:   10.96.41.23
```

DNS gives the caller a stable name. Selectors and EndpointSlices give Kubernetes a backend list. There is one more traffic decision before a Pod should receive requests: readiness.

## Readiness Decides Who Receives Traffic
<!-- section-summary: Readiness probes keep Pods out of Service traffic until the application can actually handle requests. -->

A **readiness probe** tells Kubernetes whether a container is ready to receive traffic. This matters because a process can be running while the application still cannot serve useful requests. It might be loading configuration, opening a database connection, warming caches, or waiting for a dependency.

Here is a readiness probe for the payments API:

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

This is why Services and rollouts fit together. During a rollout, Kubernetes creates a new payments Pod, waits for readiness, adds it to the backend list, and then continues replacing old Pods according to the Deployment strategy. `checkout-web` keeps using the Service name while the backend membership changes.

The ready condition is visible in EndpointSlices:

```bash
kubectl -n shop get endpointslices \
  -l kubernetes.io/service-name=payments-api \
  -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{" ready="}{.conditions.ready}{"\n"}{end}'
```

Healthy output should look like this:

```bash
10.244.1.32 ready=true
10.244.2.18 ready=true
10.244.3.44 ready=true
```

If every endpoint shows `ready=false`, the Service can exist, DNS can resolve, and callers can still fail because no backend is ready to accept traffic. The next checks are the readiness events and logs:

```bash
kubectl -n shop describe pod -l app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api
kubectl -n shop logs deployment/payments-api --tail=100
```

The readiness endpoint should describe whether the application can serve requests, not just whether the process is alive. For a payments API, `/readyz` might check that required configuration is loaded and the payment provider client can be initialized. Teams often keep deeper dependency checks lightweight because a slow or flaky readiness endpoint can remove healthy Pods from traffic.

Now we have all the main pieces. The final job is to use them in a repeatable debugging flow.

## Debugging a Service in Production
<!-- section-summary: Service debugging works best when you move from caller evidence to DNS, Service definition, EndpointSlices, Pods, and application behavior. -->

Service incidents usually arrive as simple symptoms. Checkout fails. A frontend returns `502`. A worker says `connection refused`. The useful response is to follow the Service path one step at a time.

The first useful evidence is the Service object:

```bash
kubectl -n shop get svc payments-api -o wide
kubectl -n shop describe svc payments-api
```

The output should show the expected type, cluster IP, Service port, target port, and selector:

```bash
NAME           TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
payments-api   ClusterIP   10.96.41.23   <none>        80/TCP    18m   app.kubernetes.io/component=api,app.kubernetes.io/name=payments-api
```

The next useful evidence comes from the caller namespace, because DNS search paths and NetworkPolicies depend on where the caller runs:

```bash
kubectl -n frontend run payments-smoke --rm -it --restart=Never --image=busybox:1.36 -- \
  wget -qO- http://payments-api.shop/healthz
```

A name lookup failure points the investigation toward a full-name DNS check:

```bash
kubectl -n frontend run payments-dns --rm -it --restart=Never --image=busybox:1.36 -- \
  nslookup payments-api.shop.svc.cluster.local
```

When DNS works, EndpointSlices show whether the Service has usable backends:

```bash
kubectl -n shop get endpointslices -l kubernetes.io/service-name=payments-api -o wide
```

Empty EndpointSlices move attention to labels and readiness:

```bash
kubectl -n shop get pods --show-labels
kubectl -n shop get pods -l app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api
kubectl -n shop describe pod -l app.kubernetes.io/name=payments-api,app.kubernetes.io/component=api
```

EndpointSlices with backends move the next question to the application path. A port-forward to the Deployment lets the team call the backend directly through a local tunnel:

```bash
kubectl -n shop port-forward deployment/payments-api 8080:8080
curl -i http://127.0.0.1:8080/healthz
```

This gives a clean split. If the port-forwarded application fails, the problem is inside the Pod or application. If the port-forwarded application works and the Service path fails, the issue sits in the Service definition, target port, DNS, NetworkPolicy, node Service implementation, or something between caller and backend.

Here is a compact review table for the common cases:

| Symptom | First useful check | Common cause |
|---|---|---|
| Caller gets `Name or service not known` | `nslookup payments-api.shop.svc.cluster.local` from the caller namespace | Wrong Service name, missing namespace, or DNS problem |
| DNS resolves but requests time out | `kubectl -n shop get endpointslices -l kubernetes.io/service-name=payments-api -o wide` | No ready endpoints, blocked traffic, or wrong backend port |
| EndpointSlices are empty | `kubectl -n shop get pods --show-labels` | Selector does not match Pod labels or Pods are in another namespace |
| EndpointSlices show the wrong port | `kubectl -n shop get svc payments-api -o yaml` | `targetPort` points to the wrong number or missing named port |
| Service works for one namespace but fails for another | `kubectl -n shop get networkpolicy` | NetworkPolicy allows one caller and blocks another |
| Direct Pod or port-forward works, Service fails | `kubectl -n shop describe svc payments-api` and node Service proxy checks | Service routing layer needs deeper platform investigation |

Production review has the same shape. A good Service change includes the manifest diff, the live Service, EndpointSlice evidence, a caller-namespace smoke test, and a rollback path.

```bash
kubectl diff -f k8s/payments-api-service.yaml
kubectl apply -f k8s/payments-api-service.yaml
kubectl -n shop get svc payments-api -o wide
kubectl -n shop get endpointslices -l kubernetes.io/service-name=payments-api -o wide
kubectl -n frontend run payments-contract --rm -it --restart=Never --image=busybox:1.36 -- \
  wget -qO- http://payments-api.shop/healthz
```

Teams usually avoid renaming Services during routine changes. A safer migration creates a new Service beside the old one, moves callers deliberately, checks logs and metrics for remaining old-name traffic, and removes the old Service after the migration is complete. That keeps checkout alive while the contract changes.

## Putting It All Together
<!-- section-summary: A Service is the stable caller contract, while selectors, EndpointSlices, ports, DNS, and readiness keep that contract connected to real Pods. -->

The payments Service gives `checkout-web` one stable way to reach the payments API. The caller uses the Service name and port. The selector finds matching Pods. EndpointSlices show the current backend addresses. The Service port stays stable for callers while `targetPort` maps to the container. DNS gives Pods a name to call. Readiness decides which Pods should receive traffic.

This is the practical shape to remember in production. A Service issue has visible objects behind it: the Service, DNS response from the caller namespace, EndpointSlices, Pod labels, readiness state, and application behavior from logs or port-forwarding. Each piece removes guesswork and turns a vague networking problem into a specific Kubernetes object or application behavior.

![Kubernetes Service debugging path with caller, Service, DNS, EndpointSlice, readiness, and app response evidence](/content-assets/articles/article-containers-orchestration-kubernetes-networking-services/service-debugging-summary.png)

*A Service incident becomes easier to debug when the team collects one small proof at each layer instead of changing several objects at once.*

Once Services make one internal backend reachable, the next question is how different Service types expose traffic in different ways.

## What's Next
<!-- section-summary: The next article compares ClusterIP, NodePort, and LoadBalancer so you can choose the right exposure path. -->

This article focused on the core Service object: stable in-cluster name, selector, endpoint discovery, ports, DNS, readiness, and debugging.

The next article compares **ClusterIP**, **NodePort**, and **LoadBalancer**. Those types decide whether a Service stays inside the cluster, opens a port on each node, or asks the platform for an external load balancer.

---

**References**

- [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Defines Services as a network abstraction for groups of Pods, documents selectors, ports, EndpointSlices, and Service types.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Documents labels and selectors, the metadata query system that Services use to choose Pods.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Documents Service DNS names, namespace-qualified lookups, and how normal Services resolve to cluster IPs.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Explains how Kubernetes tracks Service endpoints through EndpointSlice objects and labels them by Service name.
- [Pod lifecycle: readiness probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#readiness-probe) - Explains readiness probes and how failed readiness removes Pod IPs from matching Service EndpointSlices.
- [Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Provides the official Service troubleshooting path for Service existence, DNS, Service IP, definition, EndpointSlices, Pods, and kube-proxy.

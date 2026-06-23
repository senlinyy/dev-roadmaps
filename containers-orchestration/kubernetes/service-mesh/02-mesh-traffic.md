---
title: "Mesh Traffic"
description: "Route an online store checkout service with canary traffic, waiting limits, safe retry behavior, and overloaded-service protection."
overview: "Follow one checkout migration from v1 to v2, using Istio traffic resources to split requests, verify that proxies received the rule, protect slow calls, and roll back safely."
tags: ["kubernetes", "service-mesh", "routing", "circuit-breaker", "canary"]
order: 2
id: article-containers-orchestration-kubernetes-service-mesh-mesh-traffic
---

## Table of Contents

1. [Where Mesh Traffic Control Fits](#where-mesh-traffic-control-fits)
2. [The Checkout Rollout We Will Use](#the-checkout-rollout-we-will-use)
3. [Route Rules, Subsets, VirtualServices, and DestinationRules](#route-rules-subsets-virtualservices-and-destinationrules)
4. [Start With A Small Canary](#start-with-a-small-canary)
5. [Verify What The Proxies Received](#verify-what-the-proxies-received)
6. [Add Timeout And Retry Protection](#add-timeout-and-retry-protection)
7. [Add Circuit Breaking For Inventory Trouble](#add-circuit-breaking-for-inventory-trouble)
8. [Rollback And Common Gotchas](#rollback-and-common-gotchas)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Where Mesh Traffic Control Fits
<!-- section-summary: Mesh traffic control lets the platform change request routing and failure behavior without asking every service team to rewrite application code. -->

With Istio's Envoy proxies on the request path, the store can control traffic without changing the `web` application code. In the checkout rollout, `web` still calls the normal `checkout` service name, and Envoy uses Istio's rules to decide which real workload receives each request.

**Mesh traffic control** is the set of rules that tells those proxies how to route requests, how long to wait for slow calls, whether a failed call gets a bounded second attempt, and when to stop sending traffic to unhealthy backends. For the online store, this is the layer that lets the team send a small slice of checkout traffic to `v2`, cap slow calls, and protect the rest of the store if inventory starts failing during a warehouse sync.

In Istio, these rules usually live in **Kubernetes custom resources**. A custom resource is an extra Kubernetes API type installed by a project like Istio, so the cluster can store Istio traffic objects alongside normal workload and networking objects. Two of those traffic objects show up throughout this article: a **VirtualService**, which holds routing choices for a host, and a **DestinationRule**, which names destination versions and policies after a route chooses a service. The workflow is straightforward: write YAML, apply it with **`kubectl`**, and inspect Istio's view with **`istioctl`**, the Istio command-line tool. That distinction matters during the checkout rollout because `kubectl` tells you whether Kubernetes accepted the desired config, while `istioctl` helps you check whether Istio translated that config for the proxies.

This is useful in production because releases rarely move in one perfect step. A team may want to send 5 percent of traffic to a new version, watch errors and latency, increase the percentage, and roll back in minutes if the new version misbehaves. A team may also want clear limits around slow dependencies so one bad service does not keep every caller waiting.

The practical result is that **traffic control gives you a release and reliability layer between services**. Your code still needs good error handling, metrics, and tests, because the mesh cannot understand every business rule inside your application. The mesh handles network-level behavior that is common across many services, so each team does not have to rebuild the same routing and protection logic from scratch.

## The Checkout Rollout We Will Use
<!-- section-summary: One online store scenario connects every part of the article: a checkout v2 canary, timeout and retry protection, and circuit breaking when inventory has trouble. -->

We will use one connected scenario for the whole article. An online store has a `web` frontend, a `checkout` service, a `payments` service, and an `inventory` service. Customers browse in `web`, submit their cart to `checkout`, and then `checkout` checks stock with `inventory` before asking `payments` to charge the card.

The team has a stable `checkout` version called `v1`. They have also built `checkout` `v2`, which improves tax calculation and changes part of the order validation flow. The team wants to move from `v1` to `v2` carefully. First, they run a **canary**, which means a small amount of real traffic goes to `v2` while most customers still use `v1`. Then they add a **timeout**, a clear waiting limit for slow calls, and a **retry**, a bounded second chance for temporary failures, so customer requests do not hang forever. Finally, they add a **circuit breaker**, a protection rule that limits pressure on an unhealthy dependency, for calls from `checkout` to `inventory`, because inventory sometimes has latency spikes during warehouse sync jobs.

For this rollout, both versions sit behind the same Service named `checkout`. The Pods need version labels so Istio can tell them apart. The snippet below is trimmed to the labels and Service selector that matter for traffic routing, so focus on `app: checkout` and `version: v1` or `version: v2`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-v1
  namespace: store
spec:
  template:
    metadata:
      labels:
        app: checkout
        version: v1
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-v2
  namespace: store
spec:
  template:
    metadata:
      labels:
        app: checkout
        version: v2
---
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: store
spec:
  selector:
    app: checkout
  ports:
  - name: http
    port: 80
    targetPort: 8080
```

The existing Service contract gives callers one stable name: `checkout`. The version labels give Istio a way to split that stable name into `v1` and `v2` targets. Real teams usually make sure the Service port name starts with the protocol, such as `http`, because Istio uses the declared protocol, or automatic **protocol detection**, to decide how much it can understand about each request. Protocol detection means Istio tries to identify whether the traffic is HTTP, gRPC, raw TCP, or another supported protocol from the Service configuration and the connection it sees.

**Layer 7** means the application layer of the network conversation, where HTTP paths, methods, headers, and gRPC calls live. When Istio recognizes checkout traffic as HTTP or gRPC, Envoy can apply Layer 7 rules such as "send requests with this header to `v2`" or "retry this HTTP failure once." If Istio only treats the same port as opaque TCP, Envoy can still forward bytes to `checkout`, but it cannot make decisions based on `/api/health`, request headers, or HTTP status codes. That small port naming detail saves a lot of confusion when the route YAML appears correct and the canary still does not behave like an HTTP-aware rollout.

## Route Rules, Subsets, VirtualServices, and DestinationRules
<!-- section-summary: DestinationRule names the backend subsets, while VirtualService tells proxies which subset should receive each matching request. -->

Before the YAML, it helps to name the four core terms. A **subset** is a named group of endpoints inside one service. For our online store, the `checkout` service has a `v1` subset for Pods labeled `version: v1` and a `v2` subset for Pods labeled `version: v2`. The subset name is the release label you want traffic rules to target.

A **route rule** is an instruction that matches a request and chooses where that request should go. A route rule can match all requests, or it can match only certain paths, headers, ports, methods, or other request details. In our first rollout, every request to `checkout` is eligible, and the proxy splits those requests by weight.

A **VirtualService** is the Istio resource that holds route rules for a host. In plain English, it says, "When a caller asks for `checkout`, use these rules to choose a destination." A VirtualService is where you usually express canary weights, header-based routing, timeouts, and retries.

A **DestinationRule** is the Istio resource that describes what happens after a route has chosen a service. It defines named subsets and traffic policies for the destination, such as load balancing, connection pool limits that cap open or waiting work, and outlier detection that temporarily avoids unhealthy backends. In plain English, it says, "Here are the real versions of `checkout`, and here are the policies that apply when traffic reaches them."

The relationship is important. The **DestinationRule defines the menu of available subsets**, and the **VirtualService chooses from that menu**. If a VirtualService routes to a subset that the DestinationRule never defined, the proxy cannot reliably send traffic where you intended. If a DestinationRule defines a subset that no route ever uses, that subset policy sits there without affecting normal traffic.

## Start With A Small Canary
<!-- section-summary: A canary sends a small percentage of real traffic to a new version so the team can watch behavior before a full rollout. -->

A **canary** is a release pattern where a small slice of real traffic goes to a new version first. The name comes from the old warning-system idea, but in software the practical meaning is that the team exposes `v2` to a small percentage of requests, watches the signals, and increases the percentage only after the service behaves well.

For checkout, start with 95 percent of requests going to `v1` and 5 percent going to `v2`. That gives `v2` enough traffic to prove basic behavior while keeping the customer impact small if it returns errors or adds latency. In a larger store, the team might start at 1 percent. In a small test environment, 5 or 10 percent makes the split easier to see.

The first real traffic file can be named `checkout-traffic.yaml`. It contains both resources because the route and the subsets have to move together:

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: checkout-destination
  namespace: store
spec:
  host: checkout
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout-route
  namespace: store
spec:
  hosts:
  - checkout
  http:
  - name: checkout-canary
    route:
    - destination:
        host: checkout
        subset: v1
      weight: 95
    - destination:
        host: checkout
        subset: v2
      weight: 5
```

Apply the file with `kubectl`. In a GitOps environment, this same YAML would normally go through a pull request and controller, but the direct command keeps the learning loop short:

```bash
kubectl apply -f checkout-traffic.yaml
```

Then send repeated requests from a meshed client. This example uses a `web` Deployment with an application container named `app` that can call `checkout` over the in-cluster service name:

```bash
kubectl exec -n store deploy/web -c app -- sh -c 'for i in $(seq 1 60); do curl -s http://checkout/api/health; echo; sleep 0.2; done'
```

A small sample might include mostly `v1` responses with an occasional `v2` response:

```json
{"service":"checkout","version":"v1","status":"ok"}
{"service":"checkout","version":"v1","status":"ok"}
{"service":"checkout","version":"v1","status":"ok"}
{"service":"checkout","version":"v2","status":"ok"}
{"service":"checkout","version":"v1","status":"ok"}
```

Small samples rarely land at exactly 57 `v1` responses and 3 `v2` responses from 60 calls. Weighted routing is probabilistic over request flow, and small samples bounce around. In production, teams check request counters, error rates, latency percentiles, and customer-impact metrics over enough traffic to make the decision meaningful.

![Checkout canary split infographic showing web calling the checkout Service, a VirtualService sending 95 percent to v1 and 5 percent to v2, and a DestinationRule defining version subsets](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/checkout-canary-split.png)

*The caller still uses the stable `checkout` Service name, while the proxy applies the weighted route to versioned subsets behind that Service.*

When `v2` behaves well, move gradually. A common production path is 5 percent, 10 percent, 25 percent, 50 percent, and then 100 percent. Each move should have a short observation window and a clear rollback threshold, such as "roll back if checkout 5xx rate doubles for five minutes" or "roll back if p95 checkout latency stays above 800 ms."

## Verify What The Proxies Received
<!-- section-summary: After applying traffic rules, verify control-plane sync and inspect the route config that Envoy actually loaded. -->

At this point, we need one more definition: **control-plane sync**. In Istio, the control plane watches Kubernetes and Istio resources, translates them into Envoy proxy configuration, and sends that configuration to the data-plane proxies. **Control-plane sync** means the proxies have received and accepted the current config from Istio. The YAML stored in Kubernetes records the desired state; the checkout rollout only affects real traffic after the relevant Envoy proxies load the generated config.

`istioctl` is the tool we use for that second question. `kubectl apply` can tell you that Kubernetes accepted `checkout-traffic.yaml`, but `istioctl proxy-status` asks Istio and the proxies whether the current generated config has reached the data plane. That matters in a canary because a stale `web` proxy could keep sending traffic with the old weights even after the YAML has changed.

The first check is `istioctl proxy-status`, which asks whether the proxies report synced configuration:

```bash
istioctl proxy-status
```

Healthy output should show `SYNCED` for the main config types on the relevant workloads. The exact Pod names will differ in your cluster:

```bash
NAME                                      CDS      LDS      EDS      RDS      ISTIOD                     VERSION
web-6f7769c6f5-f7x8p.store               SYNCED   SYNCED   SYNCED   SYNCED   istiod-7c9d8b9f6b-8m9qn    1.30.1
checkout-v1-7d9f6b8c9f-k2h5m.store       SYNCED   SYNCED   SYNCED   SYNCED   istiod-7c9d8b9f6b-8m9qn    1.30.1
checkout-v2-64f8d779c8-p6n2r.store       SYNCED   SYNCED   SYNCED   SYNCED   istiod-7c9d8b9f6b-8m9qn    1.30.1
```

The columns are short names for Envoy config areas. `CDS` is cluster discovery, `LDS` is listener discovery, `EDS` is endpoint discovery, and `RDS` is route discovery. For this article, the simple reading is enough: if the client proxy that sends traffic to checkout has `RDS` synced, it should have the route rule.

Those names also map to the Envoy objects you will inspect when a rollout looks wrong. **Envoy route config** is the HTTP decision table, so it should contain the weighted route from `web` to `checkout` `v1` and `v2`. **Envoy cluster config** describes an upstream service target, such as `inventory.store.svc.cluster.local`, plus policies like connection limits. **Envoy endpoint config** is the list of actual Pod IPs behind that cluster. In the checkout story, route config answers "which version should receive the request," cluster config answers "what policy applies to the selected service," and endpoint config answers "which concrete Pods are available."

Next, inspect the route configuration on the client side. Traffic from `web` to `checkout` is decided by the `web` proxy before the request leaves the `web` Pod, so inspect a `web` proxy:

```bash
WEB_POD=$(kubectl get pod -n store -l app=web -o jsonpath='{.items[0].metadata.name}')
istioctl proxy-config routes "$WEB_POD" -n store --name 80 -o json | grep -A 25 '"name": "checkout'
```

If your service port is different, change `--name 80` to the route name that matches your listener. The exact JSON is verbose, but you are looking for the virtual host or route that points to `checkout` and includes weighted clusters for `v1` and `v2`.

For a cleaner view, many teams use **`jq`** locally. `jq` is a command-line JSON filter, and it matters here because Envoy config output is large JSON that is hard to scan by eye. During the checkout rollout, `jq` lets you pull out just the weighted cluster block so you can see whether the proxy has the 95/5 split you expected:

```bash
istioctl proxy-config routes "$WEB_POD" -n store --name 80 -o json \
  | jq '.. | objects | select(.weightedClusters? != null) | .weightedClusters'
```

This check catches a practical class of mistakes. If `kubectl apply` succeeded but the proxy still shows the old route, look for stale proxies, bad namespace assumptions, wrong host names, or analyzer warnings. This gives you a better first move than blaming the application, because the fastest fix may be a route config correction rather than a code deploy.

## Add Timeout And Retry Protection
<!-- section-summary: Timeouts put a clear upper bound on waiting, while retries give short transient failures a limited second chance. -->

The canary is running, so now protect customer requests from slow calls. A **timeout** is the maximum amount of time the proxy waits for a response before failing the request. For checkout, a timeout keeps a cart submission from hanging while a dependency is slow. The right value depends on the user experience and the service-level objective. A checkout page may tolerate a couple of seconds; a background reconciliation job may tolerate much longer.

A **retry** is a limited second chance after a request fails for a retryable reason. Retries help when a temporary network blip or a momentarily overloaded Pod causes a failure. They can also make an outage worse if you retry too much, because every original request can turn into several upstream requests. That is why retries need small attempt counts, per-try timeouts, and clear retry conditions.

**Idempotency** means a request can be repeated without creating a duplicate business action. A checkout health check or inventory lookup is usually safe to retry because the repeated request only reads state. A purchase submission is different: retrying it blindly could reserve stock twice or charge twice unless the application uses an idempotency key, which is a unique request ID the backend uses to recognize a repeated attempt. This is why mesh retry policy and application design have to agree during a checkout rollout.

For the checkout canary, add a 2 second total route timeout and up to 2 retry attempts, with each try capped at 600 ms. The maximum number of upstream calls can be the first call plus the retry attempts, so `attempts: 2` means up to 3 tries total when the timeout budget allows it.

Update the VirtualService portion of `checkout-traffic.yaml`:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout-route
  namespace: store
spec:
  hosts:
  - checkout
  http:
  - name: checkout-canary
    timeout: 2s
    retries:
      attempts: 2
      perTryTimeout: 600ms
      retryOn: gateway-error,connect-failure,refused-stream,reset
    route:
    - destination:
        host: checkout
        subset: v1
      weight: 95
    - destination:
        host: checkout
        subset: v2
      weight: 5
```

Apply the file again:

```bash
kubectl apply -f checkout-traffic.yaml
```

Then verify from the client side:

```bash
kubectl exec -n store deploy/web -c app -- sh -c 'for i in $(seq 1 20); do curl -s -w " status=%{http_code} time=%{time_total}\n" http://checkout/api/health; done'
```

That command prints each response body plus the HTTP status and total time from `curl`. In a real rollout, the better verification path is metrics: request rate, 5xx rate, retry count, timeout count, p95 and p99 latency, and business metrics such as checkout completion rate. The command is still useful in a learning cluster because it shows whether requests return quickly instead of hanging forever.

Also inspect the proxy route after the update:

```bash
istioctl proxy-config routes "$WEB_POD" -n store --name 80 -o json \
  | jq '.. | objects | select(.timeout? != null or .retryPolicy? != null) | {timeout, retryPolicy}'
```

Two gotchas matter here. First, application timeouts and mesh timeouts both run independently. If the checkout client code gives up after 1 second, a 2 second mesh timeout will not help that caller wait longer. Second, retries should be safer for idempotent reads than for operations that can create duplicate side effects. Checkout is sensitive, so teams usually retry carefully around health checks, reads, or calls with idempotency keys rather than blindly retrying every purchase submission.

## Add Circuit Breaking For Inventory Trouble
<!-- section-summary: Circuit breaking limits pressure on unhealthy inventory hosts so failures fail fast instead of spreading through checkout. -->

Now the canary has routing, timeout, and retry protection. The next problem sits one hop away. `checkout` calls `inventory` to reserve stock, and inventory sometimes slows down during a warehouse sync. If every checkout Pod keeps opening connections and waiting on the same unhealthy inventory Pods, checkout latency climbs, customer requests pile up, and payments may receive fewer successful orders.

A **circuit breaker** is a protection rule that limits calls to an upstream host when it is overloaded or repeatedly failing. An upstream host is one backend instance the proxy might call, such as one `inventory` Pod behind the `inventory` Service. In Istio, circuit breaking is configured in a DestinationRule because it applies to the real destination after routing has selected the service. For checkout, the goal is to fail quickly when inventory is unhealthy instead of letting every checkout request sit and wait on the same slow dependency.

The **connection pool** is the set of open or waiting connections and requests Envoy manages for a destination. Limits such as `maxConnections`, `http1MaxPendingRequests`, and `http2MaxRequests` put a ceiling on how much pressure checkout can send toward inventory at one time. That ceiling matters during warehouse sync spikes because bounded waiting gives checkout a chance to return a controlled error or fallback instead of filling every worker with stuck inventory calls.

**Outlier detection** is the part of circuit breaking that watches individual upstream hosts and temporarily ejects unhealthy ones from the load-balancing pool. For HTTP services, repeated 5xx responses can mark a host as an outlier. For TCP-like failures, connection failures and timeouts can count too. The ejection is temporary, so a host can return to the pool after the configured time. In the online store, that means one bad inventory Pod can be avoided for a short window while the other inventory Pods keep serving checkout traffic.

![Timeout retry and circuit breaker infographic showing checkout Envoy using timeout and retry limits while inventory is protected by connection pool limits and outlier detection](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/timeout-retry-circuit-breaker.png)

*Timeouts and retries limit how long checkout waits, while circuit breaking limits how much pressure checkout can send toward unhealthy inventory Pods.*

For inventory, create a DestinationRule that keeps connection pressure bounded and ejects a host that keeps returning 5xx errors:

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: inventory-protection
  namespace: store
spec:
  host: inventory
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 50
        connectTimeout: 200ms
      http:
        http1MaxPendingRequests: 100
        http2MaxRequests: 500
        maxRequestsPerConnection: 20
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 2m
      maxEjectionPercent: 50
```

Apply the inventory rule the same way you applied the checkout route:

```bash
kubectl apply -f inventory-protection.yaml
```

The values here are intentionally understandable starting points for this scenario. In production, teams tune them from real traffic. A small service with 3 inventory Pods needs different thresholds from a large service with 80 Pods. If `maxEjectionPercent` is too high, the proxy may eject too many hosts and leave too little capacity. If `consecutive5xxErrors` is too low, one short application bug can eject hosts aggressively. If connection limits are too low, healthy traffic can get rejected during normal peaks.

Verify the policy in two ways. First, make sure Istio accepts the config. **`istioctl analyze`** is Istio's configuration checker; it reads live cluster resources or local YAML and reports problems such as missing hosts, unreachable route rules, and namespace issues. For the checkout rollout, it gives you a fast check before you blame application code for a traffic policy that Istio can already see is inconsistent:

```bash
istioctl analyze --namespace store
```

Second, inspect the Envoy cluster config from a checkout Pod, because checkout is the caller that sends traffic to inventory:

```bash
CHECKOUT_POD=$(kubectl get pod -n store -l app=checkout,version=v2 -o jsonpath='{.items[0].metadata.name}')
istioctl proxy-config clusters "$CHECKOUT_POD" -n store --fqdn inventory.store.svc.cluster.local -o json \
  | jq '.[0] | {circuitBreakers, outlierDetection}'
```

For another namespace, replace `inventory.store.svc.cluster.local` with the correct fully qualified service name. You can also look at endpoints and outlier status during a test:

```bash
istioctl proxy-config endpoints "$CHECKOUT_POD" -n store \
  --cluster "outbound|80||inventory.store.svc.cluster.local"
```

This is where mesh traffic control turns into operations work. YAML records the request; proxy config and runtime behavior tell you whether that request turned into real protection for callers.

## Rollback And Common Gotchas
<!-- section-summary: A good traffic rule includes a rollback path, verification steps, and awareness of common mistakes before production traffic depends on it. -->

A rollout without a rollback path is unfinished. The quickest rollback for the checkout canary is to send 100 percent of traffic back to `v1` and leave the subsets in place. This keeps the resource shape stable while removing customer traffic from `v2`.

The rollback VirtualService keeps the same route name and shifts the weights back to `v1`:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout-route
  namespace: store
spec:
  hosts:
  - checkout
  http:
  - name: checkout-canary
    timeout: 2s
    retries:
      attempts: 2
      perTryTimeout: 600ms
      retryOn: gateway-error,connect-failure,refused-stream,reset
    route:
    - destination:
        host: checkout
        subset: v1
      weight: 100
    - destination:
        host: checkout
        subset: v2
      weight: 0
```

Apply the rollback config and then verify that the proxies sync the update:

```bash
kubectl apply -f checkout-rollback-v1.yaml
```

If you need an emergency command and the rollback file is committed, use:

```bash
kubectl apply -f checkout-rollback-v1.yaml && istioctl proxy-status
```

Then run the same looped curl check:

```bash
kubectl exec -n store deploy/web -c app -- sh -c 'for i in $(seq 1 30); do curl -s http://checkout/api/health; echo; done'
```

Every successful response should come from `v1`. If you still see `v2`, check whether the request is coming from a different namespace, a different host name, a gateway route, or a client that is outside the mesh. Also remember that already-open connections and in-flight requests may finish under the previous behavior for a short time.

Here are the common gotchas worth checking before production:

| Gotcha | What happens | How to check |
|---|---|---|
| Pod labels miss the subset labels | Traffic to a subset has no healthy endpoints | `kubectl get pods -l app=checkout --show-labels` |
| VirtualService and DestinationRule hosts point at different names | The route and subset policy may apply to different destinations | `kubectl get virtualservice,destinationrule -o yaml` |
| The client is outside the mesh | The sidecar route rule never runs for that caller | `kubectl get pod WEB_POD -o jsonpath='{.spec.containers[*].name}'` |
| Service port naming misses HTTP | Layer 7 routing features may not apply as expected | `kubectl get svc checkout -o yaml` |
| Retries are too broad for checkout writes | A failed purchase request may be attempted more than intended | Check idempotency keys and application retry logic |
| Circuit breaker thresholds are copied from a demo | Healthy production traffic can be rejected or ejected | Compare limits with real request rate and concurrency |

One more practical habit helps a lot: run `istioctl analyze` before and after the change. It can catch configuration problems such as missing hosts, unreachable rules, and namespace issues before you spend an hour debugging the application layer.

```bash
istioctl analyze --all-namespaces
```

## Putting It All Together
<!-- section-summary: Traffic control is a sequence: name the versions, route a small canary, verify proxy sync, add failure limits, and keep rollback ready. -->

Let's connect the whole checkout story in the order a team would actually use it.

First, the team labels the `checkout` Pods with `version: v1` and `version: v2`. Those labels create the raw material for **subsets**. Without accurate labels, the mesh has no clean way to distinguish the old checkout code from the new checkout code.

Second, the team creates a **DestinationRule** for `checkout`. That DestinationRule names the `v1` and `v2` subsets. It gives the mesh a stable vocabulary for the versions behind one Kubernetes Service.

Third, the team creates a **VirtualService** for `checkout`. That VirtualService contains the **route rule** that sends 95 percent of traffic to `v1` and 5 percent to `v2`. This is the **canary** step. The web application still calls `http://checkout`, and the proxy handles the split.

Fourth, the team verifies **control-plane sync**. `kubectl apply` shows that Kubernetes accepted the YAML. `istioctl proxy-status` shows whether the proxies are synced. `istioctl proxy-config routes` shows whether the client proxy actually has the weighted route.

Fifth, the team adds a **timeout** and **retry** policy in the VirtualService. The timeout gives each checkout request a clear waiting limit. The retry gives short transient failures a bounded second chance. The team checks application timeouts and idempotency so the mesh policy supports the code instead of fighting it.

Sixth, the team protects `inventory` with a DestinationRule that uses connection pool limits and **outlier detection**. That is the **circuit breaker** part. When inventory has trouble, the proxies can fail faster and temporarily avoid unhealthy hosts instead of sending every checkout request into the same slow path.

Finally, the team keeps rollback ready. A 100/0 route back to `v1` is simple, fast, and easy to verify. In production, the rollback file belongs in version control next to the rollout file, and dashboards should make it obvious whether the rollback worked.

![Mesh traffic rollout runbook infographic showing labels, subsets, canary route, proxy sync verification, metrics, protections, and rollback to 100 percent v1](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-traffic/traffic-rollout-runbook.png)

*Traffic work stays safe when routing, verification, protection, and rollback move together instead of becoming separate one-off changes.*

That is the shape of mesh traffic work: **route intentionally, verify what the proxies loaded, limit waiting, limit retries, protect weak dependencies, and keep rollback ready**.

## What's Next

Traffic control answers a practical release question: **where should this request go, and how should the network behave when something is slow or failing?** That gets you canaries, rollbacks, timeouts, retries, and circuit breakers.

The next step is security. After the mesh can steer traffic, the platform has to prove which workload is allowed to call which service. In the online store, `checkout` may call `payments` and `inventory`, but a random reporting job should not be able to call `payments` just because it knows the service name. The next article moves from controlling traffic behavior to proving workload identity and enforcing service-to-service authorization.

---

**References**

- [Istio traffic management concepts](https://istio.io/latest/docs/concepts/traffic-management/) - Explains Istio traffic routing, VirtualServices, DestinationRules, percentage-based traffic splits, timeouts, retries, and circuit breakers.
- [Istio VirtualService reference](https://istio.io/latest/docs/reference/config/networking/virtual-service/) - Defines VirtualService routing fields, HTTP routes, destinations, timeouts, and retry policy fields.
- [Istio DestinationRule reference](https://istio.io/latest/docs/reference/config/networking/destination-rule/) - Defines DestinationRule subsets, traffic policies, connection pool settings, and outlier detection.
- [Istio protocol selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) - Explains explicit protocol naming and automatic protocol detection for service ports.
- [Istio circuit breaking task](https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/) - Shows how to configure and test circuit breaking for requests, connections, and outlier detection.
- [Istio proxy diagnostic commands](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) - Documents `istioctl proxy-status` and `istioctl proxy-config` for inspecting Envoy and Istiod state.
- [Istio configuration analysis](https://istio.io/latest/docs/ops/diagnostic-tools/istioctl-analyze/) - Documents `istioctl analyze` for checking live clusters and local configuration files.
- [Envoy life of a request](https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request) - Explains how Envoy routes a request through listeners, routes, clusters, connection pools, and endpoints.
- [Envoy circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking) - Explains Envoy's network-level circuit breaking limits and why fast failure protects distributed systems.

---
title: "Debugging Kubernetes Networking"
description: "Follow a layered diagnostic path for Kubernetes networking failures from DNS to Services, routes, policies, and Pods."
overview: "Kubernetes networking debugging follows one request through caller, DNS, Service, EndpointSlices, Pod listener, NetworkPolicy, edge routing, events, and logs. A checkout-web incident turns each layer into a small proof."
tags: ["debugging", "kubectl", "dns", "services"]
order: 7
id: article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking
---
## Table of Contents

1. [A Failed Service Call](#a-failed-service-call)
2. [The First Caller Proof](#the-first-caller-proof)
3. [The DNS Proof](#the-dns-proof)
4. [The Service Contract](#the-service-contract)
5. [EndpointSlices, Readiness, and Pod Labels](#endpointslices-readiness-and-pod-labels)
6. [The Pod Listener](#the-pod-listener)
7. [NetworkPolicy and the Allowed Flow](#networkpolicy-and-the-allowed-flow)
8. [Ingress and Gateway at the Edge](#ingress-and-gateway-at-the-edge)
9. [Events, Logs, and Rollout Clues](#events-logs-and-rollout-clues)
10. [Safe Fixes and Evidence](#safe-fixes-and-evidence)
11. [Production Habits](#production-habits)
12. [References](#references)

## A Failed Service Call
<!-- section-summary: Kubernetes networking debugging starts with one failing request and follows that request one handoff at a time. -->

Kubernetes networking failures can look vague from the outside. A page hangs, an API returns a timeout, or one service says another service is unreachable. The team needs to follow one request through the same handoffs Kubernetes uses.

**Debugging Kubernetes networking** means proving each layer in order: caller, DNS, Service, EndpointSlice, Pod listener, NetworkPolicy, edge route, events, logs, and recent rollout changes. Each command should answer one question and tell the team what to check next.

The example is `checkout-web` calling `http://orders-api.orders/healthz`. The request times out, so the same failed call stays in view while the incident turns into small pieces of evidence.

One Pod is calling one Service. A `checkout-web` Pod in the `checkout` namespace calls `http://orders-api.orders/healthz`, and the request times out. That is enough to begin. The team needs one repeatable symptom before anyone changes DNS, Services, policies, or Pods.

**Kubernetes networking debugging** means following one request one handoff at a time. The caller asks DNS for an address. DNS points to a Service. The Service points to ready backend Pods. Policy may allow or deny the traffic. The destination Pod still needs an application process listening on the expected port.

![Kubernetes networking incident path from browser and edge route through checkout-web Pod, Cluster DNS, orders Service, EndpointSlices, NetworkPolicy, and the orders API Pod listener](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/debugging-incident-path.png)

*The incident path turns one vague networking symptom into a chain of handoffs that can each be proven or ruled out.*

The same failed call stays in view from the first proof to recovery. The habit is small proof, then next layer. The team captures the caller symptom first, then checks the name lookup, the Service, the backend Pod list, the Pod listener, policy, edge routing, events, and logs. That order keeps the work concrete because every command answers one question.

| Layer | Question | Useful proof |
|---|---|---|
| Caller | What exactly fails from `checkout-web`? | A `curl` from the caller namespace with status code or error text |
| DNS | Does the Service name resolve from the caller side? | `nslookup orders-api.orders` from `checkout` |
| Service | Does the Service publish the expected selector and port? | `kubectl -n orders describe svc orders-api` |
| EndpointSlice | Which ready Pod IPs back the Service? | EndpointSlices labeled with `kubernetes.io/service-name` |
| Pod | Does the app answer on the Pod IP and target port? | A direct request to the Pod IP and container port |
| NetworkPolicy | Does policy allow this source to this destination? | Source labels, destination labels, namespace labels, and ports |
| Edge | Does external HTTP routing point to the healthy internal Service? | Ingress or HTTPRoute backend references and controller logs |
| Evidence | What changed around the incident time? | Events, rollout history, application logs, and controller logs |

![Kubernetes networking proof by layer board showing caller curl, DNS nslookup, Service describe, EndpointSlice readiness, Pod listener, NetworkPolicy labels, and edge route checks](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/debugging-proof-layers.png)

*The first failed proof decides the next check. That keeps the team from jumping between unrelated objects during an incident.*

The first proof starts where the broken request starts: the caller.

## The First Caller Proof
<!-- section-summary: The caller proof records the exact failing request before anyone changes DNS, Services, policies, or Pods. -->

A **caller proof** is a repeatable request from the same side of the network as the application that reports the problem. For this incident, the caller side is the `checkout` namespace, and the caller workload is `checkout-web`. A browser error alone gives a symptom, but the cluster needs a command that someone else can run again.

A strong first command uses the same URL the app uses. If the application image includes `curl`, the team can test from the Deployment itself. The `-m 5` option gives the request a five-second timeout, which keeps a hanging TCP connection from eating the whole incident window.

```bash
kubectl -n checkout exec deploy/checkout-web -- \
  curl -i -m 5 http://orders-api.orders/healthz
```

The incident output might be a timeout:

```bash
curl: (28) Connection timed out after 5001 milliseconds
command terminated with exit code 28
```

The output matters more than the command. A DNS failure, a TCP timeout, a connection refused error, and an HTTP `500` point at different layers.

| Output shape | Next layer |
|---|---|
| `curl: (6) Could not resolve host` | DNS name, namespace, resolver, and CoreDNS |
| `curl: (28) Connection timed out` | EndpointSlices, NetworkPolicy, or network data plane |
| `curl: (7) Failed to connect ... port 80` | Service backend, target port, or app listener |
| `HTTP/1.1 503 Service Unavailable` | HTTP route, backend app, or upstream health |

Many production images leave out shell tools to keep containers small. A temporary debug Pod helps, but that Pod needs to look like the real caller for policy testing. If NetworkPolicy allows only Pods with the `app.kubernetes.io/name=checkout-web` label, a random debug Pod with no labels can produce a fake denial.

The debug Pod should carry the same important labels as `checkout-web`, then run the same `curl -i -m 5 http://orders-api.orders/healthz` request. That keeps policy evidence close to the real caller instead of testing a random unlabeled Pod.

The incident note should record the namespace, workload, URL, command, output, and time. That note sounds ordinary, but it saves real production time. If the next engineer joins ten minutes later, they can see whether the failure changed after a rollout, policy edit, or DNS restart.

Now the request uses a Kubernetes name, so the next proof checks whether that name resolves.

## The DNS Proof
<!-- section-summary: DNS proves that the caller can turn the Service name into the Service address Kubernetes publishes. -->

**Cluster DNS** is the name lookup system Kubernetes gives to Pods. Kubernetes creates DNS records for Services, and kubelet configures each Pod so its containers know which DNS server and search paths to use. In this incident, `checkout-web` asks DNS for `orders-api.orders`, and DNS should answer with the ClusterIP for the orders Service.

A **ClusterIP** is the stable virtual IP address for a normal internal Service. The caller usually uses the Service name instead of the ClusterIP, because names survive Service recreation patterns and make application config readable. The DNS answer proves the name maps to the Service address; the next layers still need to prove backends and traffic flow.

The proof should run from the `checkout` namespace because Kubernetes DNS search paths include the caller namespace. The short name `orders-api` would first search in `checkout`. The cross-namespace name `orders-api.orders` points to the Service in `orders`, and the full name `orders-api.orders.svc.cluster.local` removes even more ambiguity.

```bash
kubectl -n checkout run dnscheck \
  --rm -it \
  --restart=Never \
  --image=registry.k8s.io/e2e-test-images/agnhost:2.39 \
  -- nslookup orders-api.orders
```

A healthy answer usually shows the cluster DNS server and the Service address:

```bash
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      orders-api.orders.svc.cluster.local
Address 1: 10.96.42.18 orders-api.orders.svc.cluster.local
```

If the lookup fails, the team has a DNS incident or a name mismatch. The next evidence should compare the name in the application config with the Service name, then inspect the Pod resolver file and CoreDNS Pods. The resolver file shows the nameserver and search paths that the container uses, while the CoreDNS Pod list shows whether the shared DNS server is healthy.

The resolver file should point at the cluster DNS Service, and the CoreDNS Pods should be running. A broken CoreDNS Deployment affects many Services at once, so the incident blast radius grows beyond the orders API. A typo in the Service name affects only this path, so the fix stays near the application config or Service manifest.

DNS success moves the investigation forward. The name resolves to a Service address, so the next question is whether the Service points to the right Pods and port.

## The Service Contract
<!-- section-summary: The Service contract proves the stable name, selector, and caller port that sit in front of changing Pods. -->

A **Service** is the stable network contract in front of changing Pods. It has a name, a namespace, a virtual address for ClusterIP Services, a selector for finding backend Pods, and one or more ports for callers. The orders Service should publish port `80` and forward traffic to the orders API container port `3000`.

This proof comes after DNS because a successful lookup only says the name exists. The Service still has to select the right Pods and map the caller-facing port to the application port. In this incident, the caller uses a friendly Service name, so the next step is to inspect the object behind that name before looking at Pod-level details.

Here is the Service shape the team expects in this incident:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  selector:
    app.kubernetes.io/name: orders-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

The split between `port` and `targetPort` catches many real teams. `port` is the Service port that callers use. `targetPort` is the port on the selected Pods. In this example, `checkout-web` calls `http://orders-api.orders` on port `80`, and Kubernetes forwards that traffic to port `3000` on the orders API Pods.

The first Service command shows the type, ClusterIP, published port, and selector:

```bash
kubectl -n orders get svc orders-api -o wide
```

```bash
NAME                    TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
orders-api   ClusterIP   10.96.42.18   <none>        80/TCP    4h    app.kubernetes.io/name=orders-api
```

The detailed Service view adds target port and endpoint hints, but the review questions stay the same:

| Service field | What to verify |
|---|---|
| Name and namespace | The URL `orders-api.orders` points at this object |
| Selector | The labels match the orders API Pod template |
| Port mapping | Callers use `80`, and Kubernetes forwards to Pod port `3000` |
| Endpoints hint | Kubernetes currently sees selected backend addresses |

A mismatch in any of those fields can break the request while every Pod still shows `Running`.

Production mistakes usually look small. A Helm values change can rename the Pod label to `app.kubernetes.io/name=orders-api` while the Service still selects `orders-api`. A developer can change the container to listen on `8080` while the Service still targets `3000`. A chart can publish the Service in `order` instead of `orders`, which makes DNS look like the main problem even though the object lives in the wrong namespace.

The Service contract points to the backend list, and Kubernetes stores that backend list in EndpointSlices.

## EndpointSlices, Readiness, and Pod Labels
<!-- section-summary: EndpointSlices prove which ready Pod IPs and ports the Service will actually use. -->

An **EndpointSlice** is the Kubernetes object that records a slice of backend network endpoints for a Service. In normal Service-backed traffic, those endpoints usually represent Pod IPs and ports. Kubernetes uses EndpointSlices so Services can scale to many backends without one giant endpoints object changing all the time.

EndpointSlices expose the backend list that the Service can actually use. The DNS name can resolve, the Service can have the right ClusterIP, and callers can still fail when no ready Pod sits behind it. Readiness gates traffic here: a Pod with a failing readiness probe should stay out of the ready endpoint list until the app can serve traffic.

The label `kubernetes.io/service-name` connects EndpointSlices to a Service. This command asks for the slices backing the orders API:

```bash
kubectl -n orders get endpointslice \
  -l kubernetes.io/service-name=orders-api \
  -o wide
```

```bash
NAME                          ADDRESSTYPE   PORTS   ENDPOINTS                 AGE
orders-api-7k9b4   IPv4          3000    10.244.4.31,10.244.5.18   4h
```

If the slice has no endpoints, the team should compare Service selectors with Pod labels. This check keeps the focus on the data Kubernetes uses, rather than the labels people remember from a manifest review.

| EndpointSlice finding | Next proof | Likely cause |
|---|---|---|
| No slices or no endpoints | Pods selected by `app.kubernetes.io/name=orders-api` with labels shown | Service selector misses the Pod template labels |
| Endpoints exist but readiness is false | Pod `READY` column and `describe pod` events | Readiness probe, dependency, startup, or config failure |
| Endpoints exist on an unexpected port | Service `targetPort` and container port | Port drift between Service and application |
| Endpoints look healthy | Direct Pod listener proof | The failure sits after backend selection |

`Running` only says the container process exists. `READY 0/1` says Kubernetes still keeps that Pod outside normal Service traffic. A failing readiness probe can come from a bad health path, a missing environment variable, a database dependency, or an app that listens on a different port than the probe expects. Once EndpointSlices show ready backend IPs, the next proof leaves the Service abstraction and talks to the Pod listener directly.

## The Pod Listener
<!-- section-summary: The Pod listener proof checks whether the destination application accepts traffic on the IP and port the Service targets. -->

The **Pod listener** is the actual application socket inside the destination Pod. A socket combines an IP address, a protocol, and a port. For the orders API, the Service targets TCP port `3000`, so the application should listen on an address reachable from other Pods and answer `/healthz` there.

This layer explains a very common production surprise. An app can start successfully and still bind to `127.0.0.1`, which means it listens only on the loopback address inside its own network namespace. Other Pods need the app to listen on the Pod network address, usually by binding to `0.0.0.0` inside the container. The Pod can show `Running`, and the Service can show endpoints, while cross-Pod traffic still fails.

A direct proof uses one of the ready Pod IPs from EndpointSlices and sends a request from the caller side. This bypasses Service load balancing while keeping the source namespace and labels close to the real caller.

```bash
kubectl -n checkout run netcheck \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl:8.10.1 \
  --labels=app.kubernetes.io/name=checkout-web \
  -- curl -i -m 5 http://10.244.4.31:3000/healthz
```

A successful response from the Pod IP proves the app listener, Pod networking, and source-to-destination path for that backend:

```bash
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok"}
```

If the Service request fails and the direct Pod IP request succeeds, the Service selector, Service port, kube-proxy or data-plane programming, and EndpointSlice wiring deserve attention. If both fail with a timeout, NetworkPolicy or a lower network path could still block traffic. If the direct Pod request returns connection refused, the app likely listens on a different port or address.

Application logs help confirm listener problems. A Node.js service might print `Listening on 127.0.0.1:3000`, while the container needs `0.0.0.0:3000`. A Java or Go app might use the wrong port from an environment variable after a config change. The team can inspect recent logs, environment, health probe output, and, when approved, an ephemeral debug container without guessing.

This kind of debug container should follow the team's production access rules. It can reveal useful packet and socket evidence, and it also gives shell access near a production workload. Teams usually restrict who can use it and record why they used it.

Once the app listener answers from the right source, the next common blocker is policy. NetworkPolicy can allow or deny the same request based on labels, namespaces, ports, and direction.

## NetworkPolicy and the Allowed Flow
<!-- section-summary: NetworkPolicy debugging compares the real source labels, destination labels, namespace labels, direction, and port. -->

**NetworkPolicy** describes which network traffic Pods may receive or send. It uses selectors and rules over Pods, namespaces, IP blocks, protocols, and ports. Kubernetes stores the NetworkPolicy object, and the cluster's CNI plugin enforces it when the plugin supports policy enforcement.

The important beginner detail is that NetworkPolicy selects Pods rather than Services. An ingress policy in the `orders` namespace protects the destination orders API Pods. The caller may use the Service name, but the policy engine evaluates the packet against source labels, namespace labels, destination Pod labels, and ports.

Here is a focused allow rule for this incident:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-checkout-to-orders-api
  namespace: orders
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: orders-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: checkout
          podSelector:
            matchLabels:
              app.kubernetes.io/name: checkout-web
      ports:
        - protocol: TCP
          port: 3000
```

This policy selects the orders API Pods as the protected destination. It allows ingress from Pods labeled `app.kubernetes.io/name=checkout-web` in the `checkout` namespace, and it allows TCP port `3000`. The port is the destination Pod port in this example, because policy evaluates traffic to the Pod.

The fields to verify are:

- `metadata.namespace: orders` places the policy with the destination Pods.
- `podSelector.matchLabels` selects the orders API Pods that the policy protects.
- `policyTypes: Ingress` controls inbound traffic to those selected Pods.
- `namespaceSelector` and `podSelector` in the same `from` item require the caller namespace and caller Pod labels to match.
- `ports[].port: 3000` allows the destination Pod port, not the Service port.

The first policy check lists policies in the source and destination namespaces, then compares the labels the rule actually uses:

| Policy evidence | What to compare |
|---|---|
| NetworkPolicies in `orders` | Ingress rules protecting destination Pods |
| NetworkPolicies in `checkout` | Egress rules that might block DNS or orders API traffic |
| Namespace labels on `checkout` | `namespaceSelector` expectations such as `kubernetes.io/metadata.name=checkout` |
| Labels on `checkout-web` Pods | Source `podSelector` expectations |
| Labels on orders API Pods | Destination `podSelector` expectations |

A tiny label drift can close the path. For example, the namespace might have `name=checkout` while the policy expects `kubernetes.io/metadata.name=checkout`. The checkout Pod might carry `app=checkout-web` while the policy expects `app.kubernetes.io/name=checkout-web`. The orders Pod might have new Helm labels after a chart refactor while the old policy still selects the old label set.

`describe networkpolicy allow-checkout-to-orders-api` turns policy YAML into a readable summary:

```bash
kubectl -n orders describe networkpolicy allow-checkout-to-orders-api
```

```bash
PodSelector:     app.kubernetes.io/name=orders-api
Policy Types:    Ingress
Ingress:
  To Port: 3000/TCP
  From:
    NamespaceSelector: kubernetes.io/metadata.name=checkout
    PodSelector:       app.kubernetes.io/name=checkout-web
```

If the cluster also uses egress policies in `checkout`, the team needs a second rule that allows `checkout-web` to reach the orders API and DNS. Egress policies can block DNS lookups to CoreDNS, which makes a policy problem look like a DNS problem from the application side. The caller proof and DNS proof help separate those cases.

One more platform fact belongs in the incident note: the CNI plugin. Clusters commonly use policy-capable plugins such as Cilium, Calico, Antrea, and cloud-provider implementations. Kubernetes can store NetworkPolicy objects in clusters where the network plugin leaves those rules unenforced, so the platform runbook should name the plugin and its policy mode.

When internal traffic now works from `checkout-web` to `orders-api`, the investigation changes direction. If external users still fail, the edge route gets the next proof.

## Ingress and Gateway at the Edge
<!-- section-summary: Edge debugging starts after the internal Service path works, then checks host rules, paths, backend references, TLS, and controller logs. -->

An **Ingress** is a Kubernetes object for HTTP and HTTPS routing from outside the cluster to Services inside the cluster. A **Gateway** is part of the Kubernetes Gateway API, which separates infrastructure listener configuration from route objects such as HTTPRoute. In both models, an edge controller watches Kubernetes objects and configures a load balancer or proxy.

The key connection is timing. Edge debugging is useful after the internal Service path already works. If `checkout-web` can call `orders-api.orders` from inside the cluster, and public users still receive `404`, `502`, or TLS errors, the problem sits near host matching, path matching, backend references, certificates, or the controller.

For an Ingress-based setup, the team inspects host, path, class, backend Service, and events. A useful Ingress proof compares the public request with the internal Service request. The public request tells the edge symptom. The internal request tells whether the backend path works without the edge controller.

The Ingress description should name the class, host, path, backend Service, and events:

```bash
kubectl -n orders describe ingress orders-api
```

```bash
Ingress Class: public
Rules:
  Host                         Path      Backends
  api.devpolaris.example       /orders   orders-api:80 (10.244.4.31:3000)
Events:
  Normal  Sync  public-ingress-controller  Scheduled for sync
```

When the cluster uses Gateway API, the same idea applies to Gateway and HTTPRoute objects. The Gateway holds listeners such as HTTP or HTTPS on a hostname. The HTTPRoute holds matching rules and backend references to Services.

For Gateway API, the route status should show that the Route attached and its backend references resolved:

```bash
kubectl -n orders get httproute orders-api -o yaml
```

```yaml
status:
  parents:
    - parentRef:
        name: public-api
        namespace: platform-networking
      conditions:
        - type: Accepted
          status: "True"
        - type: ResolvedRefs
          status: "True"
```

Common edge mistakes are concrete. The route might match `/api/orders` while the browser calls `/orders`. The backend reference might point at Service port `8080` while the Service publishes `80`. The Ingress class or GatewayClass might point to a missing controller in this cluster. TLS might fail because the certificate covers `dev.devpolaris.example` while users call `app.devpolaris.example`.

Controller logs turn those object checks into implementation evidence. The namespace and Deployment name depend on the controller, but the pattern is the same. The team reads recent logs from the edge controller around the failing request time.

| Edge proof | What it should answer |
|---|---|
| Public `curl` to the failing URL | The exact external symptom, status, TLS error, or timeout |
| Internal caller request to the backend Service | Whether the backend path works without the edge controller |
| Ingress or HTTPRoute description | Host, path, class, listener, backend Service, and backend port |
| Controller logs | Whether the controller accepted the route and found a healthy backend |

Edge evidence connects back to the internal proofs. If internal traffic fails, the edge controller only adds noise. If internal traffic works, the edge layer has a clean job: match the host and path, terminate or pass TLS correctly, and forward to the intended Service port.

At this point the team has facts from each network layer. Events, logs, and rollout history help connect those facts to the change that caused the incident.

## Events, Logs, and Rollout Clues
<!-- section-summary: Events and logs connect the failed layer to a recent change, restart, policy edit, or controller error. -->

**Events** are Kubernetes records about things that happened to objects. They can show scheduling failures, failed image pulls, readiness probe failures, load balancer provisioning errors, and many other object-level changes. **Logs** are messages from containers and controllers. They show what the application or controller saw while the request failed.

Events and logs help most after the layer checks narrow the search. If EndpointSlices are empty, Pod events and readiness logs matter. If the Ingress backend looks wrong, Ingress controller logs matter. If DNS fails for many Services, CoreDNS events and logs matter. This keeps log reading focused instead of turning the incident into a wall of unrelated messages.

The orders namespace events give a short timeline. The orders application logs show recent app behavior. Previous container logs help when the Pod restarted during the incident. Rollout history connects networking symptoms to a Deployment change.

| Evidence | Command shape | Best use |
|---|---|---|
| Namespace events | `kubectl -n orders get events --sort-by=.lastTimestamp` | Readiness, scheduling, image pull, and object timeline |
| Current logs | `kubectl -n orders logs deploy/orders-api --since=30m` | App behavior during the failing window |
| Previous logs | `kubectl -n orders logs deploy/orders-api --previous` | Crash or restart clues |
| Rollout history and status | `kubectl -n orders rollout history/status deploy/orders-api` | Connect symptoms to a recent Deployment change |

Here is a realistic pattern. The caller proof shows a connection refused error. DNS works. The Service targets port `3000`. EndpointSlices have ready Pods. A direct Pod IP request to port `3000` fails. The app logs say `Listening on 127.0.0.1:3000` after the latest rollout. That points to an application bind address change instead of a Service, DNS, or policy problem.

Here is another pattern. The caller proof shows a timeout. DNS works. EndpointSlices list ready Pods. Direct Pod IP traffic from the labeled debug Pod times out. The orders namespace has a new `default-deny` NetworkPolicy from the same timestamp as the failure. The policy expects a namespace label missing from the `checkout` namespace. That points to policy label drift.

Those examples point to a simple rule: match the fix to the failed proof. Restarting CoreDNS would waste time during an app bind-address problem. Rolling back the app would waste time during a missing Ingress backend port problem. Each layer proof protects the team from changing the nearest visible object instead of the failed one.

Now the team can fix the smallest failed layer and keep enough evidence for the next incident review.

## Safe Fixes and Evidence
<!-- section-summary: A safe network fix changes the smallest failed layer, proves recovery from the caller, and leaves evidence for review. -->

A **safe fix** changes the layer that failed, then repeats the original caller proof. That last part matters. The incident started with `checkout-web` failing to reach `http://orders-api.orders/healthz`, so recovery should use that same request from the caller side. A green Pod, a successful local curl, or a healthy Ingress controller can support the story, but the caller request closes the loop.

The fix should be as small as the failed proof allows. If the Service selector failed, change the selector or labels. If policy blocked traffic, change the rule that names the source, destination, direction, or port. If the app listened on the wrong address, fix the workload. Matching the fix to the proof keeps the recovery focused and leaves clearer evidence for review.

Here are common fixes matched to the proof that supports them:

| Failed proof | Typical fix | Recovery proof |
|---|---|---|
| DNS name fails and Service name is wrong | Correct the application URL or Service name | `nslookup` and caller `curl` from `checkout` |
| Service selector returns no Pods | Align Service selector with Pod template labels | EndpointSlices show ready Pod IPs |
| Service targets wrong port | Change `targetPort` or the container listener port | Service request returns `200` |
| Pods are `Running` but `READY 0/1` | Fix readiness path, dependency, config, or app startup | EndpointSlices show `ready=true` |
| Direct Pod IP request is refused | Fix app bind address or container port | Direct Pod IP request returns health response |
| Policy blocks traffic | Correct namespace, Pod selectors, direction, or port | Labeled caller debug Pod can reach backend |
| External route fails while internal path works | Correct host, path, class, TLS, or backend Service port | Public curl and internal curl both pass |

The rollback path depends on what changed. If the latest orders API Deployment changed the bind address, `kubectl rollout undo` may restore service while the team prepares a proper fix. If a NetworkPolicy change caused the outage, reverting the policy manifest through GitOps or applying the previous known-good rule may restore the path. If an Ingress backend reference changed, the smallest fix may be a route manifest correction rather than an application rollback.

After the fix, the same caller proof should pass:

```bash
kubectl -n checkout run netcheck \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl:8.10.1 \
  --labels=app.kubernetes.io/name=checkout-web \
  -- curl -i -m 5 http://orders-api.orders/healthz
```

The evidence bundle can stay short. Keep the original failing command, the failed layer proof, the object diff or rollout change, the fix, and the recovery command. That record gives the post-incident review enough detail to improve tests, chart validation, policy review, or runbooks.

For example, a selector incident might end with a short summary: `checkout-web` order history failed for 18 minutes, caller `curl` from the `checkout` namespace timed out, the Service selector matched zero Pods after a chart label change, the team restored `app.kubernetes.io/name=orders-api` on the Pod template, EndpointSlices listed two ready endpoints, caller `curl` returned `200`, and CI gained a rendered-label check.

![Kubernetes networking safe fix loop showing original checkout-web caller proof, smallest fix, same caller proof passing, and the evidence bundle for review](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/debugging-recovery-summary.png)

*Recovery evidence closes the same loop that opened the incident: repeat the caller proof, show the failed layer, record the fix, and add one prevention check.*

The final section turns those incident lessons into daily habits.

## Production Habits
<!-- section-summary: Good network debugging habits make future incidents shorter by keeping names, labels, ports, tools, and evidence predictable. -->

Production Kubernetes networking needs a few boring and consistent details. Use namespace-qualified Service names for cross-namespace calls, such as `orders-api.orders`, so the application config carries the destination namespace. Use stable label keys like `app.kubernetes.io/name` and keep Service selectors, Deployment labels, and NetworkPolicy selectors aligned in chart tests.

Keep Service ports and container ports easy to trace. A Service can publish `80` and target `3000`, and that is fine when everyone can see the mapping. Name ports consistently, keep readiness probes pointed at the same application health contract, and record whether NetworkPolicy rules should use the Service-facing port or the Pod-facing port in your team's examples.

Prepare debug access before the incident. Approve one or two debug images, define who may create temporary debug Pods or ephemeral containers, and document the labels those Pods need for realistic NetworkPolicy tests. A debug Pod with the wrong labels can waste time because it tests a different policy path than the real workload.

Make the first and last command the same shape. The first command captures the failing caller request. The last command proves that same request works again. Everything in the middle explains why it failed and what changed.

Kubernetes networking has many pieces, but the request path gives them order. Caller, DNS, Service, EndpointSlices, Pod listener, NetworkPolicy, edge route, events, and logs each answer a different question. When the team asks those questions one at a time, a vague "networking is broken" incident turns into one failed proof and one focused fix.

## References

- [Kubernetes: Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Official walkthrough for diagnosing Services that fail to respond.
- [Kubernetes: DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Explains Service DNS records, Pod DNS configuration, and namespace-based names.
- [Kubernetes: Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/) - Shows how to test DNS from a Pod and inspect resolver configuration.
- [Kubernetes: Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Defines Services, selectors, ports, target ports, and EndpointSlice relationships.
- [Kubernetes: EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Describes how EndpointSlices represent Service backends and ready endpoints.
- [Kubernetes: Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Documents Pod and namespace selectors, ingress and egress rules, and CNI enforcement requirements.
- [Kubernetes: Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Defines HTTP and HTTPS routing from outside the cluster to Services.
- [Kubernetes: Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/) - Explains Gateway, GatewayClass, and route-based traffic configuration.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Covers Pod debugging and ephemeral container workflows.
- [Kubernetes: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) - Explains how Kubernetes exposes container logs through the API and `kubectl logs`.

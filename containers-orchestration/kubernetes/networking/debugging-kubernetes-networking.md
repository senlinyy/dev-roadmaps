---
title: "Debugging Kubernetes Networking"
description: "Follow a layered diagnostic path for Kubernetes networking failures from DNS to Services, routes, policies, and Pods."
overview: "Kubernetes networking debugging follows one request through caller, DNS, Service, EndpointSlices, Pod listener, NetworkPolicy, edge routing, events, and logs. This article follows a devpolaris-web incident and turns each layer into a small proof."
tags: ["debugging", "kubectl", "dns", "services"]
order: 7
id: article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking
---

## Table of Contents

1. [The Incident Path](#the-incident-path)
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

## The Incident Path
<!-- section-summary: A Kubernetes network incident needs one request followed through each layer that handles it. -->

Picture the production incident. The DevPolaris order history page opens, the page shell loads, and then the orders panel spins until the browser shows an error. The frontend team says the `devpolaris-web` app cannot reach the orders API. The platform team sees healthy nodes. The backend team says the orders Deployment has running Pods. Everyone has one true piece of the story, and the broken request still needs a path through the cluster.

The request we care about starts in the `web` namespace. A Pod from the `devpolaris-web` Deployment calls `http://devpolaris-orders-api.orders/healthz`. That name should point to the `devpolaris-orders-api` Service in the `orders` namespace, and that Service should send traffic to ready orders API Pods on the container's HTTP port. If users reach the same application from the public internet, an Ingress or Gateway object may sit in front of the Service too.

![Kubernetes networking incident path from browser and edge route through devpolaris-web Pod, Cluster DNS, orders Service, EndpointSlices, NetworkPolicy, and the orders API Pod listener](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/debugging-incident-path.png)

*The incident path turns one vague networking symptom into a chain of handoffs that can each be proven or ruled out.*

**Kubernetes networking debugging** means proving each handoff on that path. A handoff is the place where one Kubernetes object or process points to the next one. The caller hands a name to DNS. DNS returns a Service address. The Service points to EndpointSlices. EndpointSlices list ready Pod IPs and ports. NetworkPolicy rules allow or deny the packet path. The destination Pod has an application process listening on a real port.

This article uses the same path from start to finish. The useful habit is small proof, then next layer. The team captures the caller symptom first, then checks DNS, the Service, EndpointSlices, the Pod listener, NetworkPolicy, edge routing, events, and logs. That order keeps the incident calm because every command answers one concrete question.

| Layer | Question | Useful proof |
|---|---|---|
| Caller | What exactly fails from `devpolaris-web`? | A `curl` from the caller namespace with status code or error text |
| DNS | Does the Service name resolve from the caller side? | `nslookup devpolaris-orders-api.orders` from `web` |
| Service | Does the Service publish the expected selector and port? | `kubectl -n orders describe svc devpolaris-orders-api` |
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

A **caller proof** is a repeatable request from the same side of the network as the application that reports the problem. For this incident, the caller side is the `web` namespace, and the caller workload is `devpolaris-web`. A browser error alone gives a symptom, but the cluster needs a command that someone else can run again.

A strong first command uses the same URL the app uses. If the application image includes `curl`, the team can test from the Deployment itself. The `-m 5` option gives the request a five-second timeout, which keeps a hanging TCP connection from eating the whole incident window.

```bash
kubectl -n web exec deploy/devpolaris-web -- \
  curl -i -m 5 http://devpolaris-orders-api.orders/healthz
```

The output matters more than the command. A DNS failure, a TCP timeout, a connection refused error, and an HTTP `500` point at different layers. Here are four common shapes:

```bash
curl: (6) Could not resolve host: devpolaris-orders-api.orders
```

```bash
curl: (28) Connection timed out after 5001 milliseconds
```

```bash
curl: (7) Failed to connect to devpolaris-orders-api.orders port 80
```

```bash
HTTP/1.1 503 Service Unavailable
```

Each output tells the next part of the story. `Could not resolve host` sends the team to DNS. A timeout often sends the team toward endpoints, NetworkPolicy, or the network data plane. `Failed to connect` often means something actively refused the connection, which can happen when the Service has no usable backend or the application listens on a different port. An HTTP status code means the request reached an HTTP-speaking component, so the route, backend app, or upstream health deserves attention.

Many production images leave out shell tools to keep containers small. A temporary debug Pod helps, but that Pod needs to look like the real caller for policy testing. If NetworkPolicy allows only Pods with the `app.kubernetes.io/name=devpolaris-web` label, a random debug Pod with no labels can produce a fake denial.

```bash
kubectl -n web run netcheck \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl:8.10.1 \
  --labels=app.kubernetes.io/name=devpolaris-web \
  -- sh
```

Inside that shell, the same request gives a clean caller proof:

```bash
curl -i -m 5 http://devpolaris-orders-api.orders/healthz
```

The incident note should record the namespace, workload, URL, command, output, and time. That note sounds ordinary, but it saves real production time. If the next engineer joins ten minutes later, they can see whether the failure changed after a rollout, policy edit, or DNS restart.

Now the request uses a Kubernetes name, so the next proof checks whether that name resolves.

## The DNS Proof
<!-- section-summary: DNS proves that the caller can turn the Service name into the Service address Kubernetes publishes. -->

**Cluster DNS** is the name lookup system Kubernetes gives to Pods. Kubernetes creates DNS records for Services, and kubelet configures each Pod so its containers know which DNS server and search paths to use. In this incident, `devpolaris-web` asks DNS for `devpolaris-orders-api.orders`, and DNS should answer with the ClusterIP for the orders Service.

A **ClusterIP** is the stable virtual IP address for a normal internal Service. The caller usually uses the Service name instead of the ClusterIP, because names survive Service recreation patterns and make application config readable. The DNS answer proves the name maps to the Service address; the next layers still need to prove backends and traffic flow.

The proof should run from the `web` namespace because Kubernetes DNS search paths include the caller namespace. The short name `devpolaris-orders-api` would first search in `web`. The cross-namespace name `devpolaris-orders-api.orders` points to the Service in `orders`, and the full name `devpolaris-orders-api.orders.svc.cluster.local` removes even more ambiguity.

```bash
kubectl -n web run dnscheck \
  --rm -it \
  --restart=Never \
  --image=registry.k8s.io/e2e-test-images/agnhost:2.39 \
  -- nslookup devpolaris-orders-api.orders
```

A healthy answer usually shows the cluster DNS server and the Service address:

```bash
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      devpolaris-orders-api.orders.svc.cluster.local
Address 1: 10.96.42.18 devpolaris-orders-api.orders.svc.cluster.local
```

If the lookup fails, the team has a DNS incident or a name mismatch. The next evidence should compare the name in the application config with the Service name, then inspect the Pod resolver file and CoreDNS Pods. The resolver file shows the nameserver and search paths that the container uses.

```bash
kubectl -n web exec deploy/devpolaris-web -- cat /etc/resolv.conf
```

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide
```

The resolver file should point at the cluster DNS Service, and the CoreDNS Pods should be running. A broken CoreDNS Deployment affects many Services at once, so the incident blast radius grows beyond the orders API. A typo in the Service name affects only this path, so the fix stays near the application config or Service manifest.

DNS success moves the investigation forward. The name resolves to a Service address, so the next question is whether the Service points to the right Pods and port.

## The Service Contract
<!-- section-summary: The Service contract proves the stable name, selector, and caller port that sit in front of changing Pods. -->

A **Service** is the stable network contract in front of changing Pods. It has a name, a namespace, a virtual address for ClusterIP Services, a selector for finding backend Pods, and one or more ports for callers. The orders Service should publish port `80` and forward traffic to the orders API container port `3000`.

Here is the Service shape the team expects in this incident:

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

The split between `port` and `targetPort` catches many real teams. `port` is the Service port that callers use. `targetPort` is the port on the selected Pods. In this example, `devpolaris-web` calls `http://devpolaris-orders-api.orders` on port `80`, and Kubernetes forwards that traffic to port `3000` on the orders API Pods.

The first Service command shows the type, ClusterIP, published port, and selector:

```bash
kubectl -n orders get svc devpolaris-orders-api -o wide
```

```bash
NAME                    TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
devpolaris-orders-api   ClusterIP   10.96.42.18   <none>        80/TCP    4h    app.kubernetes.io/name=devpolaris-orders-api
```

The detailed view adds the target port and selected endpoints that Kubernetes currently sees:

```bash
kubectl -n orders describe svc devpolaris-orders-api
```

```bash
Name:              devpolaris-orders-api
Namespace:         orders
Type:              ClusterIP
IP:                10.96.42.18
Port:              http  80/TCP
TargetPort:        3000/TCP
Selector:          app.kubernetes.io/name=devpolaris-orders-api
Endpoints:         10.244.4.31:3000,10.244.5.18:3000
```

This output gives the team three checks. The Service name and namespace match the URL. The selector matches the labels on orders API Pods. The port mapping sends callers from `80` to the container's `3000`. A mismatch in any of those fields can break the request while every Pod still shows `Running`.

Production mistakes usually look small. A Helm values change can rename the Pod label to `app.kubernetes.io/name=orders-api` while the Service still selects `devpolaris-orders-api`. A developer can change the container to listen on `8080` while the Service still targets `3000`. A chart can publish the Service in `order` instead of `orders`, which makes DNS look like the main problem even though the object lives in the wrong namespace.

The Service contract points to the backend list, and Kubernetes stores that backend list in EndpointSlices.

## EndpointSlices, Readiness, and Pod Labels
<!-- section-summary: EndpointSlices prove which ready Pod IPs and ports the Service will actually use. -->

An **EndpointSlice** is the Kubernetes object that records a slice of backend network endpoints for a Service. In normal Service-backed traffic, those endpoints usually represent Pod IPs and ports. Kubernetes uses EndpointSlices so Services can scale to many backends without one giant endpoints object changing all the time.

EndpointSlices matter because a Service can exist while its backend list is empty. The DNS name can resolve, the Service can have the right ClusterIP, and callers can still fail because no ready Pod sits behind it. Readiness gates traffic here: a Pod with a failing readiness probe should stay out of the ready endpoint list until the app can serve traffic.

The label `kubernetes.io/service-name` connects EndpointSlices to a Service. This command asks for the slices backing the orders API:

```bash
kubectl -n orders get endpointslice \
  -l kubernetes.io/service-name=devpolaris-orders-api \
  -o wide
```

```bash
NAME                          ADDRESSTYPE   PORTS   ENDPOINTS                 AGE
devpolaris-orders-api-7k9b4   IPv4          3000    10.244.4.31,10.244.5.18   4h
```

For deeper evidence, JSONPath can show endpoint readiness and addresses in a compact form:

```bash
kubectl -n orders get endpointslice \
  -l kubernetes.io/service-name=devpolaris-orders-api \
  -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]} ready={.conditions.ready}{"\n"}{end}'
```

```bash
10.244.4.31 ready=true
10.244.5.18 ready=true
```

If the slice has no endpoints, the team should compare Service selectors with Pod labels. This check keeps the focus on the data Kubernetes uses, rather than the labels people remember from a manifest review.

```bash
kubectl -n orders get pods \
  -l app.kubernetes.io/name=devpolaris-orders-api \
  --show-labels \
  -o wide
```

When the selector returns no Pods, the Service cannot route to the Deployment. The fix usually changes the Service selector or the Pod template labels, then rolls the Deployment if Pod template labels changed. When the selector returns Pods and EndpointSlices stay empty, readiness is the next clue.

```bash
kubectl -n orders get pods \
  -l app.kubernetes.io/name=devpolaris-orders-api
```

```bash
NAME                                      READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-6f7c9d7f45-r8m2q    0/1     Running   0          8m
devpolaris-orders-api-6f7c9d7f45-zk4ph    0/1     Running   0          8m
```

`Running` only says the container process exists. `READY 0/1` says Kubernetes still keeps that Pod outside normal Service traffic. A failing readiness probe can come from a bad health path, a missing environment variable, a database dependency, or an app that listens on a different port than the probe expects.

```bash
kubectl -n orders describe pod devpolaris-orders-api-6f7c9d7f45-r8m2q
```

The events at the bottom of `describe pod` often show readiness probe failures, image pull problems, restarts, or config errors. Once EndpointSlices show ready backend IPs, the next proof leaves the Service abstraction and talks to the Pod listener directly.

## The Pod Listener
<!-- section-summary: The Pod listener proof checks whether the destination application accepts traffic on the IP and port the Service targets. -->

The **Pod listener** is the actual application socket inside the destination Pod. A socket combines an IP address, a protocol, and a port. For the orders API, the Service targets TCP port `3000`, so the application should listen on an address reachable from other Pods and answer `/healthz` there.

This layer explains a very common production surprise. An app can start successfully and still bind to `127.0.0.1`, which means it listens only on the loopback address inside its own network namespace. Other Pods need the app to listen on the Pod network address, usually by binding to `0.0.0.0` inside the container. The Pod can show `Running`, and the Service can show endpoints, while cross-Pod traffic still fails.

A direct proof uses one of the ready Pod IPs from EndpointSlices and sends a request from the caller side. This bypasses Service load balancing while keeping the source namespace and labels close to the real caller.

```bash
kubectl -n web run netcheck \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl:8.10.1 \
  --labels=app.kubernetes.io/name=devpolaris-web \
  -- curl -i -m 5 http://10.244.4.31:3000/healthz
```

A successful response from the Pod IP proves the app listener, Pod networking, and source-to-destination path for that backend:

```bash
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok"}
```

If the Service request fails and the direct Pod IP request succeeds, the Service selector, Service port, kube-proxy or data-plane programming, and EndpointSlice wiring deserve attention. If both fail with a timeout, NetworkPolicy or a lower network path could still block traffic. If the direct Pod request returns connection refused, the app likely listens on a different port or address.

Application logs help confirm listener problems. A Node.js service might print `Listening on 127.0.0.1:3000`, while the container needs `0.0.0.0:3000`. A Java or Go app might read the wrong port from an environment variable after a config change. The team can inspect logs and environment without guessing.

```bash
kubectl -n orders logs deploy/devpolaris-orders-api --since=20m
```

```bash
kubectl -n orders exec deploy/devpolaris-orders-api -- printenv | sort
```

Some images also include `ss` or `netstat`, which can show the actual listening address. Many lean production images omit those tools, so logs, config, health probe output, and `kubectl debug` with an ephemeral container may carry the proof instead.

```bash
kubectl -n orders debug deploy/devpolaris-orders-api \
  -it \
  --image=nicolaka/netshoot:v0.13 \
  --target=api
```

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
  name: allow-web-to-orders-api
  namespace: orders
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: web
          podSelector:
            matchLabels:
              app.kubernetes.io/name: devpolaris-web
      ports:
        - protocol: TCP
          port: 3000
```

This policy selects the orders API Pods as the protected destination. It allows ingress from Pods labeled `app.kubernetes.io/name=devpolaris-web` in the `web` namespace, and it allows TCP port `3000`. The port is the destination Pod port in this example, because policy evaluates traffic to the Pod.

The first policy check lists the policies in both namespaces. The destination namespace matters for ingress restrictions, and the source namespace matters for egress restrictions.

```bash
kubectl -n orders get networkpolicy
kubectl -n web get networkpolicy
```

The next checks compare the labels that the policy actually uses:

```bash
kubectl get namespace web --show-labels
kubectl -n web get pods \
  -l app.kubernetes.io/name=devpolaris-web \
  --show-labels
kubectl -n orders get pods \
  -l app.kubernetes.io/name=devpolaris-orders-api \
  --show-labels
```

A tiny label drift can close the path. For example, the namespace might have `name=web` while the policy expects `kubernetes.io/metadata.name=web`. The web Pod might carry `app=devpolaris-web` while the policy expects `app.kubernetes.io/name=devpolaris-web`. The orders Pod might have new Helm labels after a chart refactor while the old policy still selects the old label set.

`describe` turns policy YAML into a readable summary:

```bash
kubectl -n orders describe networkpolicy allow-web-to-orders-api
```

If the cluster also uses egress policies in `web`, the team needs a second rule that allows `devpolaris-web` to reach the orders API and DNS. Egress policies can block DNS lookups to CoreDNS, which makes a policy problem look like a DNS problem from the application side. The caller proof and DNS proof help separate those cases.

One more platform fact belongs in the incident note: the CNI plugin. Clusters commonly use policy-capable plugins such as Cilium, Calico, Antrea, and cloud-provider implementations. Kubernetes can store NetworkPolicy objects in clusters where the network plugin leaves those rules unenforced, so the platform runbook should name the plugin and its policy mode.

When internal traffic now works from `devpolaris-web` to `devpolaris-orders-api`, the investigation changes direction. If external users still fail, the edge route gets the next proof.

## Ingress and Gateway at the Edge
<!-- section-summary: Edge debugging starts after the internal Service path works, then checks host rules, paths, backend references, TLS, and controller logs. -->

An **Ingress** is a Kubernetes object for HTTP and HTTPS routing from outside the cluster to Services inside the cluster. A **Gateway** is part of the Kubernetes Gateway API, which separates infrastructure listener configuration from route objects such as HTTPRoute. In both models, an edge controller watches Kubernetes objects and configures a load balancer or proxy.

The key connection is timing. Edge debugging is useful after the internal Service path already works. If `devpolaris-web` can call `devpolaris-orders-api.orders` from inside the cluster, and public users still receive `404`, `502`, or TLS errors, the problem sits near host matching, path matching, backend references, certificates, or the controller.

For an Ingress-based setup, the team can inspect host, path, class, backend Service, and events:

```bash
kubectl -n web get ingress
kubectl -n web describe ingress devpolaris-web
```

A useful Ingress proof compares the public request with the internal Service request. The public request tells the edge symptom. The internal request tells whether the backend path works without the edge controller.

```bash
curl -i https://app.devpolaris.example/orders/healthz
```

```bash
kubectl -n web run netcheck \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl:8.10.1 \
  --labels=app.kubernetes.io/name=devpolaris-web \
  -- curl -i -m 5 http://devpolaris-orders-api.orders/healthz
```

When the cluster uses Gateway API, the same idea applies to Gateway and HTTPRoute objects. The Gateway holds listeners such as HTTP or HTTPS on a hostname. The HTTPRoute holds matching rules and backend references to Services.

```bash
kubectl -n web get gateway,httproute
kubectl -n web describe httproute devpolaris-web
```

Common edge mistakes are concrete. The route might match `/api/orders` while the browser calls `/orders`. The backend reference might point at Service port `8080` while the Service publishes `80`. The Ingress class or GatewayClass might point to a missing controller in this cluster. TLS might fail because the certificate covers `dev.devpolaris.example` while users call `app.devpolaris.example`.

Controller logs turn those object checks into implementation evidence. The namespace and Deployment name depend on the controller, but the pattern is the same. The team reads recent logs from the edge controller around the failing request time.

```bash
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --since=20m
```

Edge evidence connects back to the internal proofs. If internal traffic fails, the edge controller only adds noise. If internal traffic works, the edge layer has a clean job: match the host and path, terminate or pass TLS correctly, and forward to the intended Service port.

At this point the team has facts from each network layer. Events, logs, and rollout history help connect those facts to the change that caused the incident.

## Events, Logs, and Rollout Clues
<!-- section-summary: Events and logs connect the failed layer to a recent change, restart, policy edit, or controller error. -->

**Events** are Kubernetes records about things that happened to objects. They can show scheduling failures, failed image pulls, readiness probe failures, load balancer provisioning errors, and many other object-level changes. **Logs** are messages from containers and controllers. They show what the application or controller saw while the request failed.

Events and logs help most after the layer checks narrow the search. If EndpointSlices are empty, Pod events and readiness logs matter. If the Ingress backend looks wrong, Ingress controller logs matter. If DNS fails for many Services, CoreDNS events and logs matter. This keeps log reading focused instead of turning the incident into a wall of unrelated messages.

The orders namespace events give a short timeline:

```bash
kubectl -n orders get events --sort-by=.lastTimestamp
```

The orders application logs show recent app behavior:

```bash
kubectl -n orders logs deploy/devpolaris-orders-api --since=30m
```

Previous container logs help when the Pod restarted during the incident:

```bash
kubectl -n orders logs deploy/devpolaris-orders-api --previous
```

Rollout history connects networking symptoms to a Deployment change:

```bash
kubectl -n orders rollout history deploy/devpolaris-orders-api
kubectl -n orders rollout status deploy/devpolaris-orders-api
```

Here is a realistic pattern. The caller proof shows a connection refused error. DNS works. The Service targets port `3000`. EndpointSlices have ready Pods. A direct Pod IP request to port `3000` fails. The app logs say `Listening on 127.0.0.1:3000` after the latest rollout. That points to an application bind address change instead of a Service, DNS, or policy problem.

Here is another pattern. The caller proof shows a timeout. DNS works. EndpointSlices list ready Pods. Direct Pod IP traffic from the labeled debug Pod times out. The orders namespace has a new `default-deny` NetworkPolicy from the same timestamp as the failure. The policy expects a namespace label missing from the `web` namespace. That points to policy label drift.

Those examples matter because the fix should match the proof. Restarting CoreDNS would waste time during an app bind-address problem. Rolling back the app would waste time during a missing Ingress backend port problem. Each layer proof protects the team from changing the nearest visible object instead of the failed one.

Now the team can fix the smallest failed layer and keep enough evidence for the next incident review.

## Safe Fixes and Evidence
<!-- section-summary: A safe network fix changes the smallest failed layer, proves recovery from the caller, and leaves evidence for review. -->

A **safe fix** changes the layer that failed, then repeats the original caller proof. That last part matters. The incident started with `devpolaris-web` failing to reach `http://devpolaris-orders-api.orders/healthz`, so recovery should use that same request from the caller side. A green Pod, a successful local curl, or a healthy Ingress controller can support the story, but the caller request closes the loop.

Here are common fixes matched to the proof that supports them:

| Failed proof | Typical fix | Recovery proof |
|---|---|---|
| DNS name fails and Service name is wrong | Correct the application URL or Service name | `nslookup` and caller `curl` from `web` |
| Service selector returns no Pods | Align Service selector with Pod template labels | EndpointSlices show ready Pod IPs |
| Service targets wrong port | Change `targetPort` or the container listener port | Service request returns `200` |
| Pods are `Running` but `READY 0/1` | Fix readiness path, dependency, config, or app startup | EndpointSlices show `ready=true` |
| Direct Pod IP request is refused | Fix app bind address or container port | Direct Pod IP request returns health response |
| Policy blocks traffic | Correct namespace, Pod selectors, direction, or port | Labeled caller debug Pod can reach backend |
| External route fails while internal path works | Correct host, path, class, TLS, or backend Service port | Public curl and internal curl both pass |

The rollback path depends on what changed. If the latest orders API Deployment changed the bind address, `kubectl rollout undo` may restore service while the team prepares a proper fix. If a NetworkPolicy change caused the outage, reverting the policy manifest through GitOps or applying the previous known-good rule may restore the path. If an Ingress backend reference changed, the smallest fix may be a route manifest correction rather than an application rollback.

```bash
kubectl -n orders rollout undo deploy/devpolaris-orders-api
```

```bash
kubectl -n orders rollout status deploy/devpolaris-orders-api
```

After the fix, the same caller proof should pass:

```bash
kubectl -n web run netcheck \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl:8.10.1 \
  --labels=app.kubernetes.io/name=devpolaris-web \
  -- curl -i -m 5 http://devpolaris-orders-api.orders/healthz
```

The evidence bundle can stay short. Keep the original failing command, the failed layer proof, the object diff or rollout change, the fix, and the recovery command. That gives the post-incident review enough detail to improve tests, chart validation, policy review, or runbooks.

For example, a selector incident might end with this summary:

```markdown
Impact: devpolaris-web order history failed for 18 minutes.
Caller proof: curl from web namespace to devpolaris-orders-api.orders timed out.
Failed layer: Service selector matched zero Pods after chart label change.
Fix: restored app.kubernetes.io/name=devpolaris-orders-api on the Pod template.
Recovery proof: EndpointSlice listed two ready endpoints and caller curl returned 200.
Prevention: add CI check that Service selectors match rendered Deployment labels.
```

![Kubernetes networking safe fix loop showing original devpolaris-web caller proof, smallest fix, same caller proof passing, and the evidence bundle for review](/content-assets/articles/article-containers-orchestration-kubernetes-networking-debugging-kubernetes-networking/debugging-recovery-summary.png)

*Recovery evidence closes the same loop that opened the incident: repeat the caller proof, show the failed layer, record the fix, and add one prevention check.*

The final section turns those incident lessons into daily habits.

## Production Habits
<!-- section-summary: Good network debugging habits make future incidents shorter by keeping names, labels, ports, tools, and evidence predictable. -->

Production Kubernetes networking needs a few boring and consistent details. Use namespace-qualified Service names for cross-namespace calls, such as `devpolaris-orders-api.orders`, so the application config carries the destination namespace. Use stable label keys like `app.kubernetes.io/name` and keep Service selectors, Deployment labels, and NetworkPolicy selectors aligned in chart tests.

Keep Service ports and container ports easy to trace. A Service can publish `80` and target `3000`, and that is fine when everyone can see the mapping. Name ports consistently, keep readiness probes pointed at the same application health contract, and record whether NetworkPolicy rules should use the Service-facing port or the Pod-facing port in your team's examples.

Prepare debug access before the incident. Approve one or two debug images, define who may create temporary debug Pods or ephemeral containers, and document the labels those Pods need for realistic NetworkPolicy tests. A debug Pod with the wrong labels can waste time because it tests a different policy path than the real workload.

Make the first and last command the same shape. The first command captures the failing caller request. The last command proves that same request works again. Everything in the middle explains why it failed and what changed.

Kubernetes networking has many pieces, but the request path gives them order. Caller, DNS, Service, EndpointSlices, Pod listener, NetworkPolicy, edge route, events, and logs each answer a different question. When the team asks those questions one at a time, a vague "networking is broken" incident turns into one failed proof and one focused fix.

---

**References**

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

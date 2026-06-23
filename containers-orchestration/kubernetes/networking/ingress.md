---
title: "Ingress"
description: "Route HTTP and HTTPS traffic from outside the cluster to internal Kubernetes Services."
overview: "Ingress gives HTTP workloads a shared outside entry point. It connects public hostnames and URL paths to internal Services while an Ingress controller does the real proxy or load balancer work."
tags: ["ingress", "http", "tls", "routing"]
order: 3
id: article-containers-orchestration-kubernetes-networking-ingress
---

## Table of Contents

1. [The Request Ingress Is Built For](#the-request-ingress-is-built-for)
2. [Service First, Ingress Second](#service-first-ingress-second)
3. [Ingress Object, IngressClass, and Controller](#ingress-object-ingressclass-and-controller)
4. [Hosts, Paths, and Backend Services](#hosts-paths-and-backend-services)
5. [TLS at the Edge](#tls-at-the-edge)
6. [DNS and the Controller Address](#dns-and-the-controller-address)
7. [Rollout Checks for a New Ingress](#rollout-checks-for-a-new-ingress)
8. [Debugging by Following the Request](#debugging-by-following-the-request)
9. [Production Ownership and Tradeoffs](#production-ownership-and-tradeoffs)
10. [What's Next](#whats-next)

## The Request Ingress Is Built For
<!-- section-summary: Ingress is the Kubernetes API object that describes how outside HTTP or HTTPS traffic should reach Services inside the cluster. -->

Picture a learner opening the DevPolaris web app and clicking a page that loads course progress. The browser sends a request to `https://api.devpolaris.example/progress/me`. That request starts outside the cluster, uses a public hostname, uses HTTPS, and carries a URL path that should reach the progress API running inside Kubernetes.

The progress API Pods already live inside the cluster. They have Pod IPs, labels, readiness probes, and a Deployment that keeps the right number of replicas running. The browser only needs a hostname and a path; Kubernetes keeps the Pod IPs behind the Service.

**Ingress** is the Kubernetes resource that describes that outside HTTP entry rule. The official Kubernetes [Ingress documentation](https://kubernetes.io/docs/concepts/services-networking/ingress/) describes Ingress as an API object for managing external access to Services, usually HTTP. In practical terms, an Ingress says: when a request reaches this hostname and this path, send it to this Service.

There are a few concepts connected together here. A **Service** gives the Pods a stable internal address. An **Ingress rule** maps a public host and path to that Service. An **Ingress controller** is the running software that reads the rule and configures a proxy or load balancer. **DNS** points the public hostname at the controller's address. **TLS** gives the browser a trusted HTTPS connection.

![Ingress request path showing browser, DNS, Ingress controller, Ingress rule, progress-api Service, and ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-networking-ingress/ingress-request-path.png)

*Ingress is the route description, and the controller makes that route real by accepting traffic for the hostname and forwarding it to the Service.*

That is the whole article in one path. We will start at the Service because the Service owns Pod selection and stable backend naming. Then we will add the Ingress object, the controller that makes it real, the hostname and path rules, TLS, DNS, rollout checks, and debugging. Each part answers one question in the request: where did the client enter, which rule matched, which Service received it, and which Pods handled it?

## Service First, Ingress Second
<!-- section-summary: A Service gives the application a stable internal target, and Ingress places an HTTP entry rule in front of that target. -->

A **Service** is Kubernetes' stable internal address for a group of Pods. The Kubernetes [Service documentation](https://kubernetes.io/docs/concepts/services-networking/service/) explains that a Service exposes an application running on a set of Pods and gives clients a stable way to reach them. For the progress API, the Service can be named `progress-api` in the `learning` namespace.

The Service uses a selector to find Pods with the right labels. It exposes one port that other cluster workloads can call, and it sends traffic to the container port where the app listens. This keeps callers away from changing Pod IPs. A Deployment can replace Pods during a rollout, and the Service name stays the same.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: progress-api
  namespace: learning
spec:
  type: ClusterIP
  selector:
    app: progress-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

`type: ClusterIP` means the Service is reachable inside the cluster. That is usually the right starting point for an app behind Ingress. The Service keeps the backend private, and the Ingress controller acts as the shared edge that outside clients use.

Before the platform team adds any outside route, someone should prove that the Service works from inside the cluster. This check creates a temporary curl Pod in a different namespace and calls the Service DNS name. The response tells us that cluster DNS, Service selection, backend endpoints, and the app health endpoint line up.

```bash
kubectl -n web run netcheck --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sS http://progress-api.learning/healthz
```

```json
{"status":"ok","service":"progress-api"}
```

That internal check matters because Ingress builds on top of the Service. A broken selector, a wrong `targetPort`, or missing ready Pods will still break the request after the edge route looks perfect. The clean flow is Service first, then Ingress.

## Ingress Object, IngressClass, and Controller
<!-- section-summary: The Ingress object stores the desired HTTP rule, while an Ingress controller watches that object and configures real traffic handling. -->

The **Ingress object** is the YAML resource stored in the Kubernetes API. It contains the host, path, TLS, and backend Service references. Kubernetes accepts the object as desired configuration, the same way it stores a Deployment or Service.

The **Ingress controller** is the running component that turns that desired configuration into real network behavior. The official Kubernetes [Ingress controllers page](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/) lists many implementations, including HAProxy, Traefik, Kong, Cilium, cloud provider controllers, and Envoy-based options. Each controller watches Ingress objects and configures its own proxy, gateway, or load balancer.

This split is the first big production lesson. Creating an Ingress object only records the route. Traffic starts working when a controller is installed, watches the matching Ingress, exposes an address, and can reach the backend Service. A cluster can store a valid Ingress YAML file while no outside request succeeds, because the controller piece is missing or pointed at a different class.

**IngressClass** connects an Ingress to the controller that should handle it. In a small cluster, there may be one class named `public`. In a larger company, there might be a public internet controller, an internal-only controller, and a special controller for partner traffic. The class keeps each route on the intended edge.

```bash
kubectl get ingressclass
```

```bash
NAME       CONTROLLER                                  PARAMETERS   AGE
public     platform.devpolaris.example/public-ingress   <none>       24d
internal   platform.devpolaris.example/internal-edge    <none>       24d
```

For the DevPolaris progress API, outside users need the public edge, so the Ingress will use `ingressClassName: public`. A different internal admin API might use `ingressClassName: internal` and a private load balancer address. Same Kubernetes API shape, different controller ownership.

One more important detail belongs here. Kubernetes says the Ingress API is stable and frozen, while [Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/) is the recommended successor for newer, richer traffic management. Many production clusters still use Ingress every day, and new platform designs should know where Ingress fits and where Gateway API may be a stronger long-term platform choice.

There is also a 2026 controller footnote that matters for real production work. The Kubernetes project announced that the community-maintained `kubernetes/ingress-nginx` controller was retired in March 2026 in its [Ingress NGINX retirement announcement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/). That retirement applies to that controller project; the Ingress API itself remains supported and frozen. For new production work, the platform team should choose a maintained Ingress controller or a Gateway API implementation.

## Hosts, Paths, and Backend Services
<!-- section-summary: Ingress rules match HTTP hostnames and paths, then forward matching requests to named Service ports. -->

Now we can write the first useful route. The DevPolaris web app calls `https://api.devpolaris.example/progress/me`, and that path should reach the `progress-api` Service in the `learning` namespace. The Ingress lives in the same namespace as the backend Service, so the backend reference can use the local Service name.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: progress-api
  namespace: learning
spec:
  ingressClassName: public
  rules:
    - host: api.devpolaris.example
      http:
        paths:
          - path: /progress
            pathType: Prefix
            backend:
              service:
                name: progress-api
                port:
                  name: http
```

The `host` field matches the HTTP host that the browser sends. The `path` field matches the URL path. The backend points to the Service and a Service port. In this example, the backend uses the port name `http`, which matches the Service manifest from the previous section.

A named Service port is a useful contract. The application team can change the container from port `3000` to port `8080` by updating the Service `targetPort`, while the Ingress keeps pointing at the Service port named `http`. The edge route stays tied to the Service contract instead of a container detail.

`pathType` decides how path matching works. `Exact` matches one complete path. `Prefix` matches by path segments. `ImplementationSpecific` lets the controller decide the behavior. The official Ingress docs describe these path types, and a beginner-friendly default is to choose `Prefix` for route families such as `/progress`, `/progress/me`, and `/progress/history`.

| Request path | Rule path | `pathType` | Result |
|---|---|---|---|
| `/progress` | `/progress` | `Prefix` | Matches the progress API |
| `/progress/me` | `/progress` | `Prefix` | Matches the progress API |
| `/progress-history` | `/progress` | `Prefix` | No match as the same path segment |
| `/progress` | `/progress` | `Exact` | Matches the progress API |
| `/progress/me` | `/progress` | `Exact` | No match |

The path contract should match the application contract. If the public route is `/progress`, the cleanest backend application also serves routes under `/progress`. Some controllers can rewrite paths with annotations, such as stripping `/progress` before the request reaches the app. That can help with older apps, but it also adds controller-specific behavior that has to be tested during every migration.

**Annotations** are key-value metadata on a Kubernetes object. Controllers often read them as extra instructions. The Ingress API gives the shared fields, and controller annotations add implementation details. The Kubernetes Ingress docs note that controllers frequently use annotations for extra behavior, and those annotations belong to the controller's own documentation.

A legacy rewrite is a good side scenario. Maybe a profile service serves `/` inside the container, while the public route must be `/profile` because all APIs share `api.devpolaris.example`. A rewrite annotation can strip `/profile` before the request reaches the service. The production check should record the public path, the path the backend receives, and a `curl --resolve` test that proves the route still behaves the same after a controller upgrade.

A partner webhook gives another path choice. If a payment provider calls exactly `/webhooks/payments`, an `Exact` path can keep that endpoint separate from `/webhooks/payments/debug` or `/webhooks/payments/test`. The progress API still uses `Prefix` because it owns a whole route family, while the webhook route might use `Exact` because the partner contract names one endpoint.

## TLS at the Edge
<!-- section-summary: TLS lets the Ingress edge serve HTTPS for a hostname, usually by reading a certificate and private key from a Kubernetes Secret. -->

**TLS termination** means the edge accepts HTTPS, presents a certificate, decrypts the request, and then forwards the request toward the backend. In an Ingress setup, that edge is usually the Ingress controller or a cloud load balancer connected to it.

For the browser, the certificate must match the hostname. A request to `api.devpolaris.example` needs a certificate whose DNS names include `api.devpolaris.example`. That matching name tells the browser that the HTTPS connection is meant for the API hostname.

Kubernetes stores the certificate and private key in a TLS Secret. The Ingress `tls` block names the host and the Secret. The Secret must be in the same namespace as the Ingress. The Kubernetes API reference for [Ingress TLS](https://kubernetes.io/docs/reference/kubernetes-api/networking/ingress-v1/) also points out that Ingress TLS uses port 443 and can use SNI so different hosts can share the same TLS port when the controller supports it. **SNI**, or Server Name Indication, is the TLS handshake field where the client tells the edge which hostname it wants before HTTP routing starts.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: progress-api
  namespace: learning
spec:
  ingressClassName: public
  tls:
    - hosts:
        - api.devpolaris.example
      secretName: api-devpolaris-example-tls
  rules:
    - host: api.devpolaris.example
      http:
        paths:
          - path: /progress
            pathType: Prefix
            backend:
              service:
                name: progress-api
                port:
                  name: http
```

In real clusters, teams often use **cert-manager** to create and renew that Secret. cert-manager's [Ingress usage documentation](https://cert-manager.io/docs/usage/ingress/) explains that annotating an Ingress can let ingress-shim create a Certificate resource for the `tls.secretName`. The issuer might use Let's Encrypt for a public domain, or a company certificate authority for internal hosts.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: progress-api
  namespace: learning
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: public
  tls:
    - hosts:
        - api.devpolaris.example
      secretName: api-devpolaris-example-tls
  rules:
    - host: api.devpolaris.example
      http:
        paths:
          - path: /progress
            pathType: Prefix
            backend:
              service:
                name: progress-api
                port:
                  name: http
```

The important troubleshooting habit is to separate certificate readiness from backend readiness. A certificate error points to DNS, issuer, Secret, hostname, or controller TLS configuration. A `502` after a clean TLS handshake points farther inside the request path. The browser reports both as a broken API, but Kubernetes gives you different places to check.

## DNS and the Controller Address
<!-- section-summary: DNS sends the public hostname to the address exposed by the Ingress controller, and Ingress status shows what address the controller reports. -->

DNS is the bridge between the public hostname and the Ingress controller. A user types or the frontend calls `api.devpolaris.example`. DNS resolves that name to an IP address or cloud load balancer name. That target belongs to the controller's public entry point.

The Ingress object can show a reported address after the controller accepts it. In a cloud cluster, that address might come from a managed load balancer. In a local lab, the address might come from minikube tunnel, kind port mapping, or MetalLB. The exact source depends on the controller and environment, but the check is the same.

```bash
kubectl -n learning get ingress progress-api
```

```bash
NAME           CLASS    HOSTS                    ADDRESS          PORTS     AGE
progress-api   public   api.devpolaris.example   203.0.113.20     80, 443   3m
```

That `ADDRESS` value is what DNS should eventually point to. During a rollout, DNS may still point at the old edge, or it may still be cached by clients. A route can be correct in Kubernetes while public traffic keeps hitting a previous load balancer until DNS changes reach users.

A useful pre-DNS test is `curl --resolve`. It tells curl to use a specific IP address for a hostname, while still sending the correct Host header and validating the hostname path through TLS when certificates are ready. This lets the team test the new controller address before changing public DNS.

```bash
curl --resolve api.devpolaris.example:443:203.0.113.20 \
  https://api.devpolaris.example/progress/me
```

```json
{"userId":"u_123","completedLessons":42}
```

![Ingress rollout evidence chain showing TLS Secret, Ingress ADDRESS, DNS record, curl --resolve preflight, and HTTPS 200](/content-assets/articles/article-containers-orchestration-kubernetes-networking-ingress/ingress-tls-dns-rollout.png)

*A safe Ingress rollout proves the certificate, reported address, DNS target, and hostname request before relying on live public DNS.*

This check follows the same shape as a real browser request. It uses the public hostname, the public path, the controller address, TLS, the Ingress rule, the Service, and the Pods. That makes it much stronger than only curling a Pod IP or only reading the YAML.

## Rollout Checks for a New Ingress
<!-- section-summary: A safe Ingress rollout checks the internal Service, controller class, Ingress status, certificate readiness, and real HTTP response. -->

An Ingress rollout has several layers, so the checks move from inside to outside. The backend Service comes first because the edge route depends on it. The sequence then moves through the class and controller, the Ingress object and its address, TLS readiness, and a real request through the hostname.

The first check asks whether the Service has ready backends. An **EndpointSlice** is Kubernetes' modern record of the network endpoints behind a Service. The official [EndpointSlices documentation](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) explains that EndpointSlices track backend endpoint IP addresses and help Services scale to many backends. Empty endpoints usually mean the Service selector finds zero Pods, the Pods are still unready, or the app containers are failing readiness probes.

```bash
kubectl -n learning get endpointslice -l kubernetes.io/service-name=progress-api
```

```bash
NAME                 ADDRESSTYPE   PORTS   ENDPOINTS                     AGE
progress-api-x8mzs   IPv4          3000    10.244.2.18,10.244.3.41       12m
```

The next check asks whether the controller class exists and whether the controller is running. The class proves the Ingress can target a known controller. The controller Pods prove the edge software is alive.

```bash
kubectl get ingressclass public
kubectl -n edge-system get pods -l app=public-ingress-controller
```

```bash
NAME     CONTROLLER                                  PARAMETERS   AGE
public   platform.devpolaris.example/public-ingress   <none>       24d

NAME                                         READY   STATUS    RESTARTS   AGE
public-ingress-controller-7d9d5c7b9f-q8wtr   1/1     Running   0          24d
```

The object-level check is the Ingress itself. `kubectl describe ingress` shows the rules, backend, events, class, TLS Secret, and reported address. Events are especially useful because controllers often write warnings there when a Service or Secret cannot be found.

```bash
kubectl -n learning describe ingress progress-api
```

```bash
Rules:
  Host                    Path       Backends
  ----                    ----       --------
  api.devpolaris.example  /progress  progress-api:http (10.244.2.18:3000,10.244.3.41:3000)
TLS:
  api-devpolaris-example-tls terminates api.devpolaris.example
Events:
  Type    Reason  Age   From                      Message
  ----    ------  ----  ----                      -------
  Normal  Sync    45s   public-ingress-controller  Scheduled for sync
```

Certificate checks come next when HTTPS is part of the route. With cert-manager, the Certificate resource should become ready and the Secret should exist. A missing Secret or failed issuer challenge keeps HTTPS broken even when the backend app is healthy.

```bash
kubectl -n learning get certificate
kubectl -n learning get secret api-devpolaris-example-tls
```

```bash
NAME                         READY   SECRET                       AGE
api-devpolaris-example-tls   True    api-devpolaris-example-tls   2m
```

The final check sends a real request. A healthy response from the public hostname proves all the pieces work together. A failure at this last step means the team can walk back through the checks instead of guessing.

## Debugging by Following the Request
<!-- section-summary: Ingress debugging works best when each symptom gets mapped to DNS, TLS, controller routing, Service endpoints, NetworkPolicy, or application behavior. -->

Ingress failures can all look the same from the user's chair. The web app spins, the browser shows a network error, or the API returns a status code. Inside the cluster, those symptoms come from different layers. The fastest path is to follow the request in order.

The first layer is DNS when the client cannot connect to the expected address. `dig` or `nslookup` should show the hostname pointing at the controller's load balancer or IP. A wrong DNS answer can send the request to an old edge, a different cluster, or an address with no route at all.

```bash
dig +short api.devpolaris.example
kubectl -n learning get ingress progress-api
```

The next layer is TLS. A certificate name mismatch usually means the Secret contains the wrong certificate, the Ingress `tls.hosts` entry differs from the browser hostname, or DNS sends traffic to a different controller with a different default certificate. `openssl s_client` can show the certificate that the edge presents.

```bash
openssl s_client -connect api.devpolaris.example:443 \
  -servername api.devpolaris.example </dev/null
```

After TLS, the next question is whether the controller matched the rule. A `404` from the controller often means the host or path missed every Ingress rule. The request may use `api.devpolaris.example`, while the Ingress says `api.internal.devpolaris.example`. The request may use `/progress/me`, while the Ingress uses `Exact` on `/progress`.

A **NetworkPolicy** is a Kubernetes resource that controls allowed traffic to and from Pods when the cluster's network plugin enforces it. The official [Network Policies documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/) describes rules for ingress traffic into Pods and egress traffic leaving Pods. In our request path, a NetworkPolicy can allow the public controller Pods to reach `progress-api` while still blocking unrelated namespaces.

Backend errors move the investigation behind the rule. A `502` or `503` often means the controller matched the route but could not reach a healthy backend. The Service might have no endpoints, the Service port might point to the wrong target port, the Pods might be failing readiness, or a NetworkPolicy might block traffic from the controller namespace to the app namespace.

```bash
kubectl -n learning get svc progress-api
kubectl -n learning get endpointslice -l kubernetes.io/service-name=progress-api
kubectl -n learning get pods -l app=progress-api
kubectl -n learning describe pod -l app=progress-api
```

Application errors are the last layer. A clean `500` from the progress API means the edge path reached the app and the app handled the request badly. At that point, controller logs may show a successful upstream response, while application logs show the real failure.

```bash
kubectl -n edge-system logs deploy/public-ingress-controller --tail=100
kubectl -n learning logs deploy/progress-api --tail=100
```

This table maps the user-visible symptom to the layer that deserves attention next. The point is to keep each clue tied to one part of the request path instead of changing DNS, TLS, Service selectors, and application code all at once.

| Symptom | Likely layer | Useful check |
|---|---|---|
| Hostname resolves to the wrong place | DNS | Compare DNS answer with Ingress `ADDRESS` |
| Browser reports certificate mismatch | TLS | Inspect the certificate and Ingress `tls.hosts` |
| Controller returns `404` | Host or path rule | Check `host`, `path`, and `pathType` |
| Controller returns `502` or `503` | Backend routing | Check Service port, EndpointSlices, Pods, NetworkPolicy |
| App returns `500` | Application | Check app logs, traces, and upstream dependencies |

![Ingress debugging summary mapping wrong DNS, TLS mismatch, route 404, backend 502 or 503, and app 500 to the next layer to inspect](/content-assets/articles/article-containers-orchestration-kubernetes-networking-ingress/ingress-debugging-summary.png)

*The user sees one broken request, but DNS, TLS, route matching, backend reachability, and application errors each leave different evidence.*

This style of debugging keeps the layers separate. It also gives a clean incident timeline: DNS was correct, TLS was correct, the controller matched the rule, the Service had no ready endpoints, and the Deployment rollout caused the endpoints to disappear. That story is much easier to fix than "Ingress is broken."

## Production Ownership and Tradeoffs
<!-- section-summary: Ingress works well when teams agree who owns the shared controller, route contracts, TLS, annotations, DNS, and migration path. -->

Ingress is a shared edge, so ownership has to be clear. The platform team usually owns the controller installation, controller upgrades, cloud load balancer settings, default certificates, controller logs, shared security policy, and DNS handoff. Application teams usually own their Ingress rules, Services, readiness probes, application paths, and tests for public routes.

That split matters during changes. If the progress team changes `/progress` to `/learning-progress`, they own the client contract and the Ingress path update. If the platform team changes from one controller to another, they own annotation compatibility, timeout behavior, allowed body size, logging format, and migration checks.

Annotations deserve special attention. They are how many controllers expose features beyond the standard Ingress fields, such as request timeouts, path rewrites, request body limits, rate limiting, authentication, or custom headers. Those settings can be necessary, but they are tied to the selected controller. A production review should list every annotation, why it exists, which controller supports it, and what test proves it still works.

The controller migration workflow should be concrete. Export every Ingress, list every annotation, group annotations by feature, find the equivalent in the new controller or Gateway API, and write one request test for every host and path. During the cutover, `curl --resolve` can send traffic to the new controller address before DNS moves. After the cutover, controller logs and application logs should show the same status codes, response headers, and backend routes that the old controller produced.

Security also lives across several layers. TLS protects the client-to-edge connection. NetworkPolicy can restrict which Pods the controller may reach. The app still needs authentication and authorization for user actions. Ingress routing gets the HTTP request to the right Service; user permission checks stay inside the application and its identity system.

The production review for the DevPolaris progress route can use a simple checklist. Each row names one owner-facing question, and together the rows describe the whole path from public hostname to ready Pods.

| Area | Question to answer |
|---|---|
| Controller | Which IngressClass owns this route, and who operates that controller? |
| DNS | Which record points `api.devpolaris.example` to the controller address? |
| TLS | Which Secret contains the certificate, and how does it renew? |
| Route | Which host and path are public API contracts? |
| Backend | Which Service port receives the request, and which Pods are ready? |
| Policy | Which NetworkPolicies allow controller-to-backend traffic? |
| Observability | Which logs, metrics, and alerts show edge errors and backend errors separately? |
| Migration | Which annotations or behaviors would change under another controller or Gateway API? |

This is also where Gateway API enters the conversation. The Kubernetes project recommends Gateway API as the successor to Ingress for newer traffic management needs. Ingress remains common and stable, and Gateway API gives platform teams a richer model for listeners, routes, cross-namespace attachment, and shared gateway ownership. The next article can build on this Ingress path and show how Gateway API separates those responsibilities more explicitly.

## What's Next

Ingress gives Kubernetes HTTP workloads a practical public entry point. It maps a hostname and path to a Service, and the Ingress controller turns that rule into real edge behavior. Once that request path makes sense, Gateway API is the next step because it expands the same idea into a more expressive platform model for modern traffic routing.

---

**References**

- [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - The official Kubernetes concept page for Ingress resources, host/path routing, TLS, and the frozen API status.
- [Ingress Controllers](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/) - The official list and explanation of controllers that implement Ingress behavior.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - The official Kubernetes explanation of Services as stable access points for Pods.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - The official explanation of how Kubernetes tracks Service backends at scale.
- [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - The official Kubernetes concept page for pod traffic rules.
- [Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/) - The official Kubernetes successor model for richer traffic routing.
- [Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) - The Kubernetes project announcement for the community `kubernetes/ingress-nginx` controller retirement.
- [cert-manager Ingress usage](https://cert-manager.io/docs/usage/ingress/) - cert-manager's official guide for creating certificates from annotated Ingress resources.

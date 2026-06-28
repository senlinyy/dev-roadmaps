---
title: "Network Isolation"
description: "Limit Kubernetes pod-to-pod, namespace, ingress, and egress traffic with NetworkPolicy and clear workload labels."
overview: "Follow one frontend pod calling one checkout API pod. Then trace default pod networking, namespaces, NetworkPolicy selectors, default deny, allowed app paths, DNS and egress, rollout without outage, denied-traffic debugging, and NetworkPolicy limits."
tags: ["network-policy", "kubernetes", "networking", "cni", "firewalls"]
order: 3
id: article-devsecops-kubernetes-security-network-isolation
aliases:
  - network-policies
  - article-devsecops-kubernetes-security-network-policies
  - devsecops/kubernetes-security/network-policies.md
  - devsecops/kubernetes-security/03-network-isolation.md
  - devsecops/kubernetes-security/03-network-isolation
  - kubernetes-security/03-network-isolation
---

## Table of Contents

1. [The Open Cluster Network](#the-open-cluster-network)
2. [Default Pod Networking](#default-pod-networking)
3. [Why Namespaces Still Need Policies](#why-namespaces-still-need-policies)
4. [How NetworkPolicy Selects Traffic](#how-networkpolicy-selects-traffic)
5. [Build Default-Deny Isolation](#build-default-deny-isolation)
6. [Allow the Application Paths](#allow-the-application-paths)
7. [DNS and Egress Rules](#dns-and-egress-rules)
8. [Roll Out Policies Without an Outage](#roll-out-policies-without-an-outage)
9. [Debug Denied Traffic](#debug-denied-traffic)
10. [Know the Limits](#know-the-limits)
11. [What's Next](#whats-next)
12. [References](#references)

## The Open Cluster Network
<!-- section-summary: Kubernetes starts with an open pod network, so a single compromised pod can reach more than the team expects. -->

A public request reaches one frontend pod, and that frontend pod calls the `checkout-api` Service on TCP `8080`. The checkout API then writes an order to PostgreSQL on TCP `5432`. All three workloads run as pods, and the frontend reaches the API through a Kubernetes Service name such as `checkout-api.prod.svc.cluster.local`.

That setup sounds simple, and it is a normal way to run applications. The risky part appears during an incident. A developer starts a temporary debug pod in a `tools` namespace to test connectivity. Later, that debug image contains a vulnerable package, or someone gets shell access inside it. With Kubernetes defaults, that debug pod can often try to connect to the checkout API, the database Service, and any other pod IP it can discover.

**Network isolation** means the cluster network only allows the traffic your application actually needs. The frontend should call the checkout API. The checkout API should call the database. The database should accept traffic only from the checkout API. Pods should be able to use DNS because Service discovery depends on it. A random debug pod should have no path into the checkout flow.

Kubernetes expresses this kind of isolation with **NetworkPolicy** objects. A NetworkPolicy is a namespaced Kubernetes resource that selects pods and lists the network traffic allowed to or from those pods. The standard policy works at the connection level: pod labels, namespace labels, IP blocks, protocols, and ports.

![NetworkPolicy boundary showing frontend traffic allowed to checkout-api, checkout-api allowed to postgres and DNS, and a debug pod denied](/content-assets/articles/article-devsecops-kubernetes-security-network-isolation/network-policy-boundary.png)

*The boundary picture shows the goal before the YAML: keep the real checkout path open, keep DNS working, and keep an unrelated debug pod out of the application path.*

Before writing policy, we need to look at what Kubernetes allows by default.

## Default Pod Networking
<!-- section-summary: Pods are designed to communicate across nodes and namespaces, and Services give them stable names for changing backends. -->

Kubernetes gives each pod its own IP address. The cluster network is built so pods can communicate with other pods across nodes. This is part of the Kubernetes networking model: a pod should be able to reach another pod without the application doing special network address translation work.

A **Pod** is the smallest deployable runtime unit in Kubernetes. It usually holds one application container, sometimes with helper containers beside it. A **Service** gives a stable virtual address and DNS name to a changing set of pods. For example, the checkout API Deployment may create pods with changing names like `checkout-api-7c9d7d6f8c-2p8kl`, while the Service stays reachable as `checkout-api`.

That matters for security because application code usually talks to Services, while NetworkPolicy selects pods. When the frontend sends a request to `http://checkout-api:8080`, Kubernetes service routing sends that request to one of the API pods. The NetworkPolicy decision still cares about the source pod, destination pod, namespace labels, and port.

Here is the checkout flow we will protect:

```yaml
namespace: prod

frontend:
  labels:
    app: frontend
    tier: web
  talks to:
    - checkout-api on TCP 8080

checkout-api:
  labels:
    app: checkout-api
    tier: api
  talks to:
    - postgres on TCP 5432
    - kube-dns on UDP/TCP 53

postgres:
  labels:
    app: postgres
    tier: data
  accepts traffic from:
    - checkout-api on TCP 5432
```

With no NetworkPolicy in the namespace, Kubernetes allows all ingress and egress for pods. The frontend can reach the API, the API can reach the database, and the debug pod can try those same paths. The cluster has useful connectivity, but the blast radius is too large.

The next natural question is whether putting the debug pod in a different namespace protects the application.

## Why Namespaces Still Need Policies
<!-- section-summary: Namespaces organize Kubernetes objects, but pod traffic still crosses namespace boundaries until policy restricts it. -->

A **namespace** is a Kubernetes scope for names and administration. Teams use namespaces to separate environments, teams, or applications. A `prod` namespace can hold the checkout system, while a `tools` namespace can hold temporary debugging utilities.

Namespaces help with RBAC, quotas, naming, and cleanup. RBAC controls who can read or change Kubernetes API objects. Resource quotas limit how much CPU, memory, and object count a namespace can consume. Those are important boundaries, but pod network traffic still needs its own rules.

In our checkout system, this command creates a temporary shell in the `tools` namespace:

```bash
kubectl create namespace tools
kubectl run debug-shell \
  -n tools \
  --rm -it \
  --restart=Never \
  --image=busybox:1.36 \
  -- sh
```

Inside that shell, this request uses Kubernetes DNS to find the checkout API in the `prod` namespace:

```bash
wget -S -T 2 -O- http://checkout-api.prod.svc.cluster.local:8080/health
```

Example output in an open namespace might include an HTTP `200` response:

```bash
HTTP/1.1 200 OK
ok
```

If the cluster has no NetworkPolicy protecting the checkout pods, that request may reach the API. The debug pod lives in another namespace, but the network remains open. So the fix is to label the workloads and write policies that allow the real application path while leaving the debug namespace outside the allowed path.

NetworkPolicy uses selectors for that job.

## How NetworkPolicy Selects Traffic
<!-- section-summary: NetworkPolicy starts by selecting destination pods, then adds allowed ingress and egress peers with labels and ports. -->

A NetworkPolicy has two parts that beginners should separate.

The first part is `spec.podSelector`. This chooses the pods the policy protects. An empty selector, `podSelector: {}`, means all pods in the policy's namespace. A selector such as `app: checkout-api` means only pods in the same namespace with that label.

The second part is the allowed traffic. **Ingress** means traffic entering the selected pods. **Egress** means traffic leaving the selected pods. A policy can control ingress, egress, or both. When a policy selects a pod for ingress, only the listed ingress sources can connect to that pod. When a policy selects a pod for egress, only the listed egress destinations can receive traffic from that pod.

NetworkPolicy rules are **additive**. Standard Kubernetes NetworkPolicy has allow rules. If two policies select the same pod, Kubernetes combines the allowed traffic from both. If an older policy already allows traffic, that traffic remains allowed until that broad policy changes. This is why teams usually start with a default-deny policy and then add small allow policies for each real path.

Selectors decide who is allowed. A `podSelector` inside `from` or `to` matches pods in the same namespace as the policy. A `namespaceSelector` matches namespaces by label. You can combine them when you want pods with a certain label inside namespaces with a certain label.

This peer matches frontend pods inside namespaces labeled `environment=prod`:

```yaml
from:
  - namespaceSelector:
      matchLabels:
        environment: prod
    podSelector:
      matchLabels:
        app: frontend
```

That single list item means both selectors must match. This next shape means something broader because it has two list items:

```yaml
from:
  - namespaceSelector:
      matchLabels:
        environment: prod
  - podSelector:
      matchLabels:
        app: frontend
```

The first item allows all pods in namespaces labeled `environment=prod`. The second item allows local frontend pods in the policy namespace. The indentation changes the meaning, so review selector shape carefully during code review.

![NetworkPolicy selector logic comparing a combined peer where namespace and pod labels must both match with split peers where either selector can allow traffic](/content-assets/articles/article-devsecops-kubernetes-security-network-isolation/network-policy-selector-logic.png)

*Combined selectors narrow access to pods that match both conditions. Split peer entries widen access because each list item can allow a separate group.*

Namespace labels make these policies practical. Kubernetes adds a `kubernetes.io/metadata.name` label to namespaces, and teams often add their own labels too:

```bash
kubectl label namespace prod environment=prod
kubectl label namespace tools purpose=debug
kubectl get namespace --show-labels
kubectl get pods -n prod --show-labels
```

Now we can protect the checkout system in a way that matches the application flow.

## Build Default-Deny Isolation
<!-- section-summary: A default-deny policy changes the namespace from open traffic to explicit allow traffic. -->

The first policy selects every pod in the `prod` namespace and gives it no allowed ingress or egress. This creates a closed starting point for both inbound and outbound traffic.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Apply it in a test namespace first:

```bash
kubectl apply -f default-deny-all.yaml
kubectl get networkpolicy -n prod
kubectl describe networkpolicy -n prod default-deny-all
```

Example output:

```bash
networkpolicy.networking.k8s.io/default-deny-all created
NAME               POD-SELECTOR   AGE
default-deny-all   <none>         5s
```

`podSelector: {}` prints as `<none>` in this command output because the selector is empty. In NetworkPolicy, that empty selector means every pod in the namespace is selected.

After this policy takes effect, the selected pods need allow policies for every required path. The frontend needs a path to the checkout API. The checkout API needs a path to the database. All application pods need DNS egress because Service names depend on DNS. If the frontend receives traffic from an Ingress controller, the frontend also needs an ingress allow rule from that controller's namespace and pods.

The default-deny policy is valuable because a compromised debug pod has no special exception. It can still exist in the cluster, but the checkout namespace only accepts the paths we add next.

## Allow the Application Paths
<!-- section-summary: Each allow policy should match one real production path so reviews can connect YAML to application behavior. -->

Start with the frontend-to-API path. Because the default-deny policy isolated egress and ingress, the frontend needs egress permission to the API, and the API needs ingress permission from the frontend.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-egress-to-checkout-api
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: checkout-api
      ports:
        - protocol: TCP
          port: 8080
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-checkout-api-ingress-from-frontend
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: checkout-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

Now the frontend can call the API Service on TCP 8080, and the API accepts that traffic only from pods labeled `app=frontend` in the same namespace. The debug pod in `tools` has neither the namespace nor the pod label path needed to enter.

Next, allow the checkout API to reach PostgreSQL. The API gets egress to database pods on TCP 5432, and database pods accept ingress from the API on the same port.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-checkout-api-egress-to-postgres
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: checkout-api
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-postgres-ingress-from-checkout-api
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: checkout-api
      ports:
        - protocol: TCP
          port: 5432
```

This is the part that contains blast radius during an incident. If an attacker gets shell access in the frontend pod, they can reach the API path the frontend already needed, but they do not receive a direct database path from these policies. If an attacker gets shell access in the debug pod, it has no allow rule into the API or database.

For traffic from an Ingress controller to the frontend, use both a namespace selector and a pod selector. The exact labels depend on the controller you run, so verify them before applying the policy:

```bash
kubectl get namespace ingress-nginx --show-labels
kubectl get pods -n ingress-nginx --show-labels
```

Example shape:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-controller-to-frontend
  namespace: prod
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
          podSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3000
```

At this point, the application path exists, but something surprising may fail: Service names.

## DNS and Egress Rules
<!-- section-summary: Egress default deny blocks DNS unless the namespace allows pods to reach the cluster DNS service. -->

Kubernetes DNS lets pods use names instead of raw IP addresses. A pod in the `prod` namespace can usually resolve `checkout-api` to the Service in the same namespace, or `checkout-api.prod.svc.cluster.local` from another namespace. That DNS query goes to the cluster DNS service, commonly backed by CoreDNS pods in the `kube-system` namespace.

When you deny egress by default, DNS traffic needs an allow rule. Without it, the frontend may fail before it even tries to connect to the checkout API because Service name resolution fails first.

First inspect your cluster DNS labels:

```bash
kubectl get svc -n kube-system kube-dns
kubectl get pods -n kube-system --show-labels
```

Many clusters label CoreDNS pods with `k8s-app=kube-dns`, but managed clusters can differ. Adapt the selectors to the labels your cluster uses.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: prod
spec:
  podSelector: {}
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

DNS uses UDP for most lookups and TCP for larger responses and retries. Allow both. This policy selects every pod in `prod`, but it only allows egress to DNS pods on port 53. Database traffic, API traffic, and public internet traffic still need their own explicit policies.

Egress rules need special attention in production. Some applications call payment providers, object storage endpoints, package registries, or identity providers. Standard NetworkPolicy can allow CIDR ranges with `ipBlock`, but external service IPs can change. For stable external controls, many teams combine NetworkPolicy with an egress gateway, firewall, proxy, or service mesh policy. Keep the Kubernetes policy small and honest: allow internal pod paths with labels, then handle large external destinations with tooling that can observe and manage those exits.

Now we have policies. The next challenge is rolling them out without breaking checkout.

## Roll Out Policies Without an Outage
<!-- section-summary: Safe rollout starts with traffic inventory, labels, test namespaces, and small allow rules before enforcing in production. -->

A practical rollout starts with inventory. List the Services, pods, and labels in the namespace:

```bash
kubectl get deploy,svc,pods -n prod --show-labels
kubectl get endpointslice -n prod
```

Then write down each required flow in plain language:

| Source | Destination | Port | Why it exists |
|---|---:|---:|---|
| Ingress controller | frontend | TCP 3000 | Receives public web traffic |
| frontend | checkout-api | TCP 8080 | Sends checkout requests |
| checkout-api | postgres | TCP 5432 | Stores orders |
| all app pods | kube-dns | UDP/TCP 53 | Resolves Service names |

Apply the policies in a development or staging namespace with the same labels first. Run the actual checkout smoke test there. A smoke test is a small end-to-end check that proves the main path still works, such as loading the checkout page and placing a test order.

For production, use a short change window and apply the complete set together: default deny, application allow policies, DNS allow policy, and the ingress-controller allow policy if the service receives public traffic. Because NetworkPolicy rules are additive, leaving a broad temporary allow policy in place can hide mistakes. Review for broad rules such as `podSelector: {}` with open egress, or a namespace selector that allows every pod from a shared tools namespace.

After rollout, watch application metrics and CNI-level network drops if your plugin exposes them. Kubernetes stores the NetworkPolicy objects, but the network plugin enforces them. Clusters need a NetworkPolicy-capable plugin before these resources affect traffic. Verify plugin support before treating policy as a control, and run a real denial test from the `tools` namespace.

That denial test leads directly into debugging.

## Debug Denied Traffic
<!-- section-summary: Debugging starts with labels and selected policies, then tests DNS, Service endpoints, and source-to-destination paths. -->

When a request fails after adding NetworkPolicy, debug it in the same order Kubernetes makes the decision: selected pods, labels, direction, peer selectors, ports, and DNS.

Start with the policies and labels:

```bash
kubectl get networkpolicy -n prod
kubectl describe networkpolicy -n prod allow-checkout-api-ingress-from-frontend
kubectl get pods -n prod --show-labels
kubectl get namespace --show-labels
```

Check the Service and its endpoints. A Service with no ready backend pods will still fail even when the policies are correct:

```bash
kubectl get svc -n prod checkout-api postgres
kubectl get endpointslice -n prod
```

Test DNS from a pod that should be allowed to make normal application calls:

```bash
kubectl run dns-test \
  -n prod \
  --rm -it \
  --restart=Never \
  --image=registry.k8s.io/e2e-test-images/agnhost:2.39 \
  --labels='app=frontend,tier=web' \
  -- nslookup checkout-api.prod.svc.cluster.local
```

Test the intended application path from a pod with the frontend labels:

```bash
kubectl run frontend-net-test \
  -n prod \
  --rm -it \
  --restart=Never \
  --image=busybox:1.36 \
  --labels='app=frontend,tier=web' \
  -- sh
```

Inside the shell:

```bash
wget -S -T 2 -O- http://checkout-api:8080/health
```

Then test the path that should be blocked, using a debug pod in the `tools` namespace:

```bash
kubectl run debug-shell \
  -n tools \
  --rm -it \
  --restart=Never \
  --image=busybox:1.36 \
  -- sh
```

Inside that shell:

```bash
wget -S -T 2 -O- http://checkout-api.prod.svc.cluster.local:8080/health
nc -vz -w 2 postgres.prod.svc.cluster.local 5432
```

The frontend-labeled test should reach the API. The tools debug pod should time out or fail. If the debug pod succeeds, inspect broad policies, namespace labels, and any egress allow rules that accidentally include `tools`.

For CNI-specific drops, use the plugin's own observability tools. Kubernetes defines the NetworkPolicy resource, while the network plugin handles enforcement and logging. That split is important during debugging because `kubectl describe networkpolicy` tells you what Kubernetes stored, and the CNI tells you what happened on the wire.

## Know the Limits
<!-- section-summary: NetworkPolicy is useful segmentation, but it works best with identity, runtime hardening, admission control, and plugin-specific visibility. -->

NetworkPolicy gives Kubernetes a strong baseline for pod segmentation. It keeps the frontend, API, database, DNS, ingress controller, and debug tooling in separate network paths. It also gives reviewers a concrete YAML file they can compare to the production architecture.

There are still limits to remember.

Standard NetworkPolicy focuses on layer 3 and layer 4 traffic: IPs, pod and namespace selectors, protocols, and ports. Application-layer controls still handle HTTP routes, GraphQL operations, SQL users, and application permissions. The checkout API still needs authentication and authorization. The database still needs users, passwords, TLS, backups, and audit logs.

NetworkPolicy enforcement depends on the cluster network plugin. The Kubernetes API server accepts NetworkPolicy objects, but plugins such as your managed cloud CNI, Cilium, Calico, or another implementation decide whether and how traffic is enforced. If your cluster plugin has extra policy features, read that plugin's docs before using them because they go beyond the portable Kubernetes NetworkPolicy behavior.

`ipBlock` rules are useful for external CIDR ranges, but pod IPs are temporary and should stay behind pod selectors. If a pod restarts, its IP can change. Labels are the stable handle Kubernetes gives you for workload identity at the network policy layer.

Network isolation also works best with the security controls from the rest of this module. RBAC controls who can create or change policies. Pod security settings reduce what a compromised container can do. Admission control can reject unsafe manifests before they start. NetworkPolicy then limits where a running workload can connect.

![NetworkPolicy rollout lane showing observe traffic, label pods, default deny, add allow rules, test paths, and keep evidence](/content-assets/articles/article-devsecops-kubernetes-security-network-isolation/network-policy-rollout.png)

*The rollout summary keeps the work operational: inventory first, labels second, default deny only after the needed paths are known, then tests and evidence so the next change is reviewable.*

## What's Next

NetworkPolicy protects traffic after pods exist. The next article moves one step earlier in the request path: the Kubernetes API server.

Admission control and policy engines help the cluster reject risky manifests before they become running workloads. That is where rules like "no privileged pods," "only approved registries," and "NetworkPolicy required for production namespaces" can be checked automatically.

---

## References

- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Defines NetworkPolicy behavior, pod isolation, ingress and egress rules, selectors, additive policies, `ipBlock`, and plugin enforcement requirements.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Explains how Services provide stable networking for changing pod backends.
- [Kubernetes Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) - Explains how namespaces scope Kubernetes objects and help divide cluster resources.
- [Kubernetes DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Documents Service DNS names and pod DNS behavior.
- [Kubernetes Cluster Networking](https://kubernetes.io/docs/concepts/cluster-administration/networking/) - Describes the Kubernetes pod networking model and network plugin role.
- [Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/) - Shows official DNS debugging patterns using test pods and `nslookup`.

---
title: "Network Isolation"
description: "Isolate pod-to-pod and namespace traffic using declarative Kubernetes NetworkPolicies and dynamic label-based routing."
overview: "Kubernetes default-allow networks expose clusters to lateral exploitation. This article explains default-deny baselines, namespace boundaries, CNI enforcement, and dynamic label-based traffic rules."
tags: ["network-policy", "kubernetes", "networking", "cni", "firewalls"]
order: 3
id: article-devsecops-kubernetes-security-network-isolation
aliases:
  - network-policies
  - article-devsecops-kubernetes-security-network-policies
  - devsecops/kubernetes-security/network-policies.md
---

## Table of Contents

1. [The Default-Allow Risk in Container Networks](#the-default-allow-risk-in-container-networks)
2. [Anatomy of a Lateral Network Compromise](#anatomy-of-a-lateral-network-compromise)
3. [Closing the Perimeter: The Default-Deny Namespace Policy](#closing-the-perimeter-the-default-deny-namespace-policy)
4. [Securing Ingress: Dynamic Label-Based Allow Rules](#securing-ingress-dynamic-label-based-allow-rules)
5. [Securing Egress: Scoping Outbound Connections and the DNS Trap](#securing-egress-scoping-outbound-connections-and-the-dns-trap)
6. [Testing Traffic Isolation with Diagnostic Pods](#testing-traffic-isolation-with-diagnostic-pods)
7. [CNI Provider Enforcement and Common Policy Gotchas](#cni-provider-enforcement-and-common-policy-gotchas)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Default-Allow Risk in Container Networks

In a traditional physical network, virtual machines and servers are separated by default using distinct virtual subnets, hardware routers, and firewall appliances. If a server needs to talk to another server, network administrators must explicitly configure a routing path and open specific ports.

Kubernetes structures container networking in the exact opposite direction. By default, the cluster's network fabric operates on a **Default-Allow** model. The Kubernetes networking model mandates that every pod in a cluster receives its own unique IP address, and that every pod can communicate with any other pod across any namespace boundary without any firewall restrictions.

This default-allow architecture was designed for developer convenience, allowing microservices to discover and communicate with one another immediately without network friction. However, from a security perspective, default-allow represents an immense risk. 

If an attacker compromises a single public-facing container, the flat cluster network provides them with an open highway. They can scan the entire internal cluster IP space, connect to unauthenticated internal caches, probe database endpoints, or extract metadata from system services running in other namespaces, bypassing all namespace boundaries at the network layer.

## Anatomy of a Lateral Network Compromise

To understand why network-level isolation is a critical control, we must trace how an attacker exploits a default-allow network to execute a lateral network compromise. Consider a common multi-tier application deployment that runs into a silent vulnerability.

An engineering team deploys a public developer blog container in the same cluster as their production transaction database. Because the blog is a non-critical utility, it is run with low operational oversight in a shared namespace. The transaction database is deployed securely in a separate database namespace, locked down behind strict administrative credentials.

An attacker discovers an unpatched remote execution vulnerability inside the blog's content manager. They send a payload that spawns a reverse shell session inside the blog container.

Because the cluster network uses a default-allow topology, the attacker uses the blog pod to execute a quick port scan across the entire private cluster network range (`10.244.0.0/16`). Bypassing the namespace boundary completely, the scan immediately discovers the transaction database pod running in its separate namespace on port 5432.

The attacker connects to the database endpoint using standard command line tools. Because the network allows direct access, the attacker executes a brute-force script against the database password, compromises the database, and downloads millions of private user records directly through the compromised blog container.

This lateral security compromise demonstrates that the primary architectural failure was not the vulnerability inside the developer blog, but the flat, unisolated default-allow network. Had the namespaces been separated by network boundaries, the blog container would have been physically blocked from establishing a connection to the database pod, halting the attack at the network boundary.

## Closing the Perimeter: The Default-Deny Namespace Policy

Hardening cluster networks requires transitioning from a default-allow model to a Zero Trust default-deny model. In Kubernetes, we achieve this by defining a **NetworkPolicy** resource.

A NetworkPolicy is a declarative rule set that selects a group of pods and defines what network traffic (Ingress for incoming, Egress for outgoing) is permitted. When a policy selects a pod, that pod becomes isolated. The network fabric immediately drops all packets targeting or leaving the pod, except for traffic that explicitly matches your allow rules.

To secure a namespace, the first step is to apply a global **Default-Deny** policy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: orders-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

This configuration secures the namespace using three critical mechanics:
* **Global Pod Selection**: The `podSelector: {}` is defined as empty. In Kubernetes, an empty selector matches every single pod inside the namespace (`orders-prod`).
* **Dual-Direction Isolation**: `policyTypes` explicitly includes both `Ingress` and `Egress`. This tells the network plugin to apply traffic isolation to both incoming and outgoing connections for every selected pod.
* **No Allow Rules**: Because the `spec` contains no `ingress` or `egress` block, no connections are allowed. 

Applying this policy is the network equivalent of shutting and locking every door. Every container in the namespace is completely isolated, preventing any inbound or outbound connections until we explicitly declare our allowed pathways.

## Securing Ingress: Dynamic Label-Based Allow Rules

Once a default-deny baseline is established, we must systematically open specific, secure pathways for our applications. Because Kubernetes container IPs are highly transient—changing every time a pod restarts, scales, or migrates to a different host node—we must never define access rules using static IP addresses.

Instead, NetworkPolicies define allow rules using dynamic **Label Selectors**. The network plugin queries the API Server to resolve these labels in real-time, automatically updating the underlying firewall rules as pods scale.

Consider a secure NetworkPolicy designed to allow frontend web pods to call the `orders-api` container:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-to-orders-api
  namespace: orders-prod
spec:
  podSelector:
    matchLabels:
      app: orders-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: web-frontend
      ports:
        - protocol: TCP
          port: 8080
```

This manifest structures ingress routing using three logical layers:
* **The Protected Target**: The top-level `spec.podSelector` selects pods labeled `app: orders-api`. The ingress rules defined in the policy apply exclusively to these containers.
* **The Allowed Source**: The `ingress.from.podSelector` chooses the permitted callers. This policy permits incoming connections *only* from pods labeled `app: web-frontend` within the same namespace.
* **The Explicit Port**: The `ports` block narrows access exclusively to TCP port 8080. Any attempt by a web frontend pod to connect on a different port (such as SSH port 22 or debugging ports) is automatically dropped.

By implementing this policy, you guarantee that even if an attacker compromises a random pod in the namespace, the network plugin will block any network packets they send to the `orders-api` container.

## Securing Egress: Scoping Outbound Connections and the DNS Trap

Isolating inbound connections (Ingress) is critical. However, we must also secure outbound connections (Egress). Restricting egress prevents a compromised container from establishing dynamic reverse-shell callbacks, communicating with malicious command-and-control servers, or exfiltrating data to external databases.

When configuring egress policies, engineers commonly run into a severe beginner gotcha known as the **DNS Bootstrap Trap**. 

A default-deny policy blocks all egress traffic. If an engineer writes a database egress rule allowing connections to the database on port 5432, but forgets to configure a DNS rule, the application will crash. This happens because the application attempts to resolve the database's domain name (like `orders-db.svc.cluster.local`) by connecting to the cluster's internal DNS resolver (`kube-dns`). Because all egress is blocked, the DNS request times out, preventing the application from ever finding the database IP.

To avoid this, every egress policy must explicitly allow DNS resolution. Consider a secure egress policy configured for the `orders-api`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-orders-api-egress
  namespace: orders-prod
spec:
  podSelector:
    matchLabels:
      app: orders-api
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
    - to:
        - podSelector:
            matchLabels:
              app: orders-db
      ports:
        - protocol: TCP
          port: 5432
```

This egress policy defines two distinct allowed destinations:

First, **Internal DNS Resolution**. The policy allows outbound traffic to pods labeled `k8s-app: kube-dns` residing inside the `kube-system` namespace. Access is granted on port 53 (UDP for standard queries and TCP for larger payloads).

Second, **Scoped Database Connections**. The policy allows outbound connections exclusively to same-namespace database pods labeled `app: orders-db` on TCP port 5432.

By combining namespace-scoped DNS and workload selectors, you build a secure network egress perimeter:

```mermaid
flowchart LR
    subgraph orders-prod["orders-prod Namespace"]
        App["Orders API Pod<br/>(app: orders-api)"]
        DB["Database Pod<br/>(app: orders-db)"]
    end
    subgraph kube-system["kube-system Namespace"]
        DNS["kube-dns Pod<br/>(k8s-app: kube-dns)"]
    end
    App -->|1. DNS Query (UDP port 53)| DNS
    App -->|2. Scoped Ingress (TCP port 5432)| DB
    App -.->|3. Blocked Outbound Callback| MaliciousServer["Internet (Command & Control)"]
```

This architectural design ensures that the `orders-api` container can safely resolve domains and connect to its database, while any attempt to establish an outbound connection to an unauthorized external IP or command-and-control server is immediately dropped by the network plugin.

## Testing Traffic Isolation with Diagnostic Pods

Once NetworkPolicies are applied, we must programmatically verify that the network boundaries are enforced correctly. Rather than assuming the configuration is active, we spin up temporary diagnostic pods to run connection verification tests.

First, we test an **Allowed Path**. We launch a temporary diagnostic pod labeled `app: web-frontend` inside our target namespace and attempt to curl the application endpoint:

```bash
$ kubectl run diagnostic-web \
  -n orders-prod \
  --image=curlimages/curl:8.8.0 \
  --labels app=web-frontend \
  --restart=Never \
  -- sleep 3600

$ kubectl exec -n orders-prod diagnostic-web -- \
  curl -sS -m 3 http://orders-api:8080/healthz
ok
```

This successful response confirms that the allowed ingress rule is active and matches the frontend labels.

Second, we test a **Blocked Path**. We spin up an identical diagnostic pod but assign an unauthorized label (`app: random-worker`), then attempt to connect to the same API endpoint:

```bash
$ kubectl run diagnostic-blocked \
  -n orders-prod \
  --image=curlimages/curl:8.8.0 \
  --labels app=random-worker \
  --restart=Never \
  -- sleep 3600

$ kubectl exec -n orders-prod diagnostic-blocked -- \
  curl -sS -m 3 http://orders-api:8080/healthz
curl: (28) Connection timed out after 3001 milliseconds
```

The request times out. This timeout is a critical verification indicator: the network plugin is dropped the packet quietly at the packet level, preventing the unauthorized sender from establishing a TCP handshake. Include both positive and negative connection tests in your automation pipelines to verify the cluster's network boundaries continuously.

## CNI Provider Enforcement and Common Policy Gotchas

When managing NetworkPolicies, engineers must understand a fundamental architectural property of the Kubernetes API Server: **The API Server is not a firewall**.

The API Server simply accepts your NetworkPolicy manifests and stores them in etcd. It is the responsibility of the cluster's active **Container Network Interface (CNI)** plugin (such as Calico, Cilium, or Flannel) to watch the API Server and enforce the firewall rules at the Linux kernel level.

This decoupling introduces three significant gotchas:

* **The Silent Enforcement Gotcha**: If your cluster is running an unhardened, basic network provider (like Flannel) that does not support NetworkPolicies, you can apply your NetworkPolicy manifests successfully with no errors. However, because the plugin does not enforce rules, the flat default-allow network remains wide open, exposing your workloads. Always verify that your CNI provider actively supports NetworkPolicy enforcement.
* **The Label Mismatch Gotcha**: Because NetworkPolicies map relationships using label selectors, a small typo in a pod label (such as `app: orders-db-prod` in the manifest and `app: orders-db` in the policy) will cause the policy to fail to match, locking down the path and causing silent connection errors.
* **The Additive Behavior Gotcha**: NetworkPolicies are strictly additive. If you apply multiple policies that select the same pod, the CNI provider merges the allow rules. If any single policy allows a connection, that connection is allowed. You cannot write a deny rule to override an active allow statement.

To manage these gotchas, always pair your YAML deployments with programmatic connection tests, audit namespace labels regularly, and maintain centralized registries of all active network pathways.

## Putting It All Together

Securing your container networks requires abandoning the default-allow model in favor of a Zero Trust default-deny perimeter. By deploying global namespace default-deny rules, writing dynamic label-based ingress/egress allowances, configuring dedicated DNS paths, and verifying enforcement using diagnostic test pods, you prevent lateral network movements and protect internal resources.

When configuring and auditing your cluster network isolation rules, ensure you enforce these five core practices:

First, implement a default-deny NetworkPolicy in all namespaces. Establish a locked-down baseline immediately for both incoming and outgoing traffic.

Second, define ingress and egress rules exclusively using dynamic label selectors. Completely avoid static, fragile IP address declarations to ensure firewall rules automatically scale with your containers.

Third, explicitly configure outbound DNS egress rules to kube-dns on port 53. Avoid the DNS bootstrap trap to ensure application containers can resolve internal service domain names.

Fourth, verify that your active CNI provider enforces NetworkPolicies. Run automated positive and negative connection tests inside your CI pipelines to prove that network plugins are actively dropping packets on blocked pathways.

Fifth, audit your pod labels and policy bindings regularly. Maintain consistent naming conventions across Deployment and NetworkPolicy manifests to prevent silent connection dropouts due to label mismatches.

## What's Next

Securing API Server access, secrets delivery, pod sandbox boundaries, and network perimeters establishes a highly robust runtime environment. However, we must also programmatically block non-compliant pod definitions from ever entering the cluster database. In the next chapter, **Admission Control and Policy Engines**, we will cover the API Server admission request lifecycle, native ValidatingAdmissionPolicies with CEL expressions, and cluster-wide policy engines.

---

**References**

- [Kubernetes Network Policies Specification](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Comprehensive guide on configuring ingress, egress, selectors, and policy types.
- [Kubernetes DNS Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Reference guide on internal domain resolution and kube-dns behaviors.
- [Calico Network Policy Enforcement Guide](https://docs.tigera.io/calico/latest/network-policy/) - Technical details on how CNI providers enforce label-based rules inside the kernel.
- [OWASP Container Security Network Segmentation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Container_Security_Cheat_Sheet.html) - OWASP recommendations on least-privilege network segmentation and lateral pivoting defenses.
- [NIST SP 800-190 Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) - NIST guidelines on cluster network isolation and microsegmentation rules.

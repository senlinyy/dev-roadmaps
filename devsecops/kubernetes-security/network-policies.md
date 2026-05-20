---
title: "Network Policies"
description: "Limit pod-to-pod and pod-to-service traffic with explicit Kubernetes NetworkPolicy rules."
overview: "Network policies turn pod traffic into an allow list. This article explains pod selectors, ingress, egress, default deny, DNS allowances, and how to prove a policy is active."
tags: ["network-policy", "traffic", "kubernetes"]
order: 3
id: article-devsecops-kubernetes-security-network-policies
---

## Table of Contents

1. [What Network Policies Control](#what-network-policies-control)
2. [Default Deny](#default-deny)
3. [Allow Ingress](#allow-ingress)
4. [Allow Egress](#allow-egress)
5. [Testing Traffic](#testing-traffic)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Network Policies Control

Kubernetes NetworkPolicy objects control traffic to and from pods. They use labels to select pods and rules to allow traffic. The cluster network plugin must support NetworkPolicy enforcement.

For `devpolaris-orders`, the intended path is:

```text
web pods
  -> orders-api pods
  -> database service
orders-api pods
  -> DNS
orders-api pods
  -> payment API
```

Everything else should have a reason before it is allowed.

## Default Deny

A common pattern is to start with default deny for a namespace.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: orders-prod
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
```

The empty `podSelector` selects all pods in the namespace. With no allow rules, selected pods receive no ingress or egress traffic except what the network plugin or cluster behavior still permits outside policy scope.

Default deny makes traffic explicit. It also breaks workloads until the needed paths are allowed.

## Allow Ingress

Allow ingress from the web tier to the API pods.

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
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: web
      ports:
        - protocol: TCP
          port: 8080
```

The top `podSelector` chooses the pods being protected: `orders-api`. The `from` selector chooses which pods may connect: `web`. The port is the application port.

## Allow Egress

Egress rules allow the API to reach required services. DNS is easy to forget.

```yaml
egress:
  - to:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: kube-system
    ports:
      - protocol: UDP
        port: 53
  - to:
      - podSelector:
          matchLabels:
            app: orders-db
    ports:
      - protocol: TCP
        port: 5432
```

The first rule allows DNS. The second allows database traffic. External APIs may need IP blocks, egress gateways, or service mesh policy depending on the cluster design.

## Testing Traffic

Test allowed and denied paths.

```text
web -> orders-api:8080        allowed
orders-api -> orders-db:5432  allowed
orders-api -> DNS:53          allowed
orders-api -> random-pod:80   denied
random-pod -> orders-api:8080 denied
```

These tests should be part of rollout evidence. A policy that looks correct but is not enforced by the network plugin gives a false sense of safety.

## Putting It All Together

Network policies make pod traffic explicit. Default deny sets the baseline. Ingress and egress rules add back the paths the service needs. Labels are the control surface, so labels must be stable and reviewed.

For `devpolaris-orders`, the practical policy allows web to API, API to database, API to DNS, and API to required external services. Everything else needs a reason.

## What's Next

Network policies control traffic. Secrets in Kubernetes control how sensitive values reach pods and how teams reduce exposure when those values change.

---

**References**

- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Kubernetes documents NetworkPolicy behavior, selectors, ingress, and egress rules.
- [Kubernetes DNS for services and pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Kubernetes documents cluster DNS behavior that network policies often need to allow.

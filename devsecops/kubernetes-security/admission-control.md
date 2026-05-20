---
title: "Admission Control"
description: "Reject risky Kubernetes objects before they are stored and scheduled."
overview: "Admission control is the review step inside the Kubernetes API server. This article explains validating admission, built-in controls, policy engines, and evidence that a rule is active."
tags: ["admission", "policy", "kubernetes"]
order: 5
id: article-devsecops-kubernetes-security-admission-control
---

## Table of Contents

1. [Where Admission Runs](#where-admission-runs)
2. [Validation](#validation)
3. [Useful Policies](#useful-policies)
4. [Failure Messages](#failure-messages)
5. [Policy Evidence](#policy-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## Where Admission Runs

Admission control runs after a request is authenticated and authorized, but before the object is stored. RBAC can say a user is allowed to create pods. Admission can still reject a specific pod because it asks for unsafe settings.

```text
kubectl apply
  -> authentication
  -> authorization
  -> admission
  -> object stored
  -> scheduler acts
```

For `devpolaris-orders`, admission is the last API-server checkpoint before a risky manifest becomes cluster state.

## Validation

A validating admission rule checks the submitted object and accepts or rejects it. For example:

```text
Rule: production pods must not run privileged containers.
Object: Deployment orders-api
Field: spec.template.spec.containers[0].securityContext.privileged
Decision: reject if true
```

This rule is useful because it catches unsafe manifests even if a reviewer misses them. The rule should produce a message that tells the developer what to fix.

## Useful Policies

Useful admission policies are clear and stable.

| Policy | Why it helps |
|--------|--------------|
| Require non-root containers | Reduces runtime privilege |
| Block privileged pods | Prevents broad host access |
| Require image digests | Avoids mutable tag deployment |
| Require approved registries | Keeps images from controlled sources |
| Require owner labels | Makes production objects traceable |
| Block hostPath in app namespaces | Prevents direct host filesystem mounts |

Do not start with hundreds of rules. Start with a small set that protects the most important boundaries and produces low-noise failures.

## Failure Messages

A good failure message explains the policy and the field.

```text
admission denied: production containers must not be privileged
object: Deployment/orders-api
field: spec.template.spec.containers[0].securityContext.privileged
fix: remove privileged=true or request a platform exception
```

The developer should not need to know the policy engine internals to fix the manifest. The message should point to the object, field, and expected behavior.

## Policy Evidence

Record policy activation and test results.

```text
Policy: no-privileged-containers
Scope: orders-prod namespace
Mode: enforce
Test object: privileged test pod
Expected: reject
Observed: reject
Owner: platform-team
```

This evidence proves the policy is active, scoped correctly, and tested with an object that should fail.

## Putting It All Together

Admission control checks Kubernetes objects before they become cluster state. RBAC decides who can make a request. Admission decides whether the requested object is acceptable.

For `devpolaris-orders`, admission should enforce a small set of production rules: no privileged pods, approved registries, image digests, required owner labels, and restricted runtime settings. Each rule needs clear failure messages and tests.

## What's Next

Admission catches risky objects before they run. Runtime security watches what containers actually do after they start.

---

**References**

- [Kubernetes admission controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) - Kubernetes documents admission control in the API request path.
- [Kubernetes ValidatingAdmissionPolicy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/) - Kubernetes documents native validating admission policies.
- [OPA Gatekeeper](https://open-policy-agent.github.io/gatekeeper/website/docs/) - Gatekeeper documents Kubernetes admission policy using Open Policy Agent.

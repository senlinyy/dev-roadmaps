---
title: "Admission Control and Policies"
description: "Use Kubernetes admission control and policy engines to reject unsafe workload changes before they run."
overview: "Admission control is the API server checkpoint between a submitted manifest and stored cluster state. Policies protect devpolaris-orders-api from unsafe images, missing labels, and weak Pod settings."
tags: ["admission", "policies", "security", "validatingadmissionpolicy"]
order: 8
id: article-containers-orchestration-kubernetes-operations-admission-control-and-policies
aliases:
  - containers-orchestration/cluster-operations/policy-enforcement.md
  - article-containers-orchestration-cluster-operations-policy-enforcement
---
## Table of Contents

1. [The API Server Checkpoint](#the-api-server-checkpoint)
2. [Authentication, Authorization, and Admission](#authentication-authorization-and-admission)
3. [Mutating and Validating Admission](#mutating-and-validating-admission)
4. [Pod Security Admission](#pod-security-admission)
5. [ValidatingAdmissionPolicy With CEL](#validatingadmissionpolicy-with-cel)
6. [Policy Engines in Real Clusters](#policy-engines-in-real-clusters)
7. [Test Policies Before Deny Mode](#test-policies-before-deny-mode)
8. [When a Policy Blocks the Release](#when-a-policy-blocks-the-release)
9. [Operate Admission Safely](#operate-admission-safely)
10. [Policy Review Checklist](#policy-review-checklist)
11. [References](#references)

## The API Server Checkpoint
<!-- section-summary: Admission control checks a request after authentication and authorization but before the object is stored. -->

Kubernetes **admission control** is the API server checkpoint that can change or reject an object before it enters cluster state. Policies at this point prevent risky Pod shapes, missing labels, unapproved image sources, or other unsafe configuration before a scheduler or kubelet acts on them.

For `devpolaris-orders-api`, admission policy should answer production questions early: does this Pod meet the restricted security shape, does it include required ownership labels, and does it use an approved image registry?

This is preventive operations. The cluster rejects unsafe changes at the door instead of waiting for a runtime incident.

![API server checkpoint showing authentication, authorization, mutating admission, validating admission, storing in etcd, and rejection with a reason](/content-assets/articles/article-containers-orchestration-kubernetes-operations-admission-control-and-policies/api-server-checkpoint.png)

*The checkpoint view shows admission after identity and RBAC, before the object is stored.*

## Authentication, Authorization, and Admission
<!-- section-summary: Authentication identifies the caller, authorization checks the requested action, and admission checks or changes the submitted object. -->

The API server handles a request in stages:

| Stage | Question | Example |
|---|---|---|
| Authentication | Who is calling? | `orders-release` service account |
| Authorization | Can this caller create this resource here? | Can create Pods in `orders` |
| Admission | Is this object acceptable? | Pod uses approved security and labels |

RBAC can allow the release job to create a Pod template, while admission can still reject the object if it violates policy. That separation lets teams grant deployment permissions without accepting every possible Pod shape.

## Mutating and Validating Admission
<!-- section-summary: Mutating admission can add or adjust fields, while validating admission approves or rejects the final object. -->

Admission has two broad jobs. **Mutating admission** can modify an object, such as adding a sidecar or default label. **Validating admission** checks the final object and accepts or rejects it.

Example flow:

| Step | What happens |
|---|---|
| Request submitted | Release job sends a Deployment |
| Mutating admission | A webhook adds a sidecar or default annotation |
| Validating admission | Policies check images, labels, security fields |
| Store or reject | API server stores the object or returns an error |

This order matters during debugging. If a policy blocks a release, inspect the final object after mutation or use server-side dry run so you know what validation actually saw.

## Pod Security Admission
<!-- section-summary: Pod Security Admission enforces Kubernetes Pod Security Standards through namespace labels. -->

Pod Security Admission is the built-in way to apply Pod Security Standards at namespace admission time. For the orders namespace, the likely target is `restricted`.

```bash
$ kubectl label namespace orders \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
namespace/orders labeled
```

What this does:

- New Pod submissions receive warnings and audit records for restricted violations.
- The namespace gathers evidence before enforcement.
- Existing Pods keep running.

Move to enforcement after clean dry runs:

```bash
$ kubectl label namespace orders pod-security.kubernetes.io/enforce=restricted --overwrite
namespace/orders labeled
```

Future violating Pods in `orders` will then be rejected by the API server.

## ValidatingAdmissionPolicy With CEL
<!-- section-summary: ValidatingAdmissionPolicy lets clusters express built-in validation rules with CEL for common object checks. -->

**ValidatingAdmissionPolicy** is a Kubernetes-native way to write validation rules using CEL expressions. It is useful for checks that fit object fields directly.

A simple first policy can require the app ownership label on Pods.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-app-owner-label
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: "has(object.metadata.labels['app.kubernetes.io/part-of'])"
      message: "Pods must include app.kubernetes.io/part-of"
```

What this policy checks:

- It runs on Pod create and update requests.
- It requires a specific label.
- It returns a clear error message when the label is missing.

Bind it to the `orders` namespace:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-app-owner-label-orders
spec:
  policyName: require-app-owner-label
  validationActions: ["Warn"]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: orders
```

The first action is `Warn`, which gives release teams feedback before deny mode.

## Policy Engines in Real Clusters
<!-- section-summary: Policy engines such as Kyverno and Gatekeeper add richer policy authoring, reporting, mutation, and reusable controls. -->

Many production clusters use policy engines such as Kyverno or Gatekeeper for reusable policy packs, reporting, exceptions, and richer workflows. Use them when built-in Pod Security Admission and CEL policies are too small for the job.

Examples of checks a policy engine might own:

| Policy need | Why a policy engine helps |
|---|---|
| Approved image registries | Central rule across namespaces |
| Required resource requests | Reusable workload hygiene policy |
| No hostPath volumes | Strong Pod security control |
| Required team labels | Reporting and cost ownership |
| Exceptions with expiry | Safer temporary bypass process |

Keep the policy close to the operational risk. A policy named `require-approved-registry` is easier to review than a broad policy pack with unclear ownership.

## Test Policies Before Deny Mode
<!-- section-summary: Dry runs, warn mode, audit mode, and namespace pilots reduce release disruption before enforcement. -->

Admission policies can block production releases. Test them in layers before `Deny` or `enforce`.

```bash
$ kubectl apply -f pod-without-owner.yaml --server-side --dry-run=server
Warning: Pods must include app.kubernetes.io/part-of
pod/devpolaris-orders-api created (server dry run)
```

What this output means:

- The API server evaluated the object.
- The policy produced a warning.
- No object was stored because this was a dry run.

Rollout order:

| Step | Purpose |
|---|---|
| Audit | Learn current violations |
| Warn | Show developers messages during apply |
| Namespace pilot | Try one team namespace first |
| Enforce | Reject new violations |
| Review exceptions | Keep bypasses named and time-limited |

![Policy rollout lane showing audit, warn, dry run, namespace pilot, enforce, and exemptions for safer admission policy rollout](/content-assets/articles/article-containers-orchestration-kubernetes-operations-admission-control-and-policies/policy-rollout-lane.png)

*The rollout lane keeps policy enforcement gradual: observe, warn, pilot, enforce, then review exceptions.*

## When a Policy Blocks the Release
<!-- section-summary: A blocked release should produce a clear policy message, a manifest fix, or a documented exception path. -->

When admission blocks a release, the API error should point to the action item.

```bash
$ kubectl -n orders apply -f deployment.yaml
Error from server (Forbidden): error when creating "deployment.yaml": admission webhook "policy.example.dev" denied the request: containers must use images from registry.devpolaris.example
```

What the error tells you:

- The release reached admission.
- The policy was an image registry rule.
- The fix is to use the approved registry or request a scoped exception.

The response should mention the specific policy, the affected workload, and the chosen fix. Avoid changing policy to unblock one release without preserving that evidence.

## Operate Admission Safely
<!-- section-summary: Admission systems need high availability, failure-policy decisions, clear messages, observability, and emergency procedures. -->

Admission is part of the write path for the cluster API. A slow or broken webhook can slow or block releases, so operate policy infrastructure like production software.

Review these settings:

| Concern | Practical guidance |
|---|---|
| Failure policy | Use `Fail` for security-critical policies and `Ignore` only when accepting bypass during outages |
| Timeout | Keep webhook timeouts short and observable |
| Availability | Run multiple replicas for policy webhooks |
| Messages | Return errors developers can fix |
| Exemptions | Keep them scoped, owned, and time-limited |
| Metrics | Alert on webhook latency, errors, and rejections |

For built-in policies, still watch admission warnings and audit records. A policy nobody reads turns into background noise.

## Policy Review Checklist
<!-- section-summary: Policy review should connect the risk, rule, rollout mode, tests, failure message, and exception process. -->

Use this checklist before enforcing a policy for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Risk | The policy names a real production risk |
| Scope | It targets the right namespaces and resources |
| Rule | The CEL expression or policy engine rule is readable |
| Test | Server-side dry run shows expected warnings or denials |
| Message | The rejection tells developers how to fix the object |
| Rollout | Audit or warn mode ran before deny mode |
| Exceptions | Temporary bypasses have owners and expiry dates |
| Operations | Webhook health, latency, and errors are monitored |

![Admission policy review checklist with request shape, CEL rule, policy engine, testing before deny, failure message, and release evidence](/content-assets/articles/article-containers-orchestration-kubernetes-operations-admission-control-and-policies/admission-policy-review.png)

*The policy checklist keeps admission useful: clear risk, scoped rule, tested rollout, helpful error, and safe operations.*

## References

- [Kubernetes Admission Controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) - Official overview of admission control phases and built-in controllers.
- [Kubernetes Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) - Explains mutating and validating admission webhooks.
- [Kubernetes ValidatingAdmissionPolicy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/) - Official guide for CEL-based admission policies.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Explains namespace labels for Pod Security Standards enforcement.
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Defines restricted, baseline, and privileged Pod policy levels.
- [Kyverno Policies](https://kyverno.io/policies/) - Policy examples for Kubernetes resource validation, mutation, and generation.
- [Gatekeeper Policy Library](https://open-policy-agent.github.io/gatekeeper-library/website/) - Reusable OPA Gatekeeper constraints for Kubernetes policy enforcement.

---
title: "Admission Control and Policy Engines"
description: "Block unsafe Kubernetes manifests at the API server boundary with admission policies and policy engines."
overview: "Admission control is the last Kubernetes API checkpoint before a new or changed object lands in the cluster. This article shows how validating and mutating admission work, how ValidatingAdmissionPolicy uses CEL, how Kyverno and Gatekeeper fit in, and how teams roll policies from audit and warnings into enforcement."
tags: ["admission", "kubernetes", "policy", "cel", "gatekeeper", "kyverno"]
order: 4
id: article-devsecops-kubernetes-security-admission-control-and-policy-engines
aliases:
  - admission-control
  - article-devsecops-kubernetes-security-admission-control
  - devsecops/kubernetes-security/admission-control.md
  - devsecops/kubernetes-security/04-admission-control-and-policy-engines.md
  - devsecops/kubernetes-security/04-admission-control-and-policy-engines
  - kubernetes-security/04-admission-control-and-policy-engines
---

## Table of Contents

1. [Why Admission Control Exists](#why-admission-control-exists)
2. [The Admission Request Flow](#the-admission-request-flow)
3. [Validating and Mutating Admission](#validating-and-mutating-admission)
4. [Built-In Admission Controllers](#built-in-admission-controllers)
5. [ValidatingAdmissionPolicy and CEL](#validatingadmissionpolicy-and-cel)
6. [Hands-On: Block Privileged Pods](#hands-on-block-privileged-pods)
7. [Namespace Exceptions Without Losing Control](#namespace-exceptions-without-losing-control)
8. [Server-Side Checks Before Enforcement](#server-side-checks-before-enforcement)
9. [Kyverno and Gatekeeper in Practice](#kyverno-and-gatekeeper-in-practice)
10. [Rolling Policies From Audit to Enforce](#rolling-policies-from-audit-to-enforce)
11. [Operational Ownership and Policy Drift](#operational-ownership-and-policy-drift)
12. [References](#references)

## Why Admission Control Exists
<!-- section-summary: RBAC, pod hardening, and network policy reduce risk, and admission control stops unsafe objects before they enter the cluster. -->

Imagine a production Kubernetes cluster that already has the earlier security layers in place. **RBAC** controls who can create workloads. **Pod hardening** tells teams which container settings they should avoid. **NetworkPolicy** limits which pods can talk to each other. The cluster already has several good guardrails.

Then an engineer creates a short-lived debug pod during an incident. The manifest sets `securityContext.privileged: true` because a blog post said privileged mode helps with node-level troubleshooting. RBAC allows the engineer to create pods in the namespace. Network policy will control traffic after the pod starts. Pod hardening guidance exists in a wiki page. None of those things automatically stops this risky manifest from reaching the API server.

That is the gap **admission control** fills. Admission control is the part of the Kubernetes API server that reviews create, update, delete, and connect requests after authentication and authorization. It can reject a request, add defaults, call external policy systems, or attach audit and warning information. In plain English, it checks the object at the door before Kubernetes stores it and lets controllers act on it.

This matters because Kubernetes is very API driven. Most work begins as an API request: `kubectl apply`, a Helm release, a GitOps controller sync, a CI/CD deployment, or an operator creating another object. If a risky object reaches the API server and gets saved, the rest of the cluster starts responding to it. Schedulers place pods. Kubelets pull images. Controllers create dependent resources. Admission gives the platform team one central checkpoint before that chain begins.

The rest of this article follows one connected production scenario. A platform team wants to block privileged pods in normal application namespaces. They also need a controlled exception path for node troubleshooting tools, a way to test policies before they break deployments, and a way to decide whether native Kubernetes policy is enough or a policy engine is worth operating.

## The Admission Request Flow
<!-- section-summary: A write request passes through authentication, authorization, mutating admission, validation, and storage before the object exists in the cluster. -->

A Kubernetes request starts with a caller. The caller might be a human using `kubectl`, a CI/CD service account, a GitOps controller, or another Kubernetes controller. The API server first checks **authentication**, which answers "who is making this request?" Then it checks **authorization**, which answers "can this caller perform this action on this resource?"

RBAC lives in that authorization step. If an engineer has permission to create pods in `payments-prod`, the request can move forward. RBAC only answers the permission question. The full pod spec still needs a separate inspection for settings like `privileged: true`, `hostPath`, or a missing resource limit.

Admission comes next for write-style requests. Kubernetes admission controllers generally handle requests that create, update, delete, or connect to objects. Normal read requests like list and get do not go through the same admission path because they do not change cluster state.

The high-level flow looks like this:

1. **Authentication** identifies the caller.
2. **Authorization** checks the caller's permission for the verb and resource.
3. **Mutating admission** can modify the incoming object before validation.
4. **Object schema validation** checks that the object matches the Kubernetes API shape.
5. **Validating admission** can accept or reject the final object.
6. **Storage** writes the accepted object to etcd.
7. **Controllers and kubelets** react to the stored object.

This order explains why admission control is so useful after RBAC. RBAC can allow a deployment bot to update workloads in a namespace, while admission can still reject a deployment that adds a privileged container. The deployment bot keeps the access it needs, and the cluster still blocks one dangerous shape of workload.

The same order also explains why policy testing needs to use the real API server. A local YAML linter can catch indentation mistakes and unknown fields. It cannot fully answer whether the live cluster's admission chain will accept the request. The live cluster includes the API version, enabled admission controllers, installed webhooks, policy bindings, namespace labels, and service account permissions that will decide the final result.

![Kubernetes admission request flow showing request, authentication, authorization, mutating admission, validating admission, store in etcd, and reject branch](/content-assets/articles/article-devsecops-kubernetes-security-admission-control-and-policy-engines/admission-request-flow.png)

*The flow shows where admission sits: after identity and permission checks, before the object reaches etcd and starts triggering controllers.*

## Validating and Mutating Admission
<!-- section-summary: Mutating admission changes an object before storage, while validating admission approves or rejects the final object. -->

Kubernetes has two broad admission jobs: **mutation** and **validation**.

**Mutating admission** changes the object. A mutating admission controller might add a required label, inject a sidecar container, apply a default runtime class, or add a toleration that platform-owned workloads need. Mutation helps teams keep manifests smaller and lets platform defaults live near the cluster instead of being copied into every application repository.

Mutation needs care because it changes the submitted object. If a webhook adds a sidecar, the pod that runs has more containers than the pod the developer wrote. If a mutating policy adds labels, another controller might act on those labels. Real teams treat mutation as platform behavior that must be documented, tested, and kept predictable. The safest mutation rules usually add small defaults that teams already expect.

**Validating admission** reviews the final object and either accepts or rejects it. It can also return warnings or audit annotations depending on the mechanism. Validation fits security rules because the platform team usually wants a clear yes or no decision. A pod either asks for privileged mode or it does not. A namespace either has the required owner label or it does not. A container image either comes from an approved registry or it does not.

For the privileged-pod scenario, validation is the better first tool. The platform team does not want the API server to silently rewrite a privileged pod into a non-privileged pod, because the workload may fail in a confusing way. The better result is a clear rejection message that tells the team which setting violated the policy and how to request an exception.

Mutating admission still matters in the same cluster. A service mesh might inject sidecars. A platform webhook might add standard labels. A policy engine might default resource requests in development namespaces. The validating privileged-pod policy should evaluate the object after mutation so it sees the object Kubernetes is actually about to store.

## Built-In Admission Controllers
<!-- section-summary: Kubernetes ships admission controllers for common cluster rules, and extension points let teams add their own policy checks. -->

Kubernetes includes many **built-in admission controllers**. A built-in admission controller is admission logic that ships with Kubernetes and runs inside the API server when the cluster enables it. Managed Kubernetes providers choose and configure many of these for you, while self-managed clusters configure them on the API server.

Some built-in controllers protect basic cluster behavior. **NamespaceLifecycle** prevents certain unsafe operations around namespaces that are terminating or reserved. **ServiceAccount** handles service account behavior for pods. **ResourceQuota** enforces namespace quotas, and **LimitRanger** applies or checks resource limits according to namespace rules. These controllers protect the cluster from common operational problems.

Security-focused built-ins also matter. **PodSecurity** enforces the Kubernetes Pod Security Standards through namespace labels. It can restrict risky pod fields such as privileged mode, host namespaces, and dangerous volume types according to the configured standard. **NodeRestriction** limits what kubelets can change, which helps keep node identities from modifying unrelated objects.

Kubernetes also includes extension points. **MutatingAdmissionWebhook** and **ValidatingAdmissionWebhook** let the API server call external HTTPS services during admission. Policy engines such as Kyverno and Gatekeeper commonly use validating webhooks, and sometimes mutating webhooks, to make decisions. **ValidatingAdmissionPolicy** gives Kubernetes a native validating policy path using CEL expressions without calling a separate webhook service.

This mix gives teams choices. A built-in controller covers common behavior. A native policy covers simple cluster-specific validation. A policy engine handles richer rules, background scans, reporting, exceptions, and organization-wide policy workflows. The right choice depends on the rule, the operational overhead your team can own, and the amount of feedback developers need.

## ValidatingAdmissionPolicy and CEL
<!-- section-summary: ValidatingAdmissionPolicy lets Kubernetes evaluate CEL expressions in the API server for native validation rules. -->

**ValidatingAdmissionPolicy**, often shortened to **VAP**, is a Kubernetes API for writing validation rules that run in the API server. It uses **CEL**, the Common Expression Language, to inspect the incoming object and return a true or false result. A true result means the object passes that validation. A false result rejects, warns, or audits depending on the binding action.

CEL is a small expression language designed for safe, fast checks over structured data. In Kubernetes admission, CEL can look at the object being created or updated, the old version during updates, request information, namespace information, and optional parameters. A CEL expression can ask questions like "does every container avoid privileged mode?" or "does this namespace have a required label?"

VAP has two main pieces.

The **ValidatingAdmissionPolicy** defines what to match and what to check. It says which resources and operations the rule applies to, and it contains one or more CEL validations. This is the reusable policy definition.

The **ValidatingAdmissionPolicyBinding** attaches that policy to actual admission requests. The binding can limit the policy to matching namespaces or objects, attach parameter objects, and choose `validationActions`. The main actions are `Audit`, `Warn`, and `Deny`. `Audit` records audit information, `Warn` returns a warning to the caller, and `Deny` blocks the request.

That split helps with rollout. The platform team can define the privileged-pod policy once, then bind it in warn-and-audit mode first. After teams fix existing manifests and the warning stream looks clean, the binding can move to deny mode.

VAP is a strong fit for rules that can be answered from the Kubernetes object itself. Blocking privileged pods, requiring labels, limiting host namespace usage, and checking image registry prefixes are good examples. A rule that needs external data, image signature verification, complex inventory lookups, or rich reporting usually belongs in a policy engine or another admission webhook.

## Hands-On: Block Privileged Pods
<!-- section-summary: A small ValidatingAdmissionPolicy can reject pods that request privileged containers before the pod is stored. -->

Now connect the pieces to the production incident scenario. The platform team wants one rule: normal application namespaces should reject pods that set `securityContext.privileged: true` on regular containers, init containers, or ephemeral containers.

A privileged container gets broad access to the host. It can bypass many container isolation boundaries, which makes it useful for rare node-level debugging and dangerous for ordinary application workloads. Most application teams should never need it.

Here is a native Kubernetes policy that checks all three container lists:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: disallow-privileged-pods.devpolaris.io
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        !object.spec.containers.exists(c,
          has(c.securityContext) &&
          has(c.securityContext.privileged) &&
          c.securityContext.privileged
        ) &&
        (!has(object.spec.initContainers) ||
          !object.spec.initContainers.exists(c,
            has(c.securityContext) &&
            has(c.securityContext.privileged) &&
            c.securityContext.privileged
          )
        ) &&
        (!has(object.spec.ephemeralContainers) ||
          !object.spec.ephemeralContainers.exists(c,
            has(c.securityContext) &&
            has(c.securityContext.privileged) &&
            c.securityContext.privileged
          )
        )
      message: "Privileged containers are not allowed. Use a reviewed exception namespace for approved node-level tooling."
      reason: Forbidden
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: disallow-privileged-pods.devpolaris.io
spec:
  policyName: disallow-privileged-pods.devpolaris.io
  validationActions: [Deny]
```

The expression uses `exists` to search each container list. If any container explicitly sets `privileged` to true, that part of the expression fails. The `!` at the front means "there must be no privileged container." The init container and ephemeral container checks include `has(...)` because those lists may be absent on many pods.

The `failurePolicy: Fail` setting tells the API server to reject matching requests if the policy evaluation cannot complete. For security rules, that is usually the safer starting point because a broken policy should not silently allow risky workloads. Some availability-focused rules may choose a different tradeoff, especially during early rollout.

Here is the risky pod that should fail:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: debug-node-tool
  namespace: payments-prod
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "3600"]
      securityContext:
        privileged: true
```

A server-side dry-run sends the request through the API server and admission chain without storing the pod:

```bash
kubectl apply --dry-run=server --validate=strict -f risky-pod.yaml
```

The rejection should point back to the policy message:

```console
Error from server (Forbidden): error when creating "risky-pod.yaml": pods "debug-node-tool" is forbidden: ValidatingAdmissionPolicy 'disallow-privileged-pods.devpolaris.io' with binding 'disallow-privileged-pods.devpolaris.io' denied request: Privileged containers are not allowed. Use a reviewed exception namespace for approved node-level tooling.
```

That message gives the developer something useful. They know the cluster rejected privileged mode, they know the request failed before the pod existed, and they know the approved path goes through an exception namespace.

## Namespace Exceptions Without Losing Control
<!-- section-summary: Exceptions need labels, ownership, expiration, and tight RBAC so a break-glass path does not turn into a permanent bypass. -->

Production clusters need exceptions. A storage driver, CNI component, node agent, or emergency debugging tool may need privileges that application pods should never receive. The goal is to make exceptions visible and narrow, rather than letting every namespace become a special case.

A simple exception pattern uses a namespace label. The policy binding applies everywhere except namespaces labeled `policy.devpolaris.io/allow-privileged: "true"`:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: disallow-privileged-pods.devpolaris.io
spec:
  policyName: disallow-privileged-pods.devpolaris.io
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchExpressions:
        - key: policy.devpolaris.io/allow-privileged
          operator: NotIn
          values: ["true"]
```

This selector means the policy still applies to namespaces that lack the label. Only namespaces with the exact label value get excluded from this binding. That detail matters because the secure default should cover new namespaces automatically.

The namespace itself should carry enough information for review:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: node-debug
  labels:
    policy.devpolaris.io/allow-privileged: "true"
    policy.devpolaris.io/owner: "sre"
    policy.devpolaris.io/expires: "2026-07-15"
```

Kubernetes will not automatically remove the exception when that date arrives. The date still helps because it gives humans and automation a clear review target. A platform team can run a scheduled report that lists namespaces with exception labels, owners, and expiration dates. In larger environments, Kyverno PolicyException resources, Gatekeeper exemptions, or an internal approval system can make this process more structured.

RBAC must protect the exception label. If every application team can label its own namespace with `allow-privileged=true`, the policy has a self-service bypass. A common production pattern gives application teams permission to deploy workloads while reserving namespace label changes for platform administrators or a controlled automation workflow.

The important habit is to treat an exception as a separate production object. It needs an owner, a reason, an expiration date, and review evidence. Without that discipline, policy exceptions slowly become policy drift.

## Server-Side Checks Before Enforcement
<!-- section-summary: Server-side dry-run and strict validation let teams test policy behavior against the real API server before storing objects. -->

Before a policy reaches enforcement, teams need a way to test both the policy object and the workloads it will affect. Local checks help, but the API server gives the most realistic answer because it knows the live API versions, admission chain, namespace labels, and installed policy engines.

For the policy itself, a platform engineer can ask the server to validate the policy without saving it:

```bash
kubectl apply --dry-run=server --validate=strict -f disallow-privileged-pods.yaml
```

The `--validate=strict` flag asks kubectl and the server to reject unknown or duplicate fields when server-side field validation is available. That catches mistakes such as a misspelled field in the policy binding before the team trusts the rule.

After the policy is applied, Kubernetes records type-checking information for ValidatingAdmissionPolicy expressions in status. This check helps catch CEL expressions that do not line up with the matched resource type:

```bash
kubectl get validatingadmissionpolicy disallow-privileged-pods.devpolaris.io -o yaml
```

For application manifests, server-side dry-run shows whether the real cluster would accept the object:

```bash
kubectl apply --dry-run=server --validate=strict -f deployment.yaml
```

This is especially useful in CI. A deployment pipeline can test manifests against a staging cluster that has the same admission policies as production. The pipeline service account should look like the real deployment identity, because RBAC and admission run together. A manifest that passes as a cluster admin may fail for the actual deployer, and that is exactly the kind of difference CI should reveal before a release window.

Server-side dry-run still has limits. It checks the API request path and admission response. A successful dry-run still leaves separate rollout questions: whether a controller will reconcile successfully, whether an image will pull, and whether a pod will become ready. Admission testing answers one narrow but important question: would the API server accept this object right now?

## Kyverno and Gatekeeper in Practice
<!-- section-summary: Native policies handle simple checks, while Kyverno and Gatekeeper add richer policy workflows, reporting, mutation, and organization-scale controls. -->

ValidatingAdmissionPolicy gives Kubernetes a strong native option. Many teams should start there for simple validation because it runs in the API server and avoids operating an extra webhook service. The privileged-pod rule is a good example of a rule VAP can handle cleanly.

Policy engines enter the picture when the team needs more than a true-or-false object check. A policy engine usually runs controllers and admission webhooks in the cluster. It can validate admission requests, scan existing resources, produce reports, handle exceptions, and sometimes mutate or generate resources. That extra power also adds operational ownership: upgrades, webhook availability, metrics, fail-open or fail-closed choices, and policy lifecycle management.

**Kyverno** uses Kubernetes-style YAML policies. That makes it approachable for teams that already write manifests and want policies to look like Kubernetes resources. Kyverno commonly handles validation, mutation, generation, cleanup, image verification, policy reports, and exceptions. A Kyverno validation policy can start in `Audit` mode, optionally emit warnings, and later move to `Enforce`.

**Gatekeeper** brings Open Policy Agent to Kubernetes admission. Teams define reusable policy logic with ConstraintTemplates and then create Constraints for the specific rule. Gatekeeper has strong audit support and fits organizations that already use OPA or Rego across multiple platforms. It can run constraints in `dryrun`, `warn`, or deny behavior depending on enforcement settings.

Here is the practical comparison most platform teams care about:

| Choice | Strong fit | Tradeoff to own |
|---|---|---|
| **ValidatingAdmissionPolicy** | Simple validation from Kubernetes object fields, such as privileged pods, required labels, host namespace checks, or registry prefixes | CEL expressions need careful testing, and VAP does not provide the same reporting and exception workflow as a full policy engine |
| **Kyverno** | Kubernetes-native policy authoring, validation, mutation, generation, image verification, policy reports, and policy exceptions | The cluster now depends on Kyverno controllers and webhooks, so the platform team owns their availability and upgrades |
| **Gatekeeper** | OPA/Rego-based policy programs, reusable constraints, strong audit workflows, and consistency with OPA outside Kubernetes | Rego and ConstraintTemplates add a learning curve, and the webhook/controller stack still needs operational care |

![Admission policy engine options comparing ValidatingAdmissionPolicy with CEL, Kyverno with YAML policies, and Gatekeeper with Rego feeding into the API server](/content-assets/articles/article-devsecops-kubernetes-security-admission-control-and-policy-engines/admission-policy-engine-options.png)

*The comparison keeps the tool choice practical: native CEL for simple object checks, Kyverno for Kubernetes-style policy workflows, and Gatekeeper when OPA/Rego reuse matters.*

For the privileged-pod rule, VAP may be enough in a smaller platform. A team with dozens of clusters, many exception requests, image-signing requirements, and compliance reports may prefer Kyverno or Gatekeeper because the surrounding workflow matters as much as the admission decision.

## Rolling Policies From Audit to Enforce
<!-- section-summary: A safe rollout starts with visibility, adds warnings, fixes violations, and only then blocks new requests. -->

A strict policy enabled without warning can break a release and frustrate the teams that admission control is supposed to help. The production-friendly path starts with visibility.

For ValidatingAdmissionPolicy, the binding controls rollout behavior. During discovery, the binding can use audit and warning actions:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: disallow-privileged-pods.devpolaris.io
spec:
  policyName: disallow-privileged-pods.devpolaris.io
  validationActions: [Warn, Audit]
```

With `Warn`, developers see a warning when they submit a request that violates the rule. With `Audit`, the API server can add audit information for policy violations. The request still succeeds because the binding has not moved to `Deny`.

Kyverno and Gatekeeper use similar rollout ideas with different fields. Kyverno validation rules commonly start with `failureAction: Audit`, then move to `failureAction: Enforce`. Gatekeeper constraints can use `enforcementAction: dryrun` or `enforcementAction: warn` before deny behavior. The field names differ, but the rollout shape stays the same.

A practical rollout plan has these phases:

1. **Rule and exception design together.** The policy message should tell people what failed and where exception requests go.
2. **Audit or warn mode first.** This shows the affected teams and the common violation patterns.
3. **Report and warning review.** Platform teams sort violations by namespace, team, workload, and risk.
4. **Normal workload fixes.** Most violations should turn into manifest changes, Helm chart changes, or base-template changes.
5. **Narrow exceptions for approved cases.** Each exception should have an owner, reason, and expiration.
6. **Enforcement for new requests.** For VAP, that means changing the binding to `validationActions: [Deny]`.
7. **Post-enforcement audit.** Existing objects, exception namespaces, and disabled policies still need review.

This staged rollout keeps admission control connected to delivery work. Developers get warnings before rejections. Platform teams see real usage before choosing the enforcement date. Security reviewers get a short exception list instead of a long argument about why the entire policy needs to wait.

## Operational Ownership and Policy Drift
<!-- section-summary: Admission control works well when policies live in Git, exceptions expire, reports get reviewed, and owners keep clusters consistent. -->

Admission control is production infrastructure. The policy itself may fit on one screen, but the operating model around it decides whether it stays useful.

Ownership should be explicit. The platform security team may write baseline rules, but application teams own their manifests. SREs may approve emergency exception namespaces. Cluster administrators own webhook availability and API server configuration. CI/CD owners need dry-run checks in the deployment path. These responsibilities should be clear before a policy reaches deny mode.

Policies should live in Git with the rest of the platform configuration. Reviews should cover the match scope, the failure behavior, the message developers will see, and the exception path. A policy change that expands from one namespace to all namespaces deserves the same review seriousness as a firewall change.

Teams should watch for **policy drift**. Drift happens when clusters, namespaces, or exception lists slowly stop matching the intended baseline. One cluster might run a newer policy version. One namespace might keep an exception label after the incident ended. A Helm chart might carry an old privileged setting because nobody deployed that service during the warning period.

Policy engines help here because they can scan existing resources and produce reports. Native Kubernetes policies can still work well, but the team may need scheduled scripts, audit log queries, or CI checks to review existing objects and exception labels. Admission blocks new and changed requests. Existing resources need their own review loop.

The final production habit is to measure the policy system itself. Teams should track admission rejections, warnings, webhook latency, webhook failures, policy-engine health, and exception counts. A policy engine outage can block deployments if configured fail-closed. A quiet policy with many stale exceptions may only look successful because it stopped checking the riskiest namespaces.

Admission control gives Kubernetes a strong boundary at the API server. Used well, it turns security guidance into a real deployment rule, gives developers fast feedback, and keeps dangerous manifests out of normal namespaces before the cluster has to run them.

![Admission policy rollout showing audit, warn, pilot, deny, review evidence, and an expiring exception branch](/content-assets/articles/article-devsecops-kubernetes-security-admission-control-and-policy-engines/admission-policy-rollout.png)

*The summary shows the safe path to enforcement: observe first, warn developers, pilot the rule, deny new unsafe requests, keep evidence, and make exceptions visible and temporary.*

---

## References

- [Kubernetes: Admission Controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) - Lists Kubernetes admission controllers and explains how admission controllers intercept API server requests after authentication and authorization.
- [Kubernetes: Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) - Explains mutating and validating admission webhooks and how the API server calls external admission services.
- [Kubernetes: ValidatingAdmissionPolicy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/) - Documents ValidatingAdmissionPolicy, ValidatingAdmissionPolicyBinding, CEL variables, failure policy, and validation actions.
- [Kubernetes: CEL in Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/) - Describes how Kubernetes uses Common Expression Language for API validation and admission expressions.
- [Kubernetes kubectl apply reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) - Documents `kubectl apply`, server-side dry-run, validation flags, and related apply behavior.
- [Kyverno: Validate Rules](https://kyverno.io/docs/policy-types/cluster-policy/validate/) - Documents Kyverno validate rules, failure actions, and warning behavior.
- [Kyverno: Policy Exceptions](https://kyverno.io/docs/exceptions/) - Explains Kyverno PolicyException resources and exception scoping.
- [Gatekeeper: How To Use Gatekeeper](https://open-policy-agent.github.io/gatekeeper/website/docs/howto/) - Documents ConstraintTemplates, Constraints, audit, and enforcement actions.
- [Gatekeeper: Exempt Namespaces](https://open-policy-agent.github.io/gatekeeper/website/docs/exempt-namespaces/) - Explains Gatekeeper namespace exemption behavior for admission and audit.

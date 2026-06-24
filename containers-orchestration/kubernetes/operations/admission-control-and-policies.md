---
title: "Admission Control and Policies"
description: "Use Kubernetes admission control and policy engines to reject unsafe workload changes before they run."
overview: "Admission control is the API server checkpoint between a submitted manifest and stored cluster state. You will learn how policies protect devpolaris-orders-api from unsafe images, missing labels, and weak Pod settings."
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
11. [What's Next](#whats-next)

## The API Server Checkpoint
<!-- section-summary: Admission control checks a Kubernetes request after identity and permissions are known, before the object is stored. -->

**Admission control** is the checkpoint inside the Kubernetes API server that inspects a request before Kubernetes stores the object. A developer runs `kubectl apply`, a GitOps controller syncs a manifest, or a CI job updates a Deployment. The API server authenticates the caller, checks permissions, and then runs admission checks against the object being created or updated.

Use `devpolaris-orders-api` in the `orders` namespace as the running example. The service deploys checkout code, so a bad manifest can affect real customers quickly. Admission policies can stop unsafe changes such as running privileged containers, missing owner labels, using images from unknown registries, or deploying by a mutable tag like `latest`.

![API server checkpoint showing authentication, authorization, mutating admission, validating admission, storing in etcd, and rejection with a reason](/content-assets/articles/article-containers-orchestration-kubernetes-operations-admission-control-and-policies/api-server-checkpoint.png)

*The checkpoint visual shows admission in the exact place it matters: after the caller is known and allowed, but before the API server records the requested object.*

This checkpoint is powerful because it acts before the workload runs. Cleaning up a privileged Pod after it starts is incident response. Rejecting that Pod during admission is prevention. Good admission policy gives teams a clear error message and a clear fix while the release is still in the delivery path.

## Authentication, Authorization, and Admission
<!-- section-summary: Authentication identifies the caller, authorization checks the verb and resource, and admission checks the submitted object shape. -->

Three API server steps work together. **Authentication** answers "who is making this request?" It might identify a human user, a service account, or a controller. **Authorization** answers "may this caller perform this verb on this resource?" In many clusters, RBAC grants a CI service account permission to update Deployments in `orders`.

**Admission** answers a different question: "is this exact object acceptable for this cluster?" A CI service account may have permission to update the orders Deployment, while admission still rejects the update because the container image lacks an immutable digest. RBAC controls access to the door. Admission checks what is being carried through it.

Use `kubectl auth can-i` to separate permission problems from policy problems. This command asks the authorization layer whether the current identity can perform an action.

```bash
$ kubectl auth can-i update deployments -n orders
yes

$ kubectl auth can-i create pods -n orders
yes
```

If `can-i` says no, the fix is in RBAC or the caller identity. If `can-i` says yes and `kubectl apply` still fails with a message from Pod Security, a validating policy, or a webhook, the request reached admission and the object content was denied. That distinction sends the right person to the right system.

## Mutating and Validating Admission
<!-- section-summary: Mutating admission can add safe defaults, while validating admission accepts or rejects the final object. -->

Kubernetes admission has two broad behaviors. **Mutating admission** can change an object before it is stored. **Validating admission** can allow or reject the object after mutation has run. Many real clusters use both, with mutation for simple defaults and validation for rules that define the boundary.

For example, a platform team might add a default label to objects in the `orders` namespace, then validate that every Deployment includes required labels and safe Pod settings. The order matters because validation sees the final object after mutation.

| Admission type | What it does | Example for `devpolaris-orders-api` |
|----------------|--------------|--------------------------------------|
| Mutating | Adds or changes fields before storage | Add `devpolaris.io/environment=prod` if missing |
| Validating | Allows or rejects the final object | Reject images without `@sha256:` digests |
| Both together | Defaults first, then checks | Add a team label, then require a complete label set |

Mutation reduces repeated YAML, but it also means the stored object can differ from the file the developer reviewed. That is why many teams keep mutation narrow and predictable. Labels, sidecar injection, and safe default fields are common mutation use cases. Security boundaries and release rules usually belong in validation because the person deploying should see the denied field and fix it directly.

## Pod Security Admission
<!-- section-summary: Pod Security Admission applies built-in Pod safety levels through namespace labels, which gives teams a baseline before custom policies. -->

**Pod Security Admission** is Kubernetes built-in enforcement for the Pod Security Standards. The standards define levels such as `privileged`, `baseline`, and `restricted`. The `restricted` level is the strongest built-in profile and is a common starting point for application namespaces that should avoid privileged containers and risky Linux settings.

For the `orders` namespace, a platform team can enforce restricted Pod settings and also ask Kubernetes to warn and audit at the same level. The labels live on the namespace, so every Pod created there is checked.

```bash
$ kubectl label namespace orders \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted \
  --overwrite
namespace/orders labeled
```

Now a privileged debug Pod is rejected before it starts. The response tells the operator which Pod Security rule failed.

```bash
$ kubectl -n orders run debug-root --image=busybox:1.36 --privileged -- sleep 3600
Error from server (Forbidden): pods "debug-root" is forbidden:
violates PodSecurity "restricted:latest": privileged, allowPrivilegeEscalation != false,
unrestricted capabilities, runAsNonRoot != true
```

That built-in baseline helps every workload in the namespace, including `devpolaris-orders-api`. Organization-specific rules such as approved registries, required cost labels, image signatures, or minimum replica counts still need ValidatingAdmissionPolicy or a policy engine.

## ValidatingAdmissionPolicy With CEL
<!-- section-summary: ValidatingAdmissionPolicy lets the API server evaluate CEL expressions against Kubernetes objects without running a separate webhook service. -->

**ValidatingAdmissionPolicy** is a Kubernetes resource for writing validation rules directly in the API server. It uses **CEL**, the Common Expression Language, to inspect object fields and request data. A separate binding chooses the scope and the enforcement action.

Start with a small rule that every orders Deployment must carry an owner label. This label helps cost reports, alerts, and incident handoffs find the team responsible for the workload.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-owner-label
spec:
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "has(object.metadata.labels) && 'devpolaris.io/owner' in object.metadata.labels"
      message: "Deployments must set metadata.labels['devpolaris.io/owner']."
```

The policy defines the rule. The binding attaches it to the `orders` namespace and chooses `Deny` as the action.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-owner-label-orders
spec:
  policyName: require-owner-label
  validationActions: ["Deny"]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: orders
```

The developer experience depends on the message. A clear message says what failed and which field to change. A vague message sends the release engineer searching through platform code during a deploy.

You can write stronger checks the same way. This example requires orders API containers to come from the approved registry and use an immutable digest.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-devpolaris-digests
spec:
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "object.spec.template.spec.containers.all(c, c.image.startsWith('ghcr.io/devpolaris/') && c.image.matches('^.+@sha256:[a-f0-9]{64}$'))"
      message: "Deployment containers must use ghcr.io/devpolaris images pinned by @sha256 digest."
```

This teaching example checks regular containers. A production version should also consider init containers, workload types beyond Deployments, and exceptions for platform-owned controllers. Keep the first policy small enough that the team can test it deeply.

## Policy Engines in Real Clusters
<!-- section-summary: Policy engines add reusable policy libraries, audit reports, mutation, image verification, and richer workflows around Kubernetes admission. -->

Many production clusters use a policy engine on top of Kubernetes admission. **Kyverno** lets teams write Kubernetes-native policy resources for validation, mutation, generation, and image verification. **OPA Gatekeeper** uses Open Policy Agent and ConstraintTemplates to enforce policies. **Kubewarden** uses WebAssembly-based policies. The exact tool matters less than the operating practice around it.

For `devpolaris-orders-api`, a practical policy set might include these rules:

| Policy | Failure it prevents | Likely owner |
|--------|---------------------|--------------|
| Require approved image registry | Personal or unknown images reaching production | Platform security |
| Require immutable image digests | A tag moving after review | Delivery platform |
| Require resource requests | Unpredictable scheduling and autoscaling | Service team |
| Enforce restricted Pod settings | Privileged or weak container settings | Platform security |
| Require owner and service labels | Missing alert routing and cost ownership | Platform operations |

A small Kyverno policy can express the owner-label rule as Kubernetes YAML. This example starts in `Audit`, so Kyverno records violations and can emit warnings without blocking the orders team while they clean up existing manifests.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-orders-owner-label
spec:
  background: true
  emitWarning: true
  rules:
    - name: deployment-owner-label
      match:
        any:
          - resources:
              kinds:
                - Deployment
              namespaces:
                - orders
      validate:
        failureAction: Audit
        message: "Deployments in orders must set metadata.labels['devpolaris.io/owner']."
        pattern:
          metadata:
            labels:
              devpolaris.io/owner: "?*"
```

After applying the policy, the platform team can look at the namespace report before changing the rule to `Enforce`. A report with failures gives the service team a concrete repair list instead of a surprise release block.

```bash
$ kubectl apply -f policies/require-orders-owner-label.yaml
$ kubectl get policyreport -n orders
```

```bash
NAME                                PASS   FAIL   WARN   ERROR   SKIP   AGE
cpol-require-orders-owner-label     12     1      0      0       0      3m
```

When the failures are fixed, the rule can move to `failureAction: Enforce`. The same `missing-owner.yaml` dry-run from the next section should then fail with the Kyverno message, and that message should tell the developer exactly which label to add.

Real policy programs usually start in audit or warn mode. Teams need to see which objects fail before deny mode blocks releases. That audit period turns policy from a surprise into a cleanup project with owners.

Policy engines also need their own operational care. A webhook-based engine sits in the API server request path, so its Deployment, Service, certificates, timeout, and `failurePolicy` can affect every create or update request. Treat the policy engine as production infrastructure, not as a background linter.

## Test Policies Before Deny Mode
<!-- section-summary: Policy tests should include passing and failing manifests, dry-run applies, audit output, and a rollout plan from warn to deny. -->

A policy is production code. It needs tests, examples, rollout phases, and a rollback path. The simplest useful test is one manifest that should pass and one manifest that should fail.

Here is a failing Deployment for the owner-label policy. It has the application label but lacks `devpolaris.io/owner`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: missing-owner
  namespace: orders
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api@sha256:8f4b9c7a9d1f6e24d5b6b0c2e9f77b0c4f37d8443c188a6eac1d2d5c07e42a91
```

Run a server-side dry run against a cluster that has the policy installed. This catches the denial without changing stored state.

```bash
$ kubectl apply --server-side --dry-run=server -f missing-owner.yaml
Error from server (Forbidden): deployments.apps "missing-owner" is forbidden:
ValidatingAdmissionPolicy 'require-owner-label' denied request:
Deployments must set metadata.labels['devpolaris.io/owner'].
```

The passing example adds the required label. Keep this example near the policy or in the platform policy test suite so reviewers can understand the intended fix.

```yaml
metadata:
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    devpolaris.io/owner: orders-team
```

Roll out deny mode in phases. Audit existing objects first, warn on new changes next, and deny only after service teams have a repair path. This is slower than flipping the rule on immediately, but it creates fewer broken releases and better trust in the platform.

| Phase | What happens | Exit criteria |
|-------|--------------|---------------|
| Audit | Existing violations are recorded | Owners know which objects need fixes |
| Warn | New requests receive warnings but still apply | Pipelines and developers see the message |
| Deny | Invalid requests are rejected | Critical workloads have fixes or reviewed exceptions |

![Policy rollout lane showing audit, warn, dry run, namespace pilot, enforce, and exemptions for safer admission policy rollout](/content-assets/articles/article-containers-orchestration-kubernetes-operations-admission-control-and-policies/policy-rollout-lane.png)

*The rollout lane shows why deny mode should come after evidence. Audit, warn, dry run, and namespace pilots help teams fix real manifests before enforcement blocks releases.*

Exceptions need the same discipline as the main policy. Scope them by namespace, service account, object name, or label, then review them on a schedule. A permanent exception for an entire namespace quietly turns the policy off for the place that may need it most.

## When a Policy Blocks the Release
<!-- section-summary: A release-blocking policy error means the caller had access, but the submitted object violated a rule that admission enforced. -->

Imagine the orders team ships a new checkout fix. CI has permission to update Deployments in `orders`, but the image field still uses a mutable tag. Admission rejects the release.

```bash
$ kubectl -n orders apply -f deployment.yaml
Error from server (Forbidden): error when creating "deployment.yaml":
admission denied: container api image "ghcr.io/devpolaris/orders-api:latest"
must use an immutable digest
```

The policy is protecting the cluster from an image that can change after review. The fix is to deploy the digest produced by the build pipeline. The image reference should name the registry, repository, and digest.

```yaml
containers:
  - name: api
    image: ghcr.io/devpolaris/orders-api@sha256:8f4b9c7a9d1f6e24d5b6b0c2e9f77b0c4f37d8443c188a6eac1d2d5c07e42a91
```

Use a short diagnostic path during release pressure:

1. Read the full error message.
2. Run `kubectl auth can-i` for the denied verb and resource.
3. Identify whether the message names RBAC, Pod Security, ValidatingAdmissionPolicy, or a webhook.
4. Fix the manifest field named by the policy.
5. Ask for a scoped exception only when the workload is valid and the policy cannot express that case yet.

The best platform teams make this path visible in CI output. A denied request should tell the service team exactly which field to change. The release engineer should not need to read the policy engine source to discover that `:latest` was the problem.

## Operate Admission Safely
<!-- section-summary: Admission systems live in the API request path, so operators need health checks, failure-policy decisions, timeout settings, and emergency procedures. -->

Admission controls can protect a cluster, and they can also block the API server from accepting changes if the policy path is unhealthy. This is especially important for webhook-based engines. The API server calls the webhook Service, waits for a response, and then accepts or rejects the object based on the response and the webhook configuration.

This error is different from a normal policy denial:

> Error from server (InternalError): failed calling webhook "validate.policy.platform.local": Post "https://policy-webhook.platform.svc:443/validate": context deadline exceeded

The application manifest may be fine. The API server could not get a timely answer from the policy webhook. The first checks should be the policy engine Pods, Service, certificates, network path, and webhook timeout.

```bash
$ kubectl -n policy-system get deploy,svc,pod
$ kubectl -n policy-system logs deploy/policy-webhook --tail=80
$ kubectl get validatingwebhookconfiguration
```

Review `failurePolicy` with care. `Fail` rejects matching requests when the webhook is unavailable. `Ignore` allows matching requests through during webhook failure. A security boundary such as image signature verification often uses `Fail`, while a low-risk labeling helper may use `Ignore` to preserve API availability.

| Policy type | Common failure posture | Reason |
|-------------|------------------------|--------|
| Image signature or digest requirement | `Fail` | Unknown images are a security risk |
| Required ownership labels | Depends on maturity | Missing labels hurt operations, while an outage may block many teams |
| Sidecar injection | Depends on the sidecar purpose | Some services need the sidecar to function safely |
| Restricted Pod settings | `Fail` in protected namespaces | Unsafe Pods should not start in those namespaces |

Keep an emergency path documented. The path should name who can change webhook configuration, how the decision is approved during an incident, and how bypassed objects are reviewed after recovery. Emergency access without a review trail weakens the whole policy program.

## Policy Review Checklist
<!-- section-summary: A policy review checks the risk being prevented, the scope, the developer message, the rollout phase, and the exception process. -->

An admission policy review is a production change review. The rule will run inside real deploys, so reviewers need to understand the mistake it prevents and the operational cost when it denies a request. A small number of clear policies usually helps more than a long list of rules that developers cannot repair.

Use these questions before moving a policy into deny mode:

| Question | Why it matters |
|----------|----------------|
| What incident, audit finding, or production risk does this prevent? | Every rule should have a concrete reason |
| Which namespaces, resources, and operations does it touch? | Scope controls blast radius |
| Can a developer fix the denial from the message alone? | Clear messages reduce release delays |
| Has the rule run in audit or warn mode first? | Existing workloads may need cleanup |
| Are passing and failing examples tested? | Tests catch policy mistakes before deploys |
| Are exceptions narrow and reviewed? | Hidden bypasses weaken trust |
| Does the policy engine have health checks and owners? | The admission path is production infrastructure |

![Admission policy review checklist with request shape, CEL rule, policy engine, testing before deny, failure message, and release evidence](/content-assets/articles/article-containers-orchestration-kubernetes-operations-admission-control-and-policies/admission-policy-review.png)

*The review board keeps a policy change grounded in operations: scope the request shape, test the rule, make the failure message useful, and keep release evidence for denied changes.*

For `devpolaris-orders-api`, the first useful policies are boring on purpose: approved registry, immutable digest, restricted Pod settings, resource requests, and owner labels. Those rules stop common mistakes before Pods run, and each one has a fix the service team can understand.

## What's Next

Admission policies prevent unsafe objects from reaching the cluster. The next operations challenge is what happens after something still goes wrong in production. A safe cluster still needs a debugging workflow because incidents can come from rollouts, dependencies, traffic spikes, bad config, network paths, and human mistakes.

The next article keeps the same `devpolaris-orders-api` service and walks through a production debugging flow from symptom capture to evidence, mitigation, rollback, and incident review.

---

**References**

- [Kubernetes: Admission Controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) - Official overview of admission controller phases and built-in controllers.
- [Kubernetes: Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) - Documents mutating and validating admission webhooks.
- [Kubernetes: Validating Admission Policy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/) - Official guide for CEL-based admission validation.
- [Kubernetes: Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Explains namespace-level Pod Security enforcement.
- [Kubernetes: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Defines privileged, baseline, and restricted Pod security profiles.
- [Kyverno Documentation](https://kyverno.io/docs/) - CNCF policy engine documentation for validation, mutation, generation, and image verification.
- [OPA Gatekeeper Documentation](https://open-policy-agent.github.io/gatekeeper/website/docs/) - Policy engine documentation built around Open Policy Agent and Kubernetes admission.
- [Kubewarden Documentation](https://docs.kubewarden.io/) - CNCF policy engine documentation for WebAssembly-based Kubernetes admission policies.

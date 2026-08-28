---
title: "Admission Control and Policy Engines"
description: "Block risky Kubernetes desired state at the API boundary with built-in admission, CEL policies, policy bindings, and external policy engines."
overview: "Follow a privileged Pod request through authentication, authorization, mutation, validation, and storage. Then define invariants with ValidatingAdmissionPolicy and CEL, bind policy to scope, design failure and exceptions, test with server-side dry run, compare Kyverno and Gatekeeper, and roll out from audit to enforcement."
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

1. [Why Does Kubernetes Need Admission After Authorization?](#why-does-kubernetes-need-admission-after-authorization)
2. [How Do Mutation, Validation, and Built-in Controllers Differ?](#how-do-mutation-validation-and-built-in-controllers-differ)
3. [How Do ValidatingAdmissionPolicy and CEL Express Invariants?](#how-do-validatingadmissionpolicy-and-cel-express-invariants)
4. [How Should Denial, Failure, Exceptions, and Dry Runs Work?](#how-should-denial-failure-exceptions-and-dry-runs-work)
5. [How Do Shift-left Checks and Admission Enforcement Complement Each Other?](#how-do-shift-left-checks-and-admission-enforcement-complement-each-other)
6. [When Do Kyverno or Gatekeeper Fit Better Than Native CEL?](#when-do-kyverno-or-gatekeeper-fit-better-than-native-cel)
7. [How Do You Roll Out Policy Without Breaking the API?](#how-do-you-roll-out-policy-without-breaking-the-api)
8. [What Does a Complete Admission Policy Operating Model Look Like?](#what-does-a-complete-admission-policy-operating-model-look-like)
9. [Check Your Answers](#check-your-answers)

Kubernetes is a shared state machine. Clients submit desired state, the API server stores accepted objects, and controllers act to make reality match them. A small manifest can therefore request privileged processes, host mounts, public services, broad identities, or untrusted images.

Authentication, authorization, and admission answer different questions:

```text
authentication -> who is the caller?
authorization  -> may this identity attempt this API action?
admission      -> is this particular requested object acceptable now?
```

Suppose a deployment system is authorized to create Pods in namespace `payments`. That permission is necessary for delivery. It should not mean every Pod shape is safe. The same caller could submit an ordinary non-root API or a privileged Pod mounting the host filesystem.

The complete request path is:

```text
request
  -> authentication
  -> authorization
  -> mutating admission
  -> object defaulting and reinvocation where applicable
  -> validating admission
  -> store accepted state
  -> controllers act

any failed stage -> reject
```

Keep these questions in view as you work through the lesson:

1. **Why Does Kubernetes Need Admission After Authorization?**
2. **How Do Mutation, Validation, and Built-in Controllers Differ?**
3. **How Do ValidatingAdmissionPolicy and CEL Express Invariants?**
4. **How Should Denial, Failure, Exceptions, and Dry Runs Work?**
5. **How Do Shift-left Checks and Admission Enforcement Complement Each Other?**
6. **When Do Kyverno or Gatekeeper Fit Better Than Native CEL?**
7. **How Do You Roll Out Policy Without Breaking the API?**
8. **What Does a Complete Admission Policy Operating Model Look Like?**

## Why Does Kubernetes Need Admission After Authorization?
<!-- section-summary: Kubernetes is a shared desired-state machine; authorization decides who may submit a class of request, while admission decides whether this particular requested object is acceptable. -->

![Kubernetes admission request flow showing request, authentication, authorization, mutating admission, validating admission, store in etcd, and reject branch](/content-assets/articles/article-devsecops-kubernetes-security-admission-control-and-policy-engines/admission-request-flow.png)

Admission runs before the requested state becomes active. That timing is valuable. Rejecting a host-root mount after a runtime alert is too late; the process may already have accessed the node. Admission prevents known-bad state before execution.

Think in invariants rather than a collection of tool rules. Examples include:

- ordinary application Pods are never privileged;
- trusted images are referenced by digest;
- workloads do not use host namespaces or forbidden host paths;
- application containers run non-root with no privilege escalation;
- required ownership metadata is present;
- production resources meet environment policy;

An invariant is a property the cluster should preserve through every accepted state transition. The policy implementation is how the API server tests that property.

Admission is not limited to direct Pod creation. Deployments, Jobs, CronJobs, StatefulSets, DaemonSets, and custom controllers can produce Pods. Policy must cover the object forms and indirect paths through which unsafe runtime state can enter.

Updates matter as much as creates. A safe Deployment can be changed later to add a host mount or mutable image. A Secret, binding, or namespace label can change the meaning of an otherwise unchanged Pod. Match the operations that can alter the invariant and test old-object versus new-object behavior when policy needs to distinguish them.

Deletion can also be security-relevant, but blocking deletes carelessly can prevent incident response or cleanup. Admission should focus on transitions it can judge and leave lifecycle protection to purpose-built controls where appropriate. An invariant needs clear scope, not a reflexive rule over every verb.

Controllers amplify accepted state. If a custom resource asks an operator to create cloud resources or privileged Pods, admission on direct Pods may not constrain the original request enough. Validate the custom resource and the generated objects, and ensure the operator does not become an unreviewed bypass for less privileged callers.

The request's caller and object are both inputs. An emergency controller may be allowed a narrow exception unavailable to developers, but identity-based exceptions must resist impersonation and group drift. Prefer a dedicated protected subject and workload class over a generic administrator bypass.

## How Do Mutation, Validation, and Built-in Controllers Differ?
<!-- section-summary: Mutation changes the incoming object before storage, validation accepts or rejects the final request, and built-in controllers implement essential cluster-wide admission behavior. -->

Mutating admission asks what should be added or changed before validation and storage. It can apply defaults, inject a sidecar, add labels, or select platform configuration.

Validating admission asks whether the resulting object is allowed. It can reject privileged mode, an unapproved registry, missing resource limits, forbidden namespace selection, or a policy-specific invariant.

Mutation occurs before validation so validators evaluate the object Kubernetes intends to store after relevant changes. A mutating controller might add a required security field; validation then decides whether the complete result satisfies policy.

Mutation can improve consistency but can also hide behavior from authors. A manifest may look safe before an injector adds a sidecar with mounts or credentials. Review the stored result and ensure validators cover injected containers and volumes.

Validation is usually clearer for security-critical requirements. If an application omits a required non-root setting, rejection forces the owner to understand and declare it. Silent mutation can make local rendering differ from production and obscure responsibility.

Built-in admission controllers implement cluster functions such as defaults, namespace lifecycle, service-account behavior, resource limits, Pod Security, and many other protections. They are part of the API server configuration and can vary with cluster distribution.

External admission webhooks and policy engines extend the request path. A validating webhook receives an admission review, evaluates policy, and returns allow or deny. A mutating webhook can return patches. These components become production dependencies because every matching API request may wait for them.

Ordering and reinvocation matter when several mutators interact. One webhook can add fields another observes. Validators should evaluate the final effective object rather than assume no other component changed it.

Keep mutation idempotent: evaluating an already mutated object should not keep adding duplicate sidecars, volumes, or labels. Ambiguous mutation can create unstable desired state and difficult debugging.

Mutation ownership should be visible. If a platform injects a proxy, certificate mount, or telemetry agent, record which controller added it and which version. The injected container joins the Pod's process, network, volume, credential, and resource boundaries. Validation should inspect its resulting security context rather than exempt everything created by the platform.

Webhook matching needs precision. Broad matching increases latency and outage blast radius; narrow matching can leave resource versions or operations uncovered. Review API groups, versions, resources, subresources, operations, namespace selectors, and object selectors. An exclusion is part of the security policy even when it appears only in webhook configuration.

Conversion and defaulting can affect what a webhook sees. Policies should operate on stable supported representations and test resources submitted through versions clients actually use. A field absent from the request may receive a default before later validation, so author rules against the effective admission stage.

Built-in and external controllers can overlap. Pod Security Admission may reject an object before a custom webhook returns its more detailed message, or a mutator may change a field another validator checks. Document the layers so troubleshooting follows the real order instead of treating every denial as a policy-engine defect.

## How Do ValidatingAdmissionPolicy and CEL Express Invariants?
<!-- section-summary: Native ValidatingAdmissionPolicy uses CEL expressions to evaluate matched request objects, while separate bindings select scope, parameters, and validation actions. -->

`ValidatingAdmissionPolicy` provides native declarative validation in the Kubernetes API. Policies use Common Expression Language, or CEL, to evaluate the admission object and request context without calling an external webhook for each decision.

CEL is an expression language for boolean conditions over structured data. In admission, a validation expression normally evaluates to true when the object is acceptable and false when it violates the invariant.

A conceptual privileged-container check is:

```text
for every regular container:
  securityContext.privileged is absent or false
```

A simplified policy can express that shape:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: disallow-privileged-containers
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
        object.spec.containers.all(c,
          !has(c.securityContext) ||
          !has(c.securityContext.privileged) ||
          c.securityContext.privileged == false)
      message: "Privileged application containers are not allowed"
```

Real coverage must consider init containers, ephemeral containers, and Pod-producing templates where appropriate. The example demonstrates the reasoning path, not a complete organization policy.

Policy and binding are separate. The policy defines decision logic and match constraints. A `ValidatingAdmissionPolicyBinding` activates it for selected scope, can supply parameters, and chooses validation actions such as deny, warn, or audit behavior supported by the API.

This separation is important. One reviewed policy can be bound to production namespaces with denial and to migration namespaces with warnings. Bindings can select namespace or object scope without cloning and drifting the expression.

Parameter resources let one policy use environment-specific data, such as allowed values or thresholds, while keeping the core logic stable. Protect parameter changes because changing data can weaken a policy without editing its expression.

CEL policy should handle optional fields, types, and update semantics deliberately. A missing field can mean “use a default,” “not applicable,” or “violation” depending on the invariant. Tests need absent, false, true, malformed, and edge-shaped objects.

Bindings make rollout an authorization concern. A policy object can remain unchanged while a binding stops selecting production namespaces or changes from Deny to Warn. Protect binding edits, review selector overlap, and audit which policy-binding combinations are currently effective.

Parameters can separate reusable logic from organizational data. One rule may enforce an allowed registry set supplied by an environment-specific parameter. This reduces copied expressions but transfers authority to whoever edits the parameter. Validate parameter shape, define what happens when it is missing, and version significant changes.

CEL expressions should favor readability. Break complex requirements into multiple validations with specific messages rather than one deeply nested expression returning a generic denial. Reviewers can then connect each invariant to its tests and exception policy.

Update policies may use both the new and old object to stop privilege expansion while permitting harmless changes or controlled remediation. Test create, update from safe to unsafe, update from unsafe to safer, and unchanged legacy violations. Otherwise a new rule can trap teams by rejecting the very update needed to repair an existing object.

## How Should Denial, Failure, Exceptions, and Dry Runs Work?
<!-- section-summary: A policy denial is an intentional false decision, while failure policy handles evaluation errors or unavailability; exceptions must be narrow, and server-side dry run exercises the real cluster path without storing state. -->

`failurePolicy` is not the same as a policy decision to deny. A validation expression returning false is a normal policy result. Failure policy determines what happens when evaluation cannot complete correctly, such as a webhook timeout or internal error.

Failing closed protects the invariant but can block production API operations when the policy service fails. Failing open protects availability but creates a security gap. Choose per policy and request class, and monitor every fail-open event.

Native CEL avoids network calls to a separate webhook for its evaluation, reducing one failure mode. Policy configuration or expression errors still require safe rollout and testing.

Denial messages should identify the resource, offending field, requirement, and correction. “Policy failed” sends teams searching through engine internals. “Container app requests privileged mode; ordinary application Pods must set it false” makes the control teachable.

Exceptions should not be broad namespace escapes unless the namespace genuinely represents a privileged workload class. A label such as `skip-security=true` that any deployer can add destroys the invariant.

A useful exception records exact workload, exact rule, owner, reason, compensating controls, approval, expiry, and removal plan. Protect who can create or attach it. Ensure it does not match future unrelated workloads by accident.

Server-side dry run sends the request through the real API handling and admission path but does not persist it:

```bash
kubectl apply --server-side --dry-run=server -f workload.yaml
```

This is stronger than a local schema check because it asks the actual cluster with its versions, defaults, policies, bindings, parameters, and webhooks. It still does not prove runtime behavior or controller success, so combine it with test deployment and negative cases.

Test the policy itself: an ordinary non-root Pod should pass; a privileged regular, init, or ephemeral container should fail where covered; an intended exception should apply only inside its bounds; an expired or mismatched exception should fail.

Exercise engine failure separately from policy denial. Stop or isolate a webhook in a test environment and confirm requests follow the chosen failure policy, alerts fire, and API latency stays bounded. A denied object test does not prove resilience when the evaluator is unavailable.

Fail-open controls need retrospective evidence. Record which requests were admitted while evaluation failed and reevaluate those objects when service returns. Otherwise a temporary availability decision creates permanent unreviewed state. High-risk objects can be quarantined or reconciled automatically.

Fail-closed controls need a recovery path that does not hand every operator permanent bypass. Keep policy-service restoration, certificate repair, and controlled emergency override procedures available to a small accountable group. Test them before an API incident.

Exception matching should use stable immutable facts where possible. A mutable label controlled by the workload owner is weak. Namespace class, protected Service Account, exact policy parameter, and expiry can provide a stronger boundary. Test a nearby workload to prove it cannot borrow the exception.

Dry run should use the final rendered object and target cluster. A local chart value or partial template may omit injected or environment-specific details. Preserve dry-run warnings and decisions with the release so the later live request can be compared.

## How Do Shift-left Checks and Admission Enforcement Complement Each Other?
<!-- section-summary: Local and CI policy checks give fast feedback, while cluster admission remains the authoritative guardrail over the final object, identity, environment, defaults, and every creation path. -->

Shift-left checks run policy against source, rendered manifests, or deployment plans before a request reaches the cluster. They give developers fast feedback in editors, pre-commit hooks, and pull requests.

Admission checks the real request at the protected transition. It sees the caller, target cluster, namespace, stored objects available to policy, mutation result, and current policy version. It also covers manual commands and controllers that bypass one repository's CI.

The controls are complementary:

```text
local check -> quick author feedback
CI check    -> reviewed rendered artifact
dry run     -> real cluster admission without storage
admission   -> final enforced state transition
runtime     -> effective behavior after acceptance
```

Do not rely only on CI. A privileged user, alternate pipeline, emergency script, or custom controller may create state outside it. Do not rely only on admission either; late feedback slows delivery and encourages exception requests.

Use the same invariant and version where possible. If local policy accepts a manifest that production denies, capture the difference: policy bundle, parameters, Kubernetes version, mutation, or environment scope. Exact policy identity makes drift diagnosable.

Policy tests belong with rule changes. Include allowed fixtures, obvious denials, missing fields, update cases, exception cases, and historical escapes. A change to solve one false positive should not reopen an earlier unsafe state.

Shift-left results are feedback, not proof that the deployed object remained unchanged. Bind release evidence to the rendered manifest or digest and still let the API server evaluate the submitted request.

## When Do Kyverno or Gatekeeper Fit Better Than Native CEL?
<!-- section-summary: Native CEL, Kyverno, and Gatekeeper implement the same decision boundary with different authoring models, mutation, reporting, portability, and operational dependencies. -->

Native ValidatingAdmissionPolicy with CEL is attractive for validation close to the Kubernetes API, with no separate policy webhook for every decision. It fits field-level and request-context invariants that CEL can express clearly.

Kyverno uses Kubernetes-style YAML policies and can validate, mutate, generate, verify images, and report policy results. Its resource-oriented model can be approachable for teams already comfortable with Kubernetes manifests.

Gatekeeper uses Open Policy Agent and Rego through constraints and constraint templates. It fits organizations that use Rego across systems or need reusable policy logic and inventory-aware patterns supported by the engine.

![Admission policy engine options comparing ValidatingAdmissionPolicy with CEL, Kyverno with YAML policies, and Gatekeeper with Rego feeding into the API server](/content-assets/articles/article-devsecops-kubernetes-security-admission-control-and-policy-engines/admission-policy-engine-options.png)

Choose by required capabilities and operating model, not popularity. Compare:

- validation and mutation needs;
- policy language skills and testability;
- use of external or cluster inventory data;
- image verification and generation features;
- audit reporting and existing-resource scans;
- webhook latency and availability;
- multi-cluster distribution and versioning;
- exception and parameter management;
- ownership and incident response.

More than one engine can coexist, but overlapping rules can create inconsistent messages, added latency, and unclear ownership. Assign policy domains and avoid implementing the same invariant differently in three places without a migration plan.

Regardless of engine, protect policy definitions, bindings, parameters, webhook configurations, service identities, TLS, namespace selectors, and bypass permissions. A policy is only as strong as the path that can disable or evade it.

## How Do You Roll Out Policy Without Breaking the API?
<!-- section-summary: Policy is on the production request path, so inventory violations, test representative objects, progress through audit and warning to pilot enforcement, and monitor decision latency and availability. -->

Roll out from observation to enforcement:

```text
policy tests
  -> audit existing and incoming objects
  -> warn authors and CI
  -> repair common violations
  -> pilot deny in limited scope
  -> expand enforcement
  -> review evidence and exceptions
```

![Admission policy rollout showing audit, warn, pilot, deny, review evidence, and an expiring exception branch](/content-assets/articles/article-devsecops-kubernetes-security-admission-control-and-policy-engines/admission-policy-rollout.png)

Inventory existing state before blocking future state. A policy can allow current unsafe Pods to keep running while rejecting their next replacement, creating a delayed outage. Test controller rollouts and disaster recovery, not only new application deployment.

Admission latency is production API latency. Every matching webhook adds processing and can add network calls. Measure p50, p95, and p99 decision time, timeouts, error rate, saturation, and API-server impact. Keep expressions and external lookups bounded.

Availability design includes replicas, disruption handling, TLS rotation, dependency health, timeout budgets, and failure policy. A policy service should not depend on applications whose creation it blocks in a circular startup path.

Canary rule and engine upgrades. Send representative create and update requests, include negative fixtures, and compare decisions before broad activation. Preserve the previous policy version and an accountable rollback path that does not disable unrelated controls.

Monitor denies, warnings, audits, fail-open actions, webhook failures, exception matches, bypass use, policy changes, and binding or namespace-selector changes. High denial can indicate real unsafe behavior, a broken release template, or a policy false positive; ownership turns the metric into action.

Existing-object audit is different from admission. Admission evaluates transitions; an object already stored may remain noncompliant indefinitely. Periodic scans can identify historical or drifted state, but remediation must consider controller behavior and availability. Deleting a running Pod before its template is fixed only causes another denial or unsafe recreation.

Policy changes should publish expected impact: affected resources, predicted violations, owners, enforcement date, and repair guidance. This turns rollout into a managed platform change rather than a surprise security mandate. Track teams that have not tested before the deadline.

Latency budgets need per-policy attribution. One slow webhook can dominate request time while overall averages appear acceptable. Measure match rate, evaluation duration, timeouts, payload size, and downstream calls. Remove unnecessary match scope and external lookups from synchronous admission.

Policy engines can be security targets. A compromised engine or administrator can approve forbidden objects, mutate credentials, or suppress evidence. Use narrow Service Accounts, protected images, controlled network access, TLS verification, restricted configuration RBAC, and independent audit for the policy platform itself.

Recovery should restore the same versioned policy state across replicas and clusters. An emergency manual edit that repairs one webhook but leaves another with different rules creates inconsistent decisions. Distribute identified bundles or resources and verify active versions after repair.

## What Does a Complete Admission Policy Operating Model Look Like?
<!-- section-summary: A complete model owns invariants, policy code, activation scope, parameters, exceptions, engine health, evidence, and drift while recognizing the controls admission cannot provide. -->

Admission cannot solve everything. It evaluates API objects and request context. It does not prove that an image has no vulnerability, that a permitted application behaves honestly, that a network plugin enforces policy, that a Secret's downstream password is narrow, or that a node is uncompromised.

Use admission to prevent states it can evaluate reliably. Use runtime verification and detection for effective behavior. Use RBAC for API callers, NetworkPolicy for reachability, Pod security for process authority, and supply-chain controls for artifacts.

Policy drift is organizational drift. An invariant can weaken because the expression changes, a binding excludes a namespace, a parameter expands allowed values, a webhook fails open, an exception never expires, or a new controller creates an uncovered resource shape.

Own each part:

- requirement owner defines the invariant and risk;
- policy author implements and tests logic;
- platform owner operates activation and engine availability;
- application owner repairs violations;
- exception approver accepts bounded deviation;
- security and operations review evidence and incidents.

The complete flow is:

```text
security requirement
  -> versioned invariant and tests
  -> policy logic
  -> scoped binding and protected parameters
  -> local and CI feedback
  -> server-side dry run
  -> authenticated and authorized request
  -> mutation and final validation
  -> allow, deny, warn, or audit evidence
  -> runtime verification
  -> exception expiry and policy improvement
```

The deepest mental model is that admission protects state transitions:

```text
allowed next cluster state
  = authorized request
  + invariant-preserving object
  + available trustworthy enforcement
```

The sentence to remember is: authorization decides whether a caller may ask; admission decides whether the cluster may become what was requested.

## Check Your Answers

:::expand[Why Does Kubernetes Need Admission After Authorization?]{kind="recap"}
Authorization permits an identity to attempt an API action, while admission evaluates whether this particular desired-state transition preserves cluster invariants.
:::

:::expand[How Do Mutation, Validation, and Built-in Controllers Differ?]{kind="recap"}
Mutators change or default the incoming object, validators accept or reject the final result, and built-in controllers provide core cluster admission behavior.
:::

:::expand[How Do ValidatingAdmissionPolicy and CEL Express Invariants?]{kind="recap"}
Native policies evaluate matched objects with CEL, while bindings choose activation scope, parameters, and actions so logic and rollout can remain separate.
:::

:::expand[How Should Denial, Failure, Exceptions, and Dry Runs Work?]{kind="recap"}
Denial is an intentional policy decision, failure policy handles evaluation problems, exceptions must be narrow and expiring, and server dry run tests the real cluster path without storing state.
:::

:::expand[How Do Shift-left Checks and Admission Enforcement Complement Each Other?]{kind="recap"}
Local and CI checks provide fast feedback, while admission authoritatively evaluates the final cluster request and covers alternate creation paths.
:::

:::expand[When Do Kyverno or Gatekeeper Fit Better Than Native CEL?]{kind="recap"}
Choose native CEL, Kyverno, or Gatekeeper according to language, validation, mutation, inventory, reporting, and operating needs, while protecting every engine's bypass path.
:::

:::expand[How Do You Roll Out Policy Without Breaking the API?]{kind="recap"}
Test first, inventory existing violations, progress through audit and warning to pilot denial, and treat policy latency and availability as production API concerns.
:::

:::expand[What Does a Complete Admission Policy Operating Model Look Like?]{kind="recap"}
Own and version invariants, logic, bindings, parameters, exceptions, engine health, evidence, and drift while combining admission with independent runtime controls.
:::

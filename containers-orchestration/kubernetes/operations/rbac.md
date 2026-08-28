---
title: "RBAC"
description: "Use Kubernetes RBAC to connect real people and workloads to the smallest API permissions their jobs require."
overview: "RBAC authorizes a precise Kubernetes API request made by an authenticated identity. Roles define actions, bindings grant them, and ServiceAccounts give Pods workload identities."
tags: ["Kubernetes", "Operations", "RBAC", "Service Accounts", "Security"]
area: "Containers & Orchestration"
order: 5
id: article-containers-orchestration-kubernetes-operations-rbac
---

## Table of Contents

1. [What exactly does Kubernetes RBAC evaluate?](#what-exactly-does-kubernetes-rbac-evaluate)
2. [How do Role rules and bindings create a permission?](#how-do-role-rules-and-bindings-create-a-permission)
3. [How does a Pod use a service account identity?](#how-does-a-pod-use-a-service-account-identity)
4. [How do RoleBinding and ClusterRoleBinding change the scope?](#how-do-rolebinding-and-clusterrolebinding-change-the-scope)
5. [How can a rule target the precise action a job needs?](#how-can-a-rule-target-the-precise-action-a-job-needs)
6. [How do you prove both intended access and intended denial?](#how-do-you-prove-both-intended-access-and-intended-denial)
7. [Which permissions can quietly open a larger path through the cluster?](#which-permissions-can-quietly-open-a-larger-path-through-the-cluster)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

Kubernetes Role-Based Access Control, or RBAC, does not authorize an application in the abstract. It decides whether an authenticated identity may perform one precise API operation. Once a request is reduced to its identity, verb, API group, resource, optional subresource and name, and namespace, RBAC becomes mechanical.

For this request:

```http
PATCH /apis/apps/v1/namespaces/payments/deployments/api
```

the authorization attributes are approximately:

```text
subject:      system:serviceaccount:payments:deployment-restarter
verb:         patch
apiGroup:     apps
resource:     deployments
resourceName: api
namespace:    payments
```

Authentication first determines who made the request. Authorization then decides whether that identity may perform the operation. Admission comes afterward and decides whether the specific proposed object is acceptable.

HTTP methods map to authorization verbs: POST normally becomes `create`, PATCH becomes `patch`, and GET can mean `get`, `list`, or `watch` depending on the request. API version is not part of the RBAC resource rule, so the group is `apps`, not `apps/v1`.

RBAC searches the roles reachable through bindings that name the subject. If any rule matches, the request is allowed. Permissions are additive: RBAC has no deny rule that subtracts a grant found elsewhere.

Keep these questions in view as you work through the lesson:

1. **What exactly does Kubernetes RBAC evaluate?**
2. **How do Role rules and bindings create a permission?**
3. **How does a Pod use a service account identity?**
4. **How do RoleBinding and ClusterRoleBinding change the scope?**
5. **How can a rule target the precise action a job needs?**
6. **How do you prove both intended access and intended denial?**
7. **Which permissions can quietly open a larger path through the cluster?**

## What exactly does Kubernetes RBAC evaluate?
<!-- section-summary: RBAC compares an authenticated request tuple with every rule bound to the identity and allows the request when at least one rule matches. -->

### Reduce authorization to a request tuple

This makes a 403 mechanically investigable. Write down the authenticated subject, verb, API group, resource, optional subresource, object name, and namespace. A rule must match all relevant attributes, but only one matching grant is needed. Omitting a permission from one Role does not revoke the same permission granted by another binding.

### Keep authentication, authorization, and admission separate

These three API-server stages answer different questions:

```text
Authentication: Who presented this credential?
        ↓
Authorization:  May that identity make this API request?
        ↓
Admission:      Is the proposed object acceptable?
```

That order matters when interpreting a failure. Invalid or missing credentials fail before RBAC has a subject to evaluate. A `403 Forbidden` normally means the caller was authenticated but no authorizer granted the request. An admission rejection can happen after RBAC has allowed `create` or `update`, because the submitted object violates a policy. Giving the caller another Role does not solve an admission-policy violation.

The verb is also more specific than the HTTP method alone. One HTTP GET can mean three different authorization operations:

```text
GET /api/v1/namespaces/payments/pods/api-123
→ get one Pod

GET /api/v1/namespaces/payments/pods
→ list the Pod collection

GET /api/v1/namespaces/payments/pods?watch=true
→ watch the Pod collection
```

This is why software that first lists objects and then watches for changes can need `list` and `watch`, even though both requests use GET. Start from the request the client actually sends rather than guessing from its business description.

## How do Role rules and bindings create a permission?
<!-- section-summary: A Role or ClusterRole defines actions; a RoleBinding or ClusterRoleBinding assigns those actions to users, groups, or ServiceAccounts at a scope. -->

### A permission definition grants nothing by itself

The four main objects express two ideas:

```text
Role or ClusterRole
  = which actions exist

RoleBinding or ClusterRoleBinding
  = who receives those actions, and at what scope
```

A Role alone grants nobody anything:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: payments
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
```

A binding connects subjects to that permission set:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: reporter
  namespace: payments
subjects:
  - kind: ServiceAccount
    name: reporter
    namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
```

The subject's effective permissions are the union of all matching rules reachable through all of its bindings. A grant to read Secrets elsewhere remains effective even if another role omits Secrets.

For example, if three bindings grant `get pods`, `patch deployments`, and `get secrets`, the identity receives all three. Kubernetes RBAC contains no rule shaped like “deny Secrets” that cancels the third grant. Least-privilege review must therefore inspect the subject's complete binding graph, not only the Role nearest to the workload manifest.

The Role and binding are deliberately separate because the same permission definition may be assigned to different subjects. A Role can describe what a namespace-local reporter may do, while one RoleBinding grants it to a human group and another grants it to a ServiceAccount. Conversely, one subject can appear in several bindings. The API server follows every applicable connection and unions the rules it reaches.

Read a grant in two passes. First inspect `roleRef` to learn which permission set the binding references. Then inspect `subjects` and the binding's own namespace to learn who receives it and where. A Role with perfect least-privilege rules is inert until a binding names it; a narrowly named binding can still grant excessive authority if its referenced role is broad.

This gives a useful review question for every RBAC manifest pair:

```text
Role rule: What requests could this permission set match?
Binding:   Which identities receive those matches, at what scope?
```

Both answers must be narrow. Reviewing only one side leaves half of the grant unexplained.

## How does a Pod use a service account identity?
<!-- section-summary: A Pod authenticates to the Kubernetes API with the namespaced ServiceAccount selected in its spec, not with its Pod, Job, or image name. -->

### Follow workload ownership to the authenticated caller

The ServiceAccount `deployment-restarter` in namespace `payments` has this identity:

```text
system:serviceaccount:payments:deployment-restarter
```

A Pod selects it:

```yaml
spec:
  serviceAccountName: deployment-restarter
```

Modern Kubernetes provides short-lived, rotating projected tokens for that ServiceAccount. When code calls `https://kubernetes.default.svc` with the token, authentication produces the ServiceAccount identity and RBAC evaluates its request.

A container image, Pod name, and Job name are not workload API identities. If `serviceAccountName` is omitted, Kubernetes assigns the namespace's `default` ServiceAccount, which does not gain broad API access merely by existing. When a workload does not call the Kubernetes API, make that boundary explicit:

```yaml
automountServiceAccountToken: false
```

Use separate ServiceAccounts for separate jobs. A backup, deployment restarter, and metrics reader should not share one `automation` identity carrying the union of all three permission sets.

For the restart example, the complete chain is:

```text
Job
-> creates Pod
-> Pod selects deployment-restarter ServiceAccount
-> projected token authenticates that ServiceAccount
-> RoleBinding names the ServiceAccount
-> Role supplies get and patch on one Deployment
```

Kubernetes never authorizes “the Job” or “this image.” It authorizes the API request made with the Pod's ServiceAccount credential. That is why `serviceAccountName` is the critical connection between workload configuration and RBAC.

### Give each operational responsibility its own caller

Suppose a namespace contains three automated processes:

```text
backup Job             → ServiceAccount backup
restart Job            → ServiceAccount deployment-restarter
metrics collector      → ServiceAccount metrics-reader
```

With one shared `automation` ServiceAccount, each process inherits the union of every permission required by all three. Compromising the metrics collector could then expose backup or rollout authority even though metrics collection never needs it. Separate identities keep the permission graph aligned with separate responsibilities.

The token is a credential, not the source of the permission. It proves the Pod's ServiceAccount identity to the API server; bindings and roles decide what that identity can do. This distinction is useful during debugging: a mounted token can authenticate successfully and still receive a 403 because no matching rule exists.

Disabling automatic token mounting is the cleanest default for workloads that never call the Kubernetes API. It removes an unnecessary credential from the container rather than relying on an empty permission set alone. For workloads that do call the API, explicitly selecting the intended ServiceAccount makes the identity visible in the workload manifest and prevents an accidental dependency on the namespace's `default` account.

## How do RoleBinding and ClusterRoleBinding change the scope?
<!-- section-summary: A RoleBinding grants permissions only inside its namespace, while a ClusterRoleBinding grants a ClusterRole across the cluster. -->

### Definition scope and grant scope are different

The combinations are:

| Permission definition | Binding | Effective scope |
|---|---|---|
| Role | RoleBinding | One namespace |
| ClusterRole | RoleBinding | One namespace |
| ClusterRole | ClusterRoleBinding | Cluster-wide |
| Role | ClusterRoleBinding | Invalid combination |

A Role is namespaced. A ClusterRole is reusable and can also describe cluster-scoped resources or non-resource URLs. The name `ClusterRole` does not itself make a grant cluster-wide.

For example, a ClusterRole named `pod-reader` can be bound by a RoleBinding in `payments`. The subject can then read Pods only in `payments`. Binding the same ClusterRole with a ClusterRoleBinding extends the grant across namespaces.

Cluster-scoped resources such as Nodes, Namespaces, and PersistentVolumes require a ClusterRole and a cluster-scoped grant.

This lets a platform define one reusable ClusterRole such as `pod-reader`, then use separate RoleBindings to grant it only in `payments` and `catalogue`. Replacing those namespace bindings with a ClusterRoleBinding changes the reach to the entire cluster. The ClusterRole defines where the permission set *can* be used; the binding determines how broadly this subject actually receives it.

Consider the same ClusterRole through two different bindings:

```text
ClusterRole pod-reader
├─ RoleBinding in payments → read Pods in payments only
└─ RoleBinding in catalogue → read Pods in catalogue only
```

Nothing in the ClusterRole needs to be duplicated, yet neither grant reaches a third namespace. A ClusterRoleBinding changes the picture:

```text
ClusterRole pod-reader
└─ ClusterRoleBinding → read Pods across namespaces
```

This is the first-principles reason that `ClusterRole` must not be read as “cluster-wide access.” It is a cluster-scoped *definition*. The binding supplies the effective grant scope. For a genuinely cluster-scoped object such as a Node, there is no namespace in which a RoleBinding could contain the access, so a ClusterRole and ClusterRoleBinding are required.

## How can a rule target the precise action a job needs?
<!-- section-summary: Derive apiGroup, resource, subresource, verb, object name, and namespace from the real API calls made by the program. -->

### Derive the rule from the program's actual HTTP operations

Suppose a Job's only responsibility is to restart Deployment `api` in `payments`. The Job creates Pods, those Pods use a ServiceAccount, a RoleBinding grants that identity a Role, and the Role matches the requests:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: deployment-restarter
  namespace: payments
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: restart-api
  namespace: payments
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames: ["api"]
    verbs: ["get", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: deployment-restarter
  namespace: payments
subjects:
  - kind: ServiceAccount
    name: deployment-restarter
    namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: restart-api
---
apiVersion: batch/v1
kind: Job
metadata:
  name: restart-api
  namespace: payments
spec:
  template:
    spec:
      serviceAccountName: deployment-restarter
      restartPolicy: Never
      containers:
        - name: operator
          image: your-image
```

`resourceNames: ["api"]` prevents patching every Deployment in the namespace. If the program only sends PATCH, `patch` may be enough; if it first reads the Deployment, it also needs `get`. Base the role on observed API calls.

Subresources are separate. Reading `/pods/api-123/log` requires `pods/log`; permission to `get pods` does not automatically grant logs, exec, attach, or `deployments/scale`.

`resourceNames` cannot express every name restriction. Top-level `create` cannot generally be limited this way, and list or watch may require a matching field selector. RBAC controls request attributes; admission policy inspects fields inside a submitted object.

This boundary explains two common surprises. `get pods` does not imply `get pods/log`, `pods/exec`, or `pods/attach`, because each subresource is a distinct authorization request. And “may create only a Deployment named `api` with at most three replicas” is not one RBAC rule: create-name and object-field restrictions need admission policy because they depend on the submitted body rather than only the authorization tuple.

### Translate a request one coordinate at a time

For the restart operation, the path and method supply the rule mechanically:

| Request part | Authorization attribute | Rule field |
|---|---|---|
| `/apis/apps/v1` | API group `apps` | `apiGroups: ["apps"]` |
| `/deployments` | resource `deployments` | `resources: ["deployments"]` |
| `/api` | object name `api` | `resourceNames: ["api"]` |
| HTTP PATCH | verb `patch` | `verbs: ["patch"]` |
| `/namespaces/payments` | namespace `payments` | namespaced Role and RoleBinding |

The version `v1` selects an API representation but does not appear in the RBAC rule. The plural API resource is `deployments`, not the manifest kind `Deployment`. These small translations explain many rules that look correct at a glance but never match.

Now compare a log request:

```http
GET /api/v1/namespaces/payments/pods/api-123/log
```

The final path segment is a subresource, so its RBAC resource is `pods/log`. Granting `get` on `pods` authorizes reading the Pod object; it does not authorize reading the process output exposed through the log subresource. The same reasoning keeps interactive access such as `pods/exec` separate from ordinary Pod observation.

`resourceNames` is a valuable final narrowing dimension, but only when Kubernetes can authorize against a name. It works well for reading or patching the existing Deployment `api`. It cannot generally restrict a top-level create request to one eventual object name, and list or watch requests have additional matching limitations. When the restriction depends on the submitted object's fields—replica count, image, security settings, or allowed name—the matching layer is admission policy, not a broader or more elaborate RBAC rule.

## How do you prove both intended access and intended denial?
<!-- section-summary: Test the exact positive operation and nearby negative operations so successful work does not hide unintended authority. -->

### Least privilege needs a positive and a negative proof

Check the intended operation as the workload identity:

```bash
kubectl auth can-i patch deployments.apps/api \
  -n payments \
  --as=system:serviceaccount:payments:deployment-restarter
```

Expect `yes`. Then test boundaries:

```bash
kubectl auth can-i patch deployments.apps/database \
  -n payments \
  --as=system:serviceaccount:payments:deployment-restarter

kubectl auth can-i patch deployments.apps/api \
  -n production \
  --as=system:serviceaccount:payments:deployment-restarter
```

Both should return `no`. Also verify that the identity cannot delete the Deployment, read Secrets, create Pods, or create RoleBindings. Positive tests prove the job can work; negative tests prove the role did not silently expand into nearby dangerous operations.

For a real 403 response, translate the rejected request into subject, verb, group, resource, subresource, name, and namespace. Then inspect every binding containing the subject and every referenced role until the absent or mismatched attribute is clear.

Do not begin by adding permissions until the error disappears. That approach proves only that a broad enough grant can hide the mismatch. Instead, compare the failing request with the intended rule field by field:

```text
Is the program using the ServiceAccount you tested?
Is the verb get, list, watch, update, or patch?
Is the API group empty for a core resource, or named such as apps?
Is the operation against the main resource or a subresource?
Is the RoleBinding in the request's namespace?
Does resourceNames contain the object the client actually addresses?
```

`kubectl auth can-i` performs an authorization check without requiring the application to repeat the operation. The `--as` flag lets an authorized troubleshooter evaluate the ServiceAccount's identity, while Kubernetes authorization review APIs provide the underlying mechanism for self or subject access checks. The command result is evidence about authorization only; it does not prove that authentication, admission, networking, or the application itself is correct.

A useful test set states the boundary explicitly:

```text
patch deployment/api in payments       yes
patch deployment/database in payments  no
patch deployment/api in production     no
delete deployment/api                   no
get secrets                             no
create pods                             no
create rolebindings                     no
```

The first line proves the Job can perform its purpose. The remaining lines prove that the grant does not extend to nearby names, namespaces, verbs, credentials, or escalation paths.

## Which permissions can quietly open a larger path through the cluster?
<!-- section-summary: Review authority by what it can lead to, because Secrets, workload creation, exec, node proxies, bindings, role escalation, and impersonation can yield broader control. -->

### Review permissions by the authority they unlock next

Wildcard rules are obvious, but narrow-looking grants can also escalate:

- reading Secrets can expose credentials, including ServiceAccount credentials;
- creating or editing arbitrary workloads can select powerful ServiceAccounts, mount Secrets and volumes, or use dangerous Pod settings;
- `pods/exec` provides code execution inside running workloads;
- Node proxy access can bypass normal API authorization boundaries;
- creating RoleBindings can grant existing powers to new subjects;
- creating or editing Roles can introduce new permissions;
- `bind` bypasses normal protection when assigning a role;
- `escalate` bypasses normal protection when creating a role with permissions the caller does not possess;
- `impersonate` allows requests as another user, group, or ServiceAccount.

Kubernetes normally prevents a caller from binding permissions it does not already have unless it holds `bind`, and from creating a role containing permissions it lacks unless it holds `escalate`. Treat those verbs as highly sensitive.

Namespace design also matters. If untrusted users can create arbitrary Pods in the same namespace as a powerful ServiceAccount, ServiceAccount separation alone may not protect that identity. Combine RBAC with admission controls and namespace isolation.

The subtle case is workload creation. A caller that can create an arbitrary Pod may select another ServiceAccount in the namespace, mount available credentials or volumes, and exercise whatever Pod settings admission permits. Separating automation identities is necessary, but placing a powerful identity beside untrusted workload creators can reconnect the permissions indirectly. RBAC scope, namespace boundaries, and admission policy must be reviewed together.

### Trace the next action, not only the literal rule

A useful security review asks, “What new authority could this permission obtain?” rather than stopping at the resource name:

```text
get Secrets
→ recover credentials
→ authenticate as another system

create Pods
→ select ServiceAccounts, mounts, and container behavior
→ exercise authority available to the resulting workload

create RoleBindings
→ connect a subject to an existing permission set
→ potentially gain that permission set

create or update Roles
→ attempt to define permissions the caller did not previously hold
```

Kubernetes protects the last two paths. A caller normally cannot bind permissions it does not already possess unless it has the special `bind` verb, and cannot create a role containing permissions it lacks unless it has `escalate`. Those safeguards make `bind` and `escalate` especially sensitive grants rather than harmless administrative vocabulary. `impersonate` deserves the same scrutiny because it can let a request be evaluated as another user, group, or ServiceAccount.

The complete decision path is therefore:

```text
credential
→ authenticated subject
→ request attributes
→ bindings containing that subject
→ referenced Role or ClusterRole rules
→ one complete rule match means allowed
→ admission evaluates the proposed object
```

RBAC is understandable when every arrow is explicit. It does not answer what an application is broadly “allowed to do.” It answers whether this authenticated caller has at least one bound rule matching this precise API operation. Least privilege follows from narrowing each coordinate and proving that the necessary request succeeds while nearby dangerous requests do not.

Apply that model once more to the restart Job. Its image starts inside a Pod using `deployment-restarter`; the projected token authenticates as `system:serviceaccount:payments:deployment-restarter`. The program sends PATCH to the `apps` API group's `deployments` resource, object `api`, in `payments`. A RoleBinding in `payments` names that ServiceAccount and references a Role whose rule matches `patch`, `apps`, `deployments`, and `api`. The API server can therefore grant that request before admission evaluates the operation.

Change one coordinate and the proof changes. Patching `database` no longer matches `resourceNames`. Patching in `production` is outside the RoleBinding's namespace. Deleting `api` uses the ungranted `delete` verb. Reading the Pod's logs addresses `pods/log`, not `deployments`. The same identity can therefore complete its narrow job while every adjacent operation remains ungranted.

That is the practical definition of least privilege: not a short YAML file and not a role with a reassuring name, but a verified match for the required request plus verified mismatches for the dangerous neighboring requests. When a new software version adds another API call, repeat the derivation for that call instead of widening the existing rule speculatively.

Keep the workload manifest, its ServiceAccount, the binding, and the referenced permission definition visible as one security design. A change to any one of them can alter the actual caller or reachable rules. Reviewing the complete chain also exposes stale bindings: deleting or replacing a Job does not make an old grant harmless if another Pod can still select the same ServiceAccount. Identity lifecycle and permission lifecycle must stay aligned.

## Check Your Answers
<!-- section-summary: Reconstruct RBAC from the request tuple, rules and bindings, workload identity, scope, least-privilege derivation, testing, and escalation paths. -->

:::expand[What exactly does Kubernetes RBAC evaluate?]{kind="recap"}
It checks whether any rule bound to the authenticated subject matches the request's verb, API group, resource, subresource, name, and namespace. Grants are additive.
:::

:::expand[How do Role rules and bindings create a permission?]{kind="recap"}
Roles and ClusterRoles define actions. RoleBindings and ClusterRoleBindings assign those actions to users, groups, or ServiceAccounts at a scope.
:::

:::expand[How does a Pod use a service account identity?]{kind="recap"}
`serviceAccountName` selects a namespaced ServiceAccount whose projected token authenticates API calls. Pod, Job, and image names are not the workload identity.
:::

:::expand[How do RoleBinding and ClusterRoleBinding change the scope?]{kind="recap"}
A RoleBinding limits its grant to one namespace even when it references a ClusterRole. A ClusterRoleBinding grants a ClusterRole cluster-wide.
:::

:::expand[How can a rule target the precise action a job needs?]{kind="recap"}
Translate the program's actual API request into group, resource, subresource, verb, name, and namespace. Use `resourceNames` where the operation supports it.
:::

:::expand[How do you prove both intended access and intended denial?]{kind="recap"}
Use `kubectl auth can-i` as the real identity to test the required action and nearby forbidden resources, names, verbs, and namespaces.
:::

:::expand[Which permissions can quietly open a larger path through the cluster?]{kind="recap"}
Review Secrets, arbitrary workload creation, exec, node proxy, binding, role creation, `bind`, `escalate`, and `impersonate` by the broader authority they can unlock.
:::

## References

- [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/)
- [Authorization overview](https://kubernetes.io/docs/reference/access-authn-authz/authorization/)
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/)

---
title: "RBAC"
description: "Use Kubernetes RBAC to grant users, service accounts, and controllers the smallest permissions they need."
overview: "RBAC is Kubernetes authorization for API actions. You will learn how Roles, ClusterRoles, RoleBindings, and service accounts protect devpolaris-orders-api without blocking normal operations."
tags: ["rbac", "roles", "serviceaccounts", "security"]
order: 5
id: article-containers-orchestration-kubernetes-operations-rbac
---

## Table of Contents

1. [Why RBAC Shows Up During Operations](#why-rbac-shows-up-during-operations)
2. [How Kubernetes Reads a Request](#how-kubernetes-reads-a-request)
3. [Subjects: Users, Groups, and Service Accounts](#subjects-users-groups-and-service-accounts)
4. [Roles and RoleBindings](#roles-and-rolebindings)
5. [ClusterRoles and ClusterRoleBindings](#clusterroles-and-clusterrolebindings)
6. [Separate Runtime and Release Identities](#separate-runtime-and-release-identities)
7. [Testing Access With kubectl auth can-i](#testing-access-with-kubectl-auth-can-i)
8. [Troubleshooting Forbidden Errors](#troubleshooting-forbidden-errors)
9. [Reviewing RBAC Changes](#reviewing-rbac-changes)
10. [Operational Checklist](#operational-checklist)

## Why RBAC Shows Up During Operations
<!-- section-summary: RBAC controls which identities can ask the Kubernetes API to read or change specific resources. -->

A developer joins an incident call and needs to read Pod logs in the `orders` namespace. They run `kubectl logs`, and the API server returns `Forbidden`. The cluster knows who they are, but it has not been told that this user or group can read `pods/log`.

**RBAC** means role-based access control. In Kubernetes, RBAC answers authorization questions for the API server. Authentication tells Kubernetes who is calling. Authorization decides whether that caller can do the requested action.

Here is the concrete permission. A support group may get `get`, `list`, and `watch` on Pods and Events, plus `get` on the `pods/log` subresource, inside `orders`. That lets people inspect a failed rollout without giving them permission to exec into containers, read Secrets, delete Pods, or change Deployments.

Almost every operational task around `devpolaris-orders-api` turns into an API request. A release job patches the Deployment in the `orders` namespace. A developer reads Pods and Events after a failed rollout. A telemetry collector may watch Pods so it can attach Kubernetes metadata to spans. A controller updates status on the objects it manages. These tasks look different from the outside, but each one reaches the same API server.

That shared API is powerful, so access needs shape. The orders release identity should update the orders Deployment and watch rollout status. It should not read every Secret in the cluster, create ClusterRoleBindings, delete namespaces, or change another team's workload. A developer group may need read-only access in `orders`, while the application runtime may need no Kubernetes API access at all.

This is why RBAC matters during normal operations. It lets the team say, in YAML, which identity can perform which Kubernetes API actions in which scope. When a token leaks, a script has a bug, or a human runs the wrong command, RBAC decides whether the mistake stops at the namespace boundary.

To write useful RBAC, first read Kubernetes requests in the same shape the API server uses.

## How Kubernetes Reads a Request
<!-- section-summary: RBAC rules are easier to review when each request is read as subject, verb, resource, API group, and scope. -->

Kubernetes authorization checks a request through a few concrete fields: **subject**, **verb**, **resource**, **API group**, and **scope**. The subject is the caller. The verb is the API action. The resource is the object type. The API group is the API family, such as the core group for Pods or `apps` for Deployments. The scope is either one namespace or the whole cluster.

Here is a plain sentence for the orders release job:

The service account `system:serviceaccount:orders:orders-release` can `patch` `deployments` in the `apps` API group inside the `orders` namespace.

The matching Role rule looks like this:

```yaml
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch", "update"]
```

The verbs are Kubernetes API verbs, not shell commands. `kubectl rollout restart deployment/devpolaris-orders-api` may look like one command in a terminal, yet it patches the Deployment's Pod template. `kubectl rollout status` reads Deployment and ReplicaSet status and watches Pods. `kubectl logs` reads the `pods/log` subresource. The Role must match the API calls behind the command, not the words typed by the operator.

Subresources are a common source of confusion. Pod logs use `pods/log`, Pod exec uses `pods/exec`, and Deployment scale uses `deployments/scale`. A subject with `get pods` does not automatically have `get pods/log`. If a support user needs logs but not exec, grant `get` on `pods/log` and avoid `create` on `pods/exec`.

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events"]
    verbs: ["get", "list", "watch"]
```

This sentence style makes review much calmer. Instead of asking whether a role name sounds safe, you can ask what exact API requests it allows.

![RBAC request path showing a user or ServiceAccount request reaching the API server with verb, resource, namespace, RoleBinding, and allow or deny decision](/content-assets/articles/article-containers-orchestration-kubernetes-operations-rbac/rbac-request-path.png)

*The request path turns RBAC review into concrete fields. A permission is a subject asking for a verb on a resource inside a scope.*

Now we need to name the callers that receive those permissions.

## Subjects: Users, Groups, and Service Accounts
<!-- section-summary: RBAC can grant access to humans, teams, and in-cluster workloads, and each subject type has a different operational use. -->

An RBAC **subject** is the identity that receives permission. Kubernetes supports three subject kinds in RBAC: **User**, **Group**, and **ServiceAccount**.

A User usually comes from your authentication system. Kubernetes itself does not store normal user accounts the way a web app might. In many production clusters, users arrive through OIDC, a cloud provider identity integration, client certificates, or another authenticator. RBAC then sees a username and group names from that authentication layer.

A Group is a collection of users from that same authentication layer. For human access, group bindings are usually easier to manage than individual user bindings. The group `devpolaris-orders-developers` can receive read-only access to the `orders` namespace. When someone joins or leaves the team, the identity provider group changes; the Kubernetes RoleBinding does not need a new line for every person.

A ServiceAccount is a Kubernetes identity for a process. Pods can run as service accounts. Jobs, controllers, agents, and in-cluster tools also use service accounts when they call the API server. Kubernetes service account usernames have a predictable shape:

```console
system:serviceaccount:<namespace>:<name>
```

For the orders release job, that full subject is:

```console
system:serviceaccount:orders:orders-release
```

The namespace is part of the identity. `system:serviceaccount:orders:orders-release` and `system:serviceaccount:ci:orders-release` are different callers, even though the final name is the same. This matters when CI jobs run in a shared `ci` namespace but deploy into `orders`. The RoleBinding subject must match the identity that actually calls the API server.

With subjects defined, the next step is binding those subjects to namespaced permissions.

## Roles and RoleBindings
<!-- section-summary: A Role defines namespaced permissions, and a RoleBinding grants those permissions to selected subjects. -->

A **Role** is a namespaced set of RBAC rules. A **RoleBinding** attaches a Role to one or more subjects in that namespace. This pair is the normal starting point for application team access because it keeps permissions close to the namespace where the team works.

For `devpolaris-orders-api`, the release job needs to update the Deployment and inspect rollout evidence. It does not need Secret reads, Pod exec, namespace deletion, or cluster-wide access. The ServiceAccount, Role, and RoleBinding can live together in the `orders` namespace.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-release
  namespace: orders
```

The Role names the API groups, resources, and verbs the release job needs:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: orders-release-deployer
  namespace: orders
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events"]
    verbs: ["get", "list", "watch"]
```

The RoleBinding connects that Role to the ServiceAccount inside the same namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-release-deployer
  namespace: orders
subjects:
  - kind: ServiceAccount
    name: orders-release
    namespace: orders
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: orders-release-deployer
```

Read this YAML as a story. The release job runs as `orders-release`. The Role says it can read and patch Deployments and ReplicaSets, then read Pods, Pod logs, and Events. The RoleBinding connects that Role to that ServiceAccount inside `orders`.

Notice what is missing. There is no `secrets` resource. There is no `delete` verb. There is no `*` wildcard. There is no ClusterRoleBinding. That is the access shape you want for routine deployment automation.

For human read-only access, bind a group to a read role in the same namespace. Kubernetes ships a built-in `view` ClusterRole, and a RoleBinding can bind that ClusterRole only inside `orders`.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-developers-view
  namespace: orders
subjects:
  - kind: Group
    name: devpolaris-orders-developers
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
```

That example leads naturally to the next topic: ClusterRoles can be reused in one namespace or granted across the whole cluster, depending on the binding.

## ClusterRoles and ClusterRoleBindings
<!-- section-summary: ClusterRoles define reusable or cluster-scoped rules, while ClusterRoleBindings grant those rules across the cluster. -->

A **ClusterRole** is stored at cluster scope. It can describe permissions for cluster-scoped resources, such as Nodes, or for namespaced resources, such as Pods and Deployments. The binding decides how far those rules reach.

A **RoleBinding** can reference a ClusterRole and grant it only inside the RoleBinding namespace. The previous `orders-developers-view` example does exactly that. The group receives the built-in `view` ClusterRole only in the `orders` namespace.

A **ClusterRoleBinding** grants the referenced ClusterRole across the cluster. That is much larger. If you bind a group to `view` with a ClusterRoleBinding, that group can view allowed resources across namespaces. If you bind a service account to `cluster-admin`, that service account receives broad control across the cluster.

ClusterRoleBindings are appropriate for identities that truly need cluster-wide access: cluster operators, infrastructure controllers, admission controllers, monitoring agents, and security scanners. They are rarely the right answer for one application release job.

Here is a safer cluster-level example. A platform telemetry collector may need to watch Pods and Namespaces so it can attach Kubernetes metadata to telemetry. That identity can receive read-only list/watch access without receiving write access.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-collector
  namespace: observability
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-collector-k8s-metadata-reader
rules:
  - apiGroups: [""]
    resources: ["pods", "namespaces", "nodes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["replicasets"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-collector-k8s-metadata-reader
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: observability
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: otel-collector-k8s-metadata-reader
```

This is cluster-wide, but it is still narrow. The collector can read metadata needed for enrichment. It cannot patch Deployments, read Secrets, exec into Pods, or create RBAC objects. That difference matters during review. Cluster-wide does not have to mean cluster-admin.

![Scope binding map comparing Role and RoleBinding for namespace access with ClusterRole and ClusterRoleBinding for cluster access](/content-assets/articles/article-containers-orchestration-kubernetes-operations-rbac/scope-binding-map.png)

*The scope map separates reusable permissions from broad grants. A ClusterRole can be safe inside one namespace, while a ClusterRoleBinding changes the blast radius across the cluster.*

Now return to the orders application itself. The runtime identity and release identity should be separate.

## Separate Runtime and Release Identities
<!-- section-summary: The orders API runtime and the release automation have different jobs, so they should use different service accounts. -->

A **runtime identity** is the identity a running application Pod uses. A **release identity** is the identity automation uses to change Kubernetes objects during deployment. Combining them is convenient at first, then it creates unnecessary risk.

`devpolaris-orders-api` is a normal HTTP API. It handles order requests and talks to application dependencies. It does not need to call the Kubernetes API for routine request handling. Give it a dedicated ServiceAccount with no extra RBAC and disable automatic token mounting in the Pod.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api
  namespace: orders
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  template:
    spec:
      serviceAccountName: orders-api
      automountServiceAccountToken: false
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-07.1
```

`automountServiceAccountToken: false` tells Kubernetes to skip the default API token mount for the Pod. If an attacker gets code execution inside the container, the usual service account token path has no Kubernetes bearer token waiting there. Use this default for application Pods with no API calls in their normal runtime path.

The release job uses `orders-release`, a different identity with a Role that can patch Deployments. If that token leaks, the damage should stay around deployment actions in `orders`. If the runtime container is compromised, it should not inherit release permissions.

This split also helps incident response. When an audit log shows `system:serviceaccount:orders:orders-release` patched the Deployment, you know the deployment automation did it. When application traffic logs show a request handled by `devpolaris-orders-api`, that runtime path has a different identity and different permissions.

The split is only useful if you test it, so the next habit is asking the API server direct permission questions.

## Testing Access With kubectl auth can-i
<!-- section-summary: kubectl auth can-i turns RBAC review into direct yes-or-no permission tests. -->

`kubectl auth can-i` asks the API server whether a subject can perform an action. It is one of the most useful RBAC tools because it tests the actual authorization decision rather than what you hope the YAML means.

From an admin or sufficiently privileged troubleshooting context, test the release identity:

```bash
kubectl auth can-i patch deployments.apps \
  --as=system:serviceaccount:orders:orders-release \
  -n orders

kubectl auth can-i get pods/log \
  --as=system:serviceaccount:orders:orders-release \
  -n orders

kubectl auth can-i get secrets \
  --as=system:serviceaccount:orders:orders-release \
  -n orders

kubectl auth can-i delete namespaces \
  --as=system:serviceaccount:orders:orders-release
```

The expected answers for the release identity are:

```console
yes
yes
no
no
```

Those four checks prove both sides of least privilege. The identity can deploy and read rollout evidence. It cannot read Secrets or delete namespaces. Include negative checks because a role that only proves the happy path may still carry dangerous extra access.

You can test the runtime identity too:

```bash
kubectl auth can-i list pods \
  --as=system:serviceaccount:orders:orders-api \
  -n orders

kubectl auth can-i patch deployments.apps \
  --as=system:serviceaccount:orders:orders-api \
  -n orders
```

For a runtime identity with no API need, both answers should be `no`. The Deployment also disables token mounting, so the Pod should have neither useful RBAC nor a mounted token.

To inspect all visible permissions for one identity in a namespace, use `--list`:

```bash
kubectl auth can-i --list \
  --as=system:serviceaccount:orders:orders-release \
  -n orders
```

The list output is useful for scanning, but exact tests are clearer for pull requests and runbooks. A review should list the exact actions that must work and the exact sensitive actions that must fail.

When something fails anyway, Kubernetes usually tells you which field is wrong.

## Troubleshooting Forbidden Errors
<!-- section-summary: A Forbidden error names the subject, verb, resource, API group, and namespace that RBAC rejected. -->

An RBAC failure usually returns a `Forbidden` error. The useful part of the error is the permission sentence inside it.

```console
Error from server (Forbidden): deployments.apps "devpolaris-orders-api" is forbidden:
User "system:serviceaccount:orders:orders-release" cannot patch resource "deployments"
in API group "apps" in the namespace "orders"
```

Read that message slowly. The subject is `system:serviceaccount:orders:orders-release`. The missing verb is `patch`. The resource is `deployments`. The API group is `apps`. The namespace is `orders`. The fix should be the smallest Role rule that matches those fields, if the action is truly part of the release job.

Use `kubectl auth can-i` to reproduce the same decision:

```bash
kubectl auth can-i patch deployments.apps \
  --as=system:serviceaccount:orders:orders-release \
  -n orders
```

Then inspect the Role and binding that should grant it:

```bash
kubectl -n orders get role orders-release-deployer -o yaml
kubectl -n orders get rolebinding orders-release-deployer -o yaml
```

There are a few common fixes:

| Symptom | Likely cause | Better fix |
|---|---|---|
| Subject namespace in error is `ci`, binding names `orders` | The job runs as a different service account | Bind the real service account or run the job as the intended one |
| `cannot get resource "pods/log"` | Role grants `pods` but not `pods/log` | Add `pods/log` with `get` |
| `cannot patch resource "deployments"` | Role has `get`, `list`, `watch` only | Add `patch` for `deployments.apps` |
| Works in one namespace only | RoleBinding is namespaced | Add another namespace-specific RoleBinding if needed |
| Fix proposal uses `cluster-admin` | The error is being solved too broadly | Add the missing verb/resource/scope only |

The risky fix is a broad ClusterRoleBinding:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: orders-release-cluster-admin
subjects:
  - kind: ServiceAccount
    name: orders-release
    namespace: orders
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
```

This grants far more than the release job needs. It can hide the immediate error while creating a larger security and operations problem. A deployment token with cluster-admin can change any namespace, create new RBAC grants, read Secrets, and damage unrelated workloads. The better repair is to match the exact missing API action.

Once the error is fixed, record the permission as a reviewable contract.

## Reviewing RBAC Changes
<!-- section-summary: RBAC review should translate YAML into allowed and denied operational tasks for each identity. -->

A good RBAC review focuses on the job the identity performs. Names such as `deployer`, `reader`, and `operator` help humans, but the rules decide the access. Review the rules, the binding subject, and the scope together.

For the orders release identity, a pull request should include a small permission matrix:

```console
Identity: system:serviceaccount:orders:orders-release
Purpose: CI release job for devpolaris-orders-api

Allowed:
  get/list/watch deployments.apps in orders
  patch/update deployments.apps in orders
  get/list/watch replicasets.apps in orders
  get/list/watch pods, pods/log, and events in orders

Denied:
  get/list/watch secrets in orders
  delete deployments.apps in orders
  create rolebindings or clusterrolebindings
  delete namespaces
```

That matrix turns directly into tests:

```bash
for verb in get list watch patch update; do
  kubectl auth can-i "$verb" deployments.apps \
    --as=system:serviceaccount:orders:orders-release \
    -n orders
done

kubectl auth can-i get secrets \
  --as=system:serviceaccount:orders:orders-release \
  -n orders

kubectl auth can-i create clusterrolebindings.rbac.authorization.k8s.io \
  --as=system:serviceaccount:orders:orders-release
```

Sensitive RBAC reviews should also look for wildcards. Wildcards are not always wrong, but they deserve a reason. `verbs: ["*"]`, `resources: ["*"]`, and `apiGroups: ["*"]` make future permissions broader as APIs are added. For application release jobs, explicit verbs and resources are usually clearer.

Check for accidental cluster-wide grants:

```bash
kubectl get clusterrolebinding -o wide | grep orders-release
kubectl -n orders get rolebinding -o wide
```

If the identity appears in a ClusterRoleBinding, ask why namespace-scoped access is not enough. Some platform identities need cluster scope. The orders release identity usually does not.

For human access, prefer group subjects:

```yaml
subjects:
  - kind: Group
    name: devpolaris-orders-developers
```

Group bindings keep the cluster RBAC focused on team roles. Joiner, mover, and leaver workflows then happen in the identity provider, where they already belong.

RBAC review is not finished until the negative tests pass. A release identity that can deploy and also read every Secret has not met the goal, even if the deployment works.

## Operational Checklist
<!-- section-summary: The healthy RBAC shape separates identities, scopes permissions to the namespace, and tests both allowed and denied actions. -->

Use this checklist for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Runtime identity | `orders-api` service account has no extra API permissions |
| Runtime token | `automountServiceAccountToken: false` when the app does not need the API |
| Release identity | `orders-release` service account handles deployment automation |
| Release scope | Role and RoleBinding live in the `orders` namespace |
| Release verbs | Deployments and ReplicaSets allow only needed rollout verbs |
| Sensitive resources | Release identity cannot read Secrets |
| Cluster-wide grants | ClusterRoleBindings exist only for real cluster-wide jobs |
| Human access | Groups receive namespace-scoped read or admin access |
| Tests | `kubectl auth can-i` includes allowed and denied checks |
| Review notes | PR explains the operational task behind each permission |

![RBAC operations review checklist with separate identities, least privilege, can-i tests, forbidden evidence, binding review, and audit changes](/content-assets/articles/article-containers-orchestration-kubernetes-operations-rbac/rbac-operations-review.png)

*The review checklist keeps RBAC tied to operations: each identity has a job, positive and negative tests prove the job, and audit evidence explains later changes.*

RBAC is healthy when every identity has a plain reason to exist. The runtime identity serves traffic. The release identity deploys. The developer group investigates. The telemetry identity reads metadata. When those jobs stay separate, the cluster is much easier to operate and much safer to debug.

---

**References**

- [Kubernetes RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Official reference for Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, subjects, and default roles.
- [Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Explains service account identities for Pods and in-cluster processes.
- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/) - Command reference for testing Kubernetes authorization decisions.
- [Kubernetes API overview](https://kubernetes.io/docs/reference/using-api/) - Background on API groups, resources, and how clients talk to the API server.
- [Kubernetes RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/) - Guidance on least privilege, privilege escalation risks, and careful use of powerful permissions.
- [OpenTelemetry transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/) - Useful context for collectors that need Kubernetes metadata access through RBAC.

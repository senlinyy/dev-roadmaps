---
title: "RBAC"
description: "Use Kubernetes RBAC to grant users, service accounts, and controllers the smallest permissions they need."
overview: "RBAC is Kubernetes authorization for API actions. Roles, ClusterRoles, RoleBindings, and service accounts protect devpolaris-orders-api while normal operations keep working."
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
11. [References](#references)

## Why RBAC Shows Up During Operations
<!-- section-summary: RBAC decides who or what can perform a Kubernetes API action on a resource in a namespace or across the cluster. -->

Kubernetes **RBAC** is the authorization layer that decides whether a caller can perform an action on an API resource. In operations, it shows up whenever a release job deploys, a controller watches objects, a developer inspects Pods, or a runtime workload tries to call the Kubernetes API.

For `devpolaris-orders-api`, RBAC should let the release pipeline update the Deployment in the `orders` namespace, let developers inspect rollout evidence, and keep the running app from reading Secrets it never needs. The goal is small, named permissions tied to real jobs.

The fastest way to understand any RBAC decision is: **caller, action, resource, namespace**.

## How Kubernetes Reads a Request
<!-- section-summary: Every authorization decision combines the subject, verb, resource, and scope of the API request. -->

When a request reaches the API server, authentication identifies the caller, then authorization checks whether that caller has the requested permission. RBAC grants permissions by matching request fields against rules and bindings.

| Request part | Example | Meaning |
|---|---|---|
| Caller | `system:serviceaccount:orders:orders-release` | Who is asking |
| Verb | `patch` | What action they want |
| Resource | `deployments` | Which API resource they target |
| Namespace | `orders` | Where the action happens |

![RBAC request path showing a user or ServiceAccount request reaching the API server with verb, resource, namespace, RoleBinding, and allow or deny decision](/content-assets/articles/article-containers-orchestration-kubernetes-operations-rbac/rbac-request-path.png)

*The request path shows why RBAC review should name the exact subject, verb, resource, and scope.*

## Subjects: Users, Groups, and Service Accounts
<!-- section-summary: RBAC subjects are users, groups, and service accounts, and production clusters should bind them to clear operational jobs. -->

RBAC rules apply to **subjects**. Human access usually arrives as users and groups from an identity provider. Workload and automation access usually arrives as service accounts.

For the orders namespace, use separate subjects:

| Subject | Job |
|---|---|
| `devpolaris-orders-developers` group | Inspect Pods, logs, events, and Deployments |
| `orders-release` service account | Deploy and roll back the orders workload |
| `orders-api` service account | Run the application |

The runtime service account should have no extra API access unless the application truly calls Kubernetes. Many apps can set `automountServiceAccountToken: false` so the Pod receives no Kubernetes token.

## Roles and RoleBindings
<!-- section-summary: A Role defines allowed actions in a namespace, and a RoleBinding attaches those actions to subjects. -->

A **Role** is a list of permissions inside one namespace. A **RoleBinding** grants that Role to one or more subjects.

A release automation Role can look like this:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: orders-release
  namespace: orders
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
```

What this Role allows:

- The release job can inspect and update Deployments and ReplicaSets.
- It can read Pods for rollout status and failure evidence.
- It cannot read Secrets because Secrets are absent from the rules.

Bind the Role to the release service account:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-release
  namespace: orders
subjects:
  - kind: ServiceAccount
    name: orders-release
    namespace: orders
roleRef:
  kind: Role
  name: orders-release
  apiGroup: rbac.authorization.k8s.io
```

Binding notes:

- `subjects` names who receives the permission.
- `roleRef` names which Role they receive.
- The binding lives in `orders`, so the grant is namespace-scoped.

## ClusterRoles and ClusterRoleBindings
<!-- section-summary: ClusterRoles define reusable or cluster-wide permissions, while ClusterRoleBindings grant access across the whole cluster. -->

A **ClusterRole** can define permissions for cluster-scoped resources, or it can provide a reusable rule set for namespaced resources. A **ClusterRoleBinding** grants those permissions cluster-wide, so use it carefully.

Example for read-only node inspection:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-readonly
rules:
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]
```

What this allows:

- Reading node objects across the cluster.
- No Pod, Secret, or Deployment access by itself.
- No write actions because verbs are read-only.

![Scope binding map comparing Role and RoleBinding for namespace access with ClusterRole and ClusterRoleBinding for cluster access](/content-assets/articles/article-containers-orchestration-kubernetes-operations-rbac/scope-binding-map.png)

*The scope map separates namespace grants from cluster-wide grants.*

Prefer a RoleBinding to a ClusterRole when the job is namespace-specific. For example, a RoleBinding can bind a ClusterRole named `view` only inside `orders`.

## Separate Runtime and Release Identities
<!-- section-summary: Runtime Pods and release automation perform different jobs, so they should use different service accounts and different permissions. -->

The application that serves traffic and the automation that deploys it should use different identities. Mixing them makes incident response risky because a compromised app token could inherit release permissions.

Runtime Pod shape:

```yaml
spec:
  serviceAccountName: orders-api
  automountServiceAccountToken: false
```

What this shape means:

- The Pod has a named runtime identity.
- Kubernetes avoids mounting an API token into the Pod.
- The app can still serve HTTP traffic through Services.

Release job shape:

```yaml
spec:
  serviceAccountName: orders-release
```

The release identity receives the RoleBinding from the previous section. Keeping those identities separate makes permission review straightforward.

## Testing Access With kubectl auth can-i
<!-- section-summary: kubectl auth can-i turns an RBAC rule review into positive and negative tests. -->

Use `kubectl auth can-i` to test the exact request shape. Run both allowed and denied checks.

```bash
$ kubectl auth can-i patch deployments \
  --as=system:serviceaccount:orders:orders-release \
  -n orders
yes

$ kubectl auth can-i get secrets \
  --as=system:serviceaccount:orders:orders-release \
  -n orders
no
```

What these outputs prove:

- The release identity can patch Deployments in `orders`.
- The same identity cannot read Secrets in `orders`.
- The Role matches the deployment job without broad secret access.

You can test human groups too:

```bash
$ kubectl auth can-i get pods \
  --as=senlin@example.com \
  --as-group=devpolaris-orders-developers \
  -n orders
yes
```

The `yes` result confirms the group binding can inspect Pods in the namespace.

## Troubleshooting Forbidden Errors
<!-- section-summary: Forbidden errors should be read as missing caller, action, resource, or scope rather than patched with broad permissions. -->

A forbidden error usually includes the missing request shape. Read it carefully before adding a permission.

```bash
$ kubectl -n orders rollout restart deployment/devpolaris-orders-api \
  --as=system:serviceaccount:orders:orders-release
Error from server (Forbidden): deployments.apps "devpolaris-orders-api" is forbidden: User "system:serviceaccount:orders:orders-release" cannot patch resource "deployments" in API group "apps" in the namespace "orders"
```

What the error tells you:

- Caller: `system:serviceaccount:orders:orders-release`.
- Action: `patch`.
- Resource: `deployments.apps`.
- Namespace: `orders`.

The fix should add that exact permission if the release job needs it. Avoid jumping to `cluster-admin`, because that hides the useful shape of the error.

## Reviewing RBAC Changes
<!-- section-summary: RBAC review should tie each grant to an operational task and include positive and negative can-i evidence. -->

A strong RBAC pull request explains why each subject needs each action. It should include at least one positive and one negative test.

Example review note:

| Evidence | Result |
|---|---|
| `orders-release` can patch Deployments | `yes` |
| `orders-release` can read Secrets | `no` |
| `orders-api` receives an API token | `false` |
| Developers can read Pods and events | `yes` |

This review is small, but it prevents a common production drift: temporary broad access that stays after an urgent release.

## Operational Checklist
<!-- section-summary: The healthy RBAC shape separates identities, scopes permissions to the namespace, and tests both allowed and denied actions. -->

Use this checklist for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Runtime identity | `orders-api` service account has no extra API permissions |
| Runtime token | `automountServiceAccountToken: false` for apps with no Kubernetes API use |
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

RBAC is ready for production when every identity has a plain job: runtime serves traffic, release automation deploys, and human groups investigate or administer according to team role.

## References

- [Kubernetes RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Official reference for Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, subjects, and default roles.
- [Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Explains service account identities for Pods and in-cluster processes.
- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/) - Command reference for testing Kubernetes authorization decisions.
- [Kubernetes API overview](https://kubernetes.io/docs/reference/using-api/) - Background on API groups, resources, and how clients talk to the API server.
- [Kubernetes RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/) - Guidance on least privilege, privilege escalation risks, and careful use of powerful permissions.
- [OpenTelemetry transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/) - Useful context for collectors that need Kubernetes metadata access through RBAC.

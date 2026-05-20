---
title: "Kubernetes RBAC"
description: "Grant users, groups, service accounts, and automation only the Kubernetes API actions they need."
overview: "Kubernetes RBAC controls who can ask the API server to do what. This article explains subjects, verbs, resources, roles, bindings, and review evidence for a production namespace."
tags: ["rbac", "kubernetes", "access"]
order: 1
id: article-devsecops-kubernetes-security-kubernetes-rbac
---

## Table of Contents

1. [The API Is the Gate](#the-api-is-the-gate)
2. [Subjects, Verbs, and Resources](#subjects-verbs-and-resources)
3. [Roles](#roles)
4. [Bindings](#bindings)
5. [Testing Access](#testing-access)
6. [Review Evidence](#review-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The API Is the Gate

Kubernetes changes happen through the API server. A person running `kubectl`, a deployment workflow, a controller, or a pod using a service account all send API requests. Kubernetes RBAC decides whether those requests are allowed.

For `devpolaris-orders`, the first question is:

```text
Which identities can change objects in the production namespace?
```

The answer should separate human operators, deployment automation, and running workloads. A deploy workflow may update deployments. An on-call engineer may read pods and logs. The application pod may read its own config. These jobs need different permissions.

## Subjects, Verbs, and Resources

RBAC rules are access sentences.

```text
Subject can verb resource in scope.
```

For example:

```text
system:serviceaccount:orders-prod:orders-deployer can update deployments in namespace orders-prod.
```

The subject is the identity. The verb is the API action. The resource is the Kubernetes object type. The scope is usually a namespace or the whole cluster.

Common verbs include `get`, `list`, `watch`, `create`, `update`, `patch`, and `delete`. Reading logs often uses pod subresources. Updating a deployment is different from deleting a namespace.

## Roles

A Role describes allowed API actions inside a namespace.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: orders-deployer
  namespace: orders-prod
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "patch", "update"]
```

This role allows reading and changing deployments in the `orders-prod` namespace. It does not allow reading secrets, deleting pods, changing roles, or editing other namespaces.

ClusterRole is broader because it can apply across the cluster or to cluster-scoped resources. Use ClusterRole when the job truly needs cluster scope, such as managing nodes or cluster-wide policy. For application deployments, a namespace Role is usually easier to review.

## Bindings

A Role does nothing until a binding attaches it to a subject.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-deployer-binding
  namespace: orders-prod
subjects:
  - kind: ServiceAccount
    name: orders-deployer
    namespace: orders-prod
roleRef:
  kind: Role
  name: orders-deployer
  apiGroup: rbac.authorization.k8s.io
```

The binding says which service account receives the role. Read `subjects` and `roleRef` together. Many RBAC mistakes happen because a safe-looking role is bound to too many subjects.

## Testing Access

Use `kubectl auth can-i` to test one access sentence.

```bash
$ kubectl auth can-i update deployments \
  --as=system:serviceaccount:orders-prod:orders-deployer \
  -n orders-prod
yes

$ kubectl auth can-i get secrets \
  --as=system:serviceaccount:orders-prod:orders-deployer \
  -n orders-prod
no
```

The first command asks whether the deployer can update deployments in the namespace. The second asks whether it can read secrets. The answers match the intended role.

This test is useful in pull requests and incident response. It turns a complex set of roles and bindings into direct evidence.

## Review Evidence

An RBAC review should record the access sentence and tests.

```text
Subject: system:serviceaccount:orders-prod:orders-deployer
Allowed: get, patch, update deployments.apps in orders-prod
Denied: get secrets, delete namespaces, update roles
Reason: deployment workflow updates the orders deployment
Evidence: kubectl auth can-i checks attached to PR #431
Owner: platform-team
```

The denied actions matter because they show the role was tested for boundaries as well as success.

## Putting It All Together

Kubernetes RBAC controls API access. Subjects, verbs, resources, and scope form the access sentence. Roles describe allowed actions. Bindings attach roles to real identities.

For `devpolaris-orders`, human operators, deploy automation, and runtime service accounts should have separate access. Review each one through an access sentence and verify it with `kubectl auth can-i`.

## What's Next

RBAC controls who can ask Kubernetes for changes. Pod security controls what the resulting pod is allowed to do when it runs.

---

**References**

- [Kubernetes RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Kubernetes documents Roles, ClusterRoles, RoleBindings, subjects, verbs, and resources.
- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/) - Kubernetes documents testing authorization with `kubectl auth can-i`.

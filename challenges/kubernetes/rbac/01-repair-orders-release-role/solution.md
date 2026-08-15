`service-account.yaml`

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-release
  namespace: orders
```

`role.yaml`

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

`role-binding.yaml`

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-release
  namespace: orders
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: orders-release
subjects:
  - kind: ServiceAccount
    name: orders-release
    namespace: orders
```

- The two Role rules support rollout work and Pod evidence without granting Secret access.
- The namespaced RoleBinding joins the exact ServiceAccount and Role without creating cluster-wide permission.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: notifications-prod
  labels:
    app.kubernetes.io/part-of: customer-notification-platform
    environment: prod
```

- `metadata.name` creates the production scope used by namespaced notification resources.
- The labels identify the owning platform and production environment for policy and automation.

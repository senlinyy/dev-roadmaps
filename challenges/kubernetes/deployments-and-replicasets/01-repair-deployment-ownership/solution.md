`configmap.yaml`

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-api-config
  namespace: notifications
data:
  LOG_LEVEL: info
  DELIVERY_MODE: async
```

`deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
        app.kubernetes.io/component: api
    spec:
      containers:
        - name: api
          image: ghcr.io/customer-notification/notification-api:2026.06.14-1
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: notification-api-config
```

- Matching selector and template labels let the Deployment own the Pods created from its template.
- The named ConfigMap reference keeps runtime settings outside the image while preserving a reviewable dependency.

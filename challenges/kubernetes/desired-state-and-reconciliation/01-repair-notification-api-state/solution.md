```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/notification-api:1.4.3
          ports:
            - name: http
              containerPort: 3000
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
```

- Matching selector and template labels give the controller a stable ownership contract.
- Readiness keeps recovering Pods out of Service endpoints.
- The rolling update can add one temporary Pod without reducing the requested available count.

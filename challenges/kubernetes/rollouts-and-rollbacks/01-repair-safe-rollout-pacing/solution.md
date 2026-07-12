```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications
spec:
  replicas: 3
  minReadySeconds: 10
  progressDeadlineSeconds: 300
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/customer-notification/notification-api:2026.06.14-2
```

- The strategy keeps three Pods available while bringing up one replacement at a time.
- The readiness window and progress deadline distinguish stable availability from a rollout that has stopped advancing.

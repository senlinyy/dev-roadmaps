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
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/customer-notification/notification-api:2026.06.14-2
          resources:
            requests:
              cpu: 300m
              memory: 384Mi
            limits:
              cpu: "1"
              memory: 768Mi
```

- Requests reserve placement capacity for each replica and any rollout surge Pod.
- The higher limits allow bounded bursts, with CPU throttling and memory termination remaining distinct runtime outcomes.

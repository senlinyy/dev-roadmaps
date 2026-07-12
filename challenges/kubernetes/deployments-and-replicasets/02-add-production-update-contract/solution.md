```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications
spec:
  replicas: 3
  progressDeadlineSeconds: 300
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
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
          resources:
            requests:
              cpu: 300m
              memory: 384Mi
            limits:
              cpu: "1"
              memory: 768Mi
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 5
            failureThreshold: 3
```

- The rollout can add one Pod while keeping all three desired replicas available.
- Readiness prevents a new Pod from receiving traffic before it can serve requests.

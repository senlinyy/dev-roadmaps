```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-worker
  namespace: customer-notifications
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-worker
  template:
    metadata:
      labels:
        app: notification-worker
    spec:
      containers:
        - name: worker
          image: ghcr.io/customer-notifications/notification-worker:1.8.0
          ports:
            - name: metrics
              containerPort: 9090
          env:
            - name: QUEUE_NAME
              valueFrom:
                configMapKeyRef:
                  name: notification-worker-config
                  key: QUEUE_NAME
            - name: EMAIL_PROVIDER_TOKEN
              valueFrom:
                secretKeyRef:
                  name: notification-worker-secrets
                  key: EMAIL_PROVIDER_TOKEN
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
```

- The ConfigMap carries plain queue configuration, while the Secret carries the sensitive provider token.
- `fieldRef` supplies the live Pod name assigned by Kubernetes.

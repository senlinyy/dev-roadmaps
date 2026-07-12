```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: customer-notifications
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/customer-notifications/notification-api:1.8.0
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: notification-api-secrets
                  key: DATABASE_URL
            - name: WEBHOOK_SIGNING_KEY
              valueFrom:
                secretKeyRef:
                  name: notification-api-secrets
                  key: WEBHOOK_SIGNING_KEY
```

- Explicit references deliver only the approved keys to the process.
- The Deployment exposes the credential contract without containing either credential value.

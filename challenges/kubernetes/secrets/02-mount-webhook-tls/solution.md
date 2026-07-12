```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webhook-receiver
  namespace: customer-notifications
spec:
  replicas: 2
  selector:
    matchLabels:
      app: webhook-receiver
  template:
    metadata:
      labels:
        app: webhook-receiver
    spec:
      volumes:
        - name: notification-webhook-tls
          secret:
            secretName: notification-webhook-tls
            items:
              - key: tls.crt
                path: server.crt
              - key: tls.key
                path: server.key
      containers:
        - name: api
          image: ghcr.io/customer-notifications/webhook-receiver:1.8.0
          ports:
            - name: https
              containerPort: 8443
          volumeMounts:
            - name: notification-webhook-tls
              mountPath: /etc/notification/tls
              readOnly: true
```

- The `items` list exposes only the certificate and private key with the filenames the receiver expects.
- The read-only mount documents that the application consumes the projected credentials.

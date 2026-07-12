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
      volumes:
        - name: worker-routing
          configMap:
            name: notification-worker-files
            items:
              - key: routing.yaml
                path: provider-routing.yaml
            defaultMode: 420
      containers:
        - name: worker
          image: ghcr.io/customer-notifications/notification-worker:1.8.0
          ports:
            - name: metrics
              containerPort: 9090
          volumeMounts:
            - name: worker-routing
              mountPath: /etc/notification
              readOnly: true
```

- `items` exposes only the routing key and gives it the filename the worker expects.
- Decimal mode `420` represents normal read-only configuration file permissions, and the container mount is explicitly read-only.

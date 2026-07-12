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
        - name: notification-routing
          configMap:
            name: notification-routing-config
      containers:
        - name: worker
          image: ghcr.io/customer-notifications/notification-worker:1.8.0
          ports:
            - name: metrics
              containerPort: 9090
          volumeMounts:
            - name: notification-routing
              mountPath: /etc/notification
              readOnly: true
```

- The ConfigMap keys appear as files under `/etc/notification`.
- The shared volume name connects the source object to the worker mount.

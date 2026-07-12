```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: notification-postgres
  namespace: notifications
spec:
  serviceName: notification-postgres
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-postgres
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-postgres
    spec:
      containers: []
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOncePod"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi
```

- `serviceName` connects ordinal Pod DNS identities to the headless Service.
- The `data` template creates a separate durable claim for each Pod ordinal.

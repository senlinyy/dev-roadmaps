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
      containers:
        - name: postgres
          image: postgres:16.4
          ports:
            - name: postgres
              containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: notification-postgres-auth
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: notification-postgres-auth
                  key: password
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
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

- Secret references keep database credentials out of the manifest.
- The shared `data` name connects the container mount to the ordinal PVC.

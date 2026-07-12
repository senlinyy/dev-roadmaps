```yaml
apiVersion: v1
kind: Pod
metadata:
  name: notification-postgres
  namespace: customer-notifications
spec:
  containers:
    - name: postgres
      image: postgres:16
      env:
        - name: PGDATA
          value: /var/lib/postgresql/data
      volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
  volumes:
    - name: postgres-data
      persistentVolumeClaim:
        claimName: notification-postgres-data
```

- The Pod volume selects the namespaced claim.
- The matching mount exposes that durable volume at PostgreSQL's data path.

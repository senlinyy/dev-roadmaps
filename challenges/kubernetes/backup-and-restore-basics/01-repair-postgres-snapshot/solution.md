```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: notification-postgres-2026-06-28
  namespace: customer-notifications
spec:
  source:
    persistentVolumeClaimName: notification-postgres-data
```

- The snapshot request names the PVC that contains the PostgreSQL data.
- The snapshot and source claim use the same namespace.

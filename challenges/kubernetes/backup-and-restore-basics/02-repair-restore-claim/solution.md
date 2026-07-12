```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notification-postgres-data-restore
  namespace: customer-notifications
spec:
  dataSource:
    name: notification-postgres-2026-06-28
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

- The new claim restores from the named VolumeSnapshot without overwriting the original claim.
- The data source fields identify the snapshot API and object precisely.

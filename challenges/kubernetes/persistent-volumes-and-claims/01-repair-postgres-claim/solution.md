```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notification-postgres-data
  namespace: customer-notifications
spec:
  storageClassName: fast-ssd
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

- The PVC requests capacity and access characteristics without naming a specific backing disk.
- `fast-ssd` makes the intended storage profile explicit for reviewers and provisioning.

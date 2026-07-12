```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: notification-add-provider-status-20260614
  namespace: notifications
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/customer-notification/notification-api:2026.06.14-2
          command: ["node"]
          args: ["scripts/migrate-notifications.js", "--operation=provider-status-20260614"]
```

- The explicit command overrides the image's service entry point with finite migration work.
- Retry, deadline, and TTL fields bound execution while retaining short-term evidence.

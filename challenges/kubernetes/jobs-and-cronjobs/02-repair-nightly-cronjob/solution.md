```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: notification-expire-stale-deliveries
  namespace: notifications
spec:
  schedule: "15 2 * * *"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 900
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: cleanup
              image: ghcr.io/customer-notification/notification-worker:2026.06.14-2
              command: ["node"]
              args: ["scripts/expire-stale-deliveries.js"]
```

- The outer spec controls scheduling and overlap; the nested Job spec controls each finite run.
- History limits preserve recent evidence without keeping every finished Job.

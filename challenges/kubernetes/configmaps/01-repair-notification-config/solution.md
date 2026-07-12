```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-api-config
  namespace: customer-notifications
data:
  LOG_LEVEL: "info"
  EMAIL_PROVIDER_URL: "http://email-gateway.customer-notifications.svc.cluster.local:8080"
  REQUEST_TIMEOUT_MS: "2500"
```

- `data` holds plain string settings that can be reviewed separately from the image.
- The namespace keeps the ConfigMap beside the workload that consumes it.

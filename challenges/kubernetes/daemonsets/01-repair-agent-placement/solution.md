```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: notification-log-agent
  namespace: observability
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-log-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-log-agent
    spec:
      nodeSelector:
        devpolaris.io/node-pool: app
      tolerations:
        - key: dedicated
          operator: Equal
          value: app
          effect: NoSchedule
      containers: []
```

- The node selector limits coverage to the application pool.
- The toleration allows the agent onto nodes protected by the dedicated app taint.

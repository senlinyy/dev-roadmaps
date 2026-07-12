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
      containers:
        - name: agent
          image: ghcr.io/customer-notification/log-agent:2026.06.14
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          volumeMounts:
            - name: varlogcontainers
              mountPath: /var/log/containers
              readOnly: true
      volumes:
        - name: varlogcontainers
          hostPath:
            path: /var/log/containers
            type: Directory
```

- The read-only mount gives the agent the node logs it needs without writable host access.
- Per-Pod resources multiply across every eligible node, so the manifest keeps them explicit.

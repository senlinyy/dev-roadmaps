```yaml
apiVersion: v1
kind: Pod
metadata:
  name: orders-api
  namespace: production
  labels:
    app: orders-api
spec:
  restartPolicy: Always
  containers:
    - name: api
      image: ghcr.io/devpolaris/orders-api:2026.07.11
      ports:
        - containerPort: 8080
      env:
        - name: LOG_LEVEL
          value: info
```

- `metadata.labels.app` gives Services and controllers a stable workload identity.
- `containerPort` records the port the application listens on inside the Pod.
- `restartPolicy: Always` lets the kubelet restart the application container after a failure.

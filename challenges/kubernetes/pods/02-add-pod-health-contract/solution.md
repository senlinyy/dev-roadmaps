```yaml
apiVersion: v1
kind: Pod
metadata:
  name: orders-api
  namespace: production
  labels:
    app: orders-api
spec:
  containers:
    - name: api
      image: ghcr.io/devpolaris/orders-api:2026.07.11
      ports:
        - containerPort: 8080
      startupProbe:
        httpGet:
          path: /startup
          port: 8080
        periodSeconds: 5
        failureThreshold: 24
      readinessProbe:
        httpGet:
          path: /ready
          port: 8080
        periodSeconds: 5
        failureThreshold: 3
      livenessProbe:
        httpGet:
          path: /live
          port: 8080
        periodSeconds: 10
        failureThreshold: 3
```

- The startup window is `5 × 24 = 120` seconds.
- Failed readiness removes the Pod from Service endpoints without restarting the container.
- Failed liveness restarts the container after startup has succeeded.

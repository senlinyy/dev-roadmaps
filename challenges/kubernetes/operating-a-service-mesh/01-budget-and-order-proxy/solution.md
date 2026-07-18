```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: store
spec:
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
      annotations:
        sidecar.istio.io/proxyCPU: 100m
        sidecar.istio.io/proxyMemory: 128Mi
        sidecar.istio.io/proxyCPULimit: 500m
        sidecar.istio.io/proxyMemoryLimit: 512Mi
        proxy.istio.io/config: |
          holdApplicationUntilProxyStarts: true
    spec:
      containers:
        - name: checkout
          image: registry.example.com/checkout:3.7.0
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 1
              memory: 1Gi
```

The scheduler can now account for proxy overhead, and the application does not race ahead of sidecar readiness. Istio remains responsible for injecting the proxy container.

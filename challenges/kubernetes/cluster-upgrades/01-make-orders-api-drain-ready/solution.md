`deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026.08.1
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 5
            failureThreshold: 3
```

`pod-disruption-budget.yaml`

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
```

Readiness determines which replicas count as available, while the matching PDB selector protects exactly those Pods during a voluntary node drain.

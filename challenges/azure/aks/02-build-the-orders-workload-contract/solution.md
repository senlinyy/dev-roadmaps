### `k8s/service-account.yaml`

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api
  namespace: orders
  annotations:
    azure.workload.identity/client-id: 11111111-2222-3333-4444-555555555555
```

### `k8s/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: orders
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: orders-api
      containers:
        - name: orders-api
          image: ghcr.io/devpolaris/orders-api:2026.08.1
          ports:
            - name: http
              containerPort: 3000
          readinessProbe:
            httpGet:
              path: /ready
              port: http
          livenessProbe:
            httpGet:
              path: /live
              port: http
```

### `k8s/service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  type: ClusterIP
  selector:
    app: orders-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

### `service.yaml`

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: orders-api
  labels:
    environment: production
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "2"
        autoscaling.knative.dev/maxScale: "10"
    spec:
      serviceAccountName: orders-runtime@devpolaris-prod.iam.gserviceaccount.com
      containers:
        - name: orders-api
          image: europe-west2-docker.pkg.dev/devpolaris-prod/apps/orders-api:2026.08.1
          ports:
            - name: http1
              containerPort: 8080
          env:
            - name: PAYMENTS_API_TOKEN
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: payments-api-token
```

`charts/orders-api/values.yaml`

```yaml
replicaCount: 1
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"
```

`charts/orders-api/templates/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: orders-api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

- Helm combines the values with the template and emits ordinary Kubernetes YAML.

### values.yaml

```yaml
replicaCount: 3
image:
  repository: registry.example.com/orders-api
  tag: "2.6.0"
```

### values.schema.json

```json
{
  "type": "object",
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "tag": { "type": "string", "minLength": 1 }
      },
      "required": ["repository", "tag"]
    }
  },
  "required": ["replicaCount", "image"]
}
```

### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-orders
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: orders
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-runtime
                  key: database-url
```

The schema catches malformed release inputs before rendering. The template consumes reviewed image values while keeping database credentials outside Helm values.

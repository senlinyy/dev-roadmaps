`values.yaml`

```yaml
replicaCount: 2
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: 2026.08.1
service:
  port: 80
```

`templates/_helpers.tpl`

```gotemplate
{{- define "orders-api.name" -}}
orders-api
{{- end -}}

{{- define "orders-api.selectorLabels" -}}
app.kubernetes.io/name: orders-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

`templates/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "orders-api.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "orders-api.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

`templates/service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  selector:
    {{- include "orders-api.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
```

The chart keeps a small public values surface while one namespaced helper preserves label consistency across controller ownership and Service selection.

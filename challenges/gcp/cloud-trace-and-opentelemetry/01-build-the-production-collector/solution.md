### `otel-collector.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc: {}
      http: {}
processors:
  resource:
    attributes:
      - key: service.name
        value: orders-api
        action: upsert
      - key: deployment.environment.name
        value: production
        action: upsert
  batch:
    timeout: 5s
exporters:
  googlecloud:
    project: devpolaris-prod
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [googlecloud]
```

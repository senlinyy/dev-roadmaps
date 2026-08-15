### `adot-collector.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 256
  batch:
    timeout: 5s
exporters:
  awsxray:
    region: eu-west-2
  awscloudwatchlogs:
    region: eu-west-2
    log_group_name: /adot/orders-api
    log_stream_name: collector
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [awsxray]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [awscloudwatchlogs]
```

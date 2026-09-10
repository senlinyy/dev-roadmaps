### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - rollout:
      batch: 1
      surge: 1
      readiness: "application"
      timeout: 60
      drain: 40
      removeTraffic: true
      compatibility: true
      onFailure: "stop"
  - verify: {}
```

A bounded replacement batch preserves capacity while the old endpoints are removed from traffic and receive enough time to finish payment requests.

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
      drain: 20
      removeTraffic: true
      compatibility: true
      onFailure: "stop"
  - verify: {}
```

A one-replica surge retains serving capacity while the replacement warms. The deadline covers the slow healthy case; an unhealthy application holds before traffic is advanced.

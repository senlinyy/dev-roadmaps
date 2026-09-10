### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - rollout:
      batch: 1
      surge: 0
      readiness: "application"
      timeout: 60
      drain: 20
      removeTraffic: true
      compatibility: true
      onFailure: "stop"
  - verify: {}
```

One old replica can leave at a time while three continue serving. Application readiness prevents premature routing, and traffic removal plus the full drain interval prevents dropped work.

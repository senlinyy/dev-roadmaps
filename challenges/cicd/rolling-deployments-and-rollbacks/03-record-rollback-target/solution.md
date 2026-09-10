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
      onFailure: "rollback"
  - verify: {}
```

Compatibility is checked before exposure. Readiness failures also enter the recovery branch; the simulator restores and health-checks the retained blue release rather than recording a textual rollback intention.

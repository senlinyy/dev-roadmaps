### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - preflight:
      checks:
        - "baseline"
        - "lock"
        - "capacity"
        - "compatibility"
        - "rollback"
        - "authorization"
  - execute:
      operation: "migrate-expand"
      retry: "resume"
  - execute:
      operation: "deploy"
      retry: "resume"
  - postflight:
      onFailure: "rollback"
  - execute:
      operation: "record"
      retry: "resume"
```

Stable operation checkpoints distinguish a missing action from a lost acknowledgement. Resume reconciles committed state, avoids duplicate effects and performs fresh postflight verification.

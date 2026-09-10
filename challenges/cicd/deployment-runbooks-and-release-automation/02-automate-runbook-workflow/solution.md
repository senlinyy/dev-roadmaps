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

Complete preflight fails cheaply before mutations. Healthy runs still need the migration, deployment, postflight and release record in a safe order.

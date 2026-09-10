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

The stages preserve ordering and prove outcomes. A failed postflight recovers the previous compatible release without claiming that the candidate succeeded.

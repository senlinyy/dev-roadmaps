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
  - execute:
      operation: "contract"
      retry: "resume"
  - postflight:
      onFailure: "escalate"
```

Irreversible contract is separately authorized after verified release state. Later failure stops automation and escalates without crossing back through an unavailable binary rollback path.

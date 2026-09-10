### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - prepare:
      config: "runtime.yaml"
      secrets:
        - "secret/orders-db"
      timeout: 60
  - validate:
      checks:
        - "health"
        - "config"
        - "sessions"
        - "schema"
        - "queue"
  - switch:
      target: "green"
  - verify: {}
```

### runtime.yaml

```yaml
DATABASE: "orders-db"
SESSION_STORE: "shared"
CACHE_PREFIX: "orders"
```

Preparing, configuring and validating green before routing traffic keeps a failing candidate isolated and binds the switch to evidence from the candidate environment.

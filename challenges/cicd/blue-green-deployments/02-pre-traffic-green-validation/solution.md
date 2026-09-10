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

Correct shared runtime settings remove environment drift. A separate codec failure still blocks the switch, demonstrating that configuration cannot repair incompatible application bytes.

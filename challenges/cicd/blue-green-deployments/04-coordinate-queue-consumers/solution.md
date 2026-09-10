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
  - consumers:
      owner: "paused"
  - consumers:
      owner: "green"
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

Validation occurs before ownership changes. The passing path performs a deliberate consumer handoff; the failing path leaves blue serving and consuming.

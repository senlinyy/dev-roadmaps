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
  - wait:
      seconds: 240
  - retire: {}
```

### runtime.yaml

```yaml
DATABASE: "orders-db"
SESSION_STORE: "shared"
CACHE_PREFIX: "orders"
```

Blue remains a compatible recovery target until green is verified and the post-switch observation interval finishes. Cleanup is an explicit last transition.

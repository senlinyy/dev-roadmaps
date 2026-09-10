### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - select:
      release: "green"
  - attest:
      source: "commit-42"
      builder: "ci-builder"
  - stage:
      config: "runtime.yaml"
      secrets:
        - "secret/orders-db"
      parity: "parity.yaml"
  - smoke: {}
  - authorize:
      environment: "production"
      actor: "release-owner"
  - promote: {}
  - verify: {}
```

### runtime.yaml

```yaml
DATABASE: "orders-db"
SESSION_STORE: "shared"
CACHE_PREFIX: "orders"
```

### parity.yaml

```yaml
database: "postgres-16"
protocol: "https"
schema: "expanded"
```

Production authorization is a separate digest-bound gate. Neither a different candidate approval nor the builder authorizing itself completes the required chain.

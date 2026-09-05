### pipeline.yaml

```yaml
version: 2
jobs:
  recover:
    needs: []
    steps:
      -
        download:
          artifact: "previous"
      -
        recover:
          artifact: "previous"
          environment: "production"
          policy: "recovery.yaml"
```

### recovery.yaml

```yaml
compatible: true
verify: true
idempotent: true
attempts: 2
```

Recovery reuses retained bytes, checks current schema compatibility, and verifies each attempt. Repeated application converges rather than rebuilding or applying the transition twice. Incompatible recovery stops for an external decision.

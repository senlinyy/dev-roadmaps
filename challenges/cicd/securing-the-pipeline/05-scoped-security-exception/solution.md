### pipeline.yaml

```yaml
version: 2
jobs:
  build:
    needs: []
    steps:
      -
        checkout:
          ref: "candidate"
      -
        setup:
          runtime: "24"
      -
        install:
          mode: "locked"
      -
        check:
          name: "lint"
      -
        check:
          name: "unit"
      -
        build:
          artifact: "app"
      -
        upload:
          artifact: "app"
  release:
    needs:
      - "build"
    steps:
      -
        download:
          artifact: "app"
      -
        scan:
          kind: "image"
          artifact: "app"
          policy: "security.yaml"
      -
        deploy:
          artifact: "app"
          environment: "production"
          policy: "release.yaml"
```

### security.yaml

```yaml
block:
  - "high"
  - "critical"
exceptions: "exceptions.json"
```

### exceptions.json

```json
[
  {
    "id": "legacy-parser",
    "artifact": "app",
    "owner": "checkout-team",
    "approvedBy": "security-lead",
    "expires": 1100,
    "reason": "The affected parser path is disabled by the approved release configuration; upgrade tracked by checkout-team."
  }
]
```

### release.yaml

```yaml
security: true
```

The report policy stays active. Only a matching, owned, approved, unexpired exception permits the named finding. Its application is recorded, and an unrelated finding or unavailable report still blocks release.

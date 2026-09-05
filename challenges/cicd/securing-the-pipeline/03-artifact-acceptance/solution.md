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
        attest:
          artifact: "app"
          inventory: true
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
        accept:
          artifact: "app"
          policy: "acceptance.yaml"
      -
        deploy:
          artifact: "app"
          environment: "production"
          policy: "release.yaml"
```

### acceptance.yaml

```yaml
builders:
  - "trusted-ci"
source: "candidate-43"
signature: true
inventory: true
bindDigest: true
```

### release.yaml

```yaml
accepted: true
```

The producer derives inventory from resolved dependencies and attaches authored identity evidence. The consumer checks source, builder, signature result, inventory presence, and exact digest binding. This models verification decisions; it performs no real signing.

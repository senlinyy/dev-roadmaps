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
  staging:
    needs:
      - "build"
    steps:
      -
        download:
          artifact: "app"
      -
        deploy:
          artifact: "app"
          environment: "staging"
      -
        verify:
          artifact: "app"
          environment: "staging"
  production:
    needs:
      - "staging"
    steps:
      -
        download:
          artifact: "app"
      -
        approve:
          artifact: "app"
          environment: "production"
          policy: "approval.yaml"
      -
        deploy:
          artifact: "app"
          environment: "production"
          policy: "rollout.yaml"
```

### approval.yaml

```yaml
actors:
  - "release-manager"
bindArtifact: true
expires: true
```

### rollout.yaml

```yaml
approval: true
```

Approval is consumed only after staging succeeds and is bound to the candidate/environment. The rollout requires that consumed approval. Denial and expiry are modeled decisions, not syntax failures.

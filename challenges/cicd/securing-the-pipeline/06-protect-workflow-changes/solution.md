### pipeline.yaml

```yaml
version: 2
jobs:
  validate:
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
          name: "unit"
  integrate:
    needs:
      - "validate"
    steps:
      -
        review:
          policy: "review-policy.yaml"
      -
        merge:
          policy: "merge-policy.yaml"
```

### review-policy.yaml

```yaml
protectedPaths:
  - "pipeline.yaml"
  - ".ci/"
  - "deploy/"
owners:
  - "platform-team"
independent: true
minReviews: 1
checks:
  - "unit"
  - "workflow-policy"
```

### merge-policy.yaml

```yaml
checks:
  - "unit"
current: true
```

Ownership is applied to sensitive paths, independent review applies to every proposal, and both required safeguards remain active. The workflow consumes review before integration; it does not merely store an unused policy.

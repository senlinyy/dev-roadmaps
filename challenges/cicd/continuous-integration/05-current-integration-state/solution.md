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
          name: "lint"
      -
        check:
          name: "unit"
      -
        check:
          name: "types"
  integrate:
    needs:
      - "validate"
    steps:
      -
        merge:
          policy: "merge-policy.yaml"
```

### merge-policy.yaml

```yaml
checks:
  - "lint"
  - "unit"
  - "types"
current: true
```

The workflow produces current-candidate evidence and the policy consumes it through the dependency graph. Neither green results for head-42 nor an omitted check can establish that candidate-43 is ready.

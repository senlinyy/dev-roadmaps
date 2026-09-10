### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - mitigate:
      action: "pause-consumers"
  - recover:
      release: "hotfix"
      inspectCompatibility: true
      timeout: 60
  - verify: {}
```

Consumer containment stops processing harm while the compatible hotfix replaces the failing API. Queued messages remain intact and the operator retains control of resumption.

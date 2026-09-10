### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - recover:
      release: "hotfix"
      inspectCompatibility: true
      timeout: 60
  - verify: {}
```

Recovery follows the current schema forward to the narrow compatible fix. An unhealthy fix is held without deploying an incompatible previous binary.

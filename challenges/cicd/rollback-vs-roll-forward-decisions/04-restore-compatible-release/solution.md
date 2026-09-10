### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - recover:
      release: "blue"
      inspectCompatibility: true
      timeout: 60
  - verify: {}
```

The compatible previous release is restored and freshly verified. The incompatible case holds before mutation instead of treating an old version label as a guarantee.

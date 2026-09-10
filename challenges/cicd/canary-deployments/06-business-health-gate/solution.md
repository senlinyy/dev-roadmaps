### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - canary:
      weights:
        - "5"
        - "25"
        - "50"
        - "100"
      policy: "analysis.yaml"
      assignment: "sticky"
  - verify: {}
```

### analysis.yaml

```yaml
minRequests: 100
minSeconds: 300
maxErrorRate: 2
maxErrorIncrease: 0.5
maxLatency: 300
maxConversionDrop: 10
missing: "hold"
```

The policy evaluates both releases at each authored exposure, requires enough evidence, enforces technical and business budgets, and stops before a later traffic increase when a window is inconclusive or regresses.

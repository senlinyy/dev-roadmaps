### deployment.yaml

```yaml
version: 1
steps:
  - inspect: {}
  - mitigate:
      action: "disable-flag"
  - verify: {}
```

A targeted feature mitigation retains compatible running code. Fresh verification prevents the same flag action from falsely passing an unrelated outage.

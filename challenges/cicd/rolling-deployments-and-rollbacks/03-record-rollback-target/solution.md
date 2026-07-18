```yaml
rollback:
  task_definition: orders-api:41
  version: 1.8.3
  image_digest: sha256:2b91fe0a7a61
  data_compatibility: 1.8.3 can read rows written during the 1.8.4 rollout
  verification:
    - /version reports orders-api:41
    - /smoke/checkout passes
```

The rollback target is an immutable, known-good production state rather than a relative label. Compatibility and verification fields protect against a rollback that restores old code but cannot safely handle current data.

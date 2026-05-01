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

Rollback is safer when the target is named before the incident. The verification checks prove production actually returned to the intended task definition and still handles checkout.


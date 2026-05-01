```yaml
production:
  service: devpolaris-orders-api
  flags:
    FEATURE_DISCOUNT_V1: true
    FEATURE_DISCOUNT_V2: false
  audit:
    release_id: rel-2026-04-30-184
    updated_by: maya
    reason: canary discount errors returned to baseline after disabling v2
```

The recovery changes runtime behavior, not the deployed artifact. Keeping the old path enabled gives checkout a known-good fallback while the discount bug is fixed.


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

Disabling only the faulty behavior restores the known path without replacing a healthy artifact. The audit fields preserve who made the change, which release it affected, and the evidence behind it.

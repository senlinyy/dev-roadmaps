```yaml
decision:
  type: traffic revert
  reason: previous task set healthy and canary failure came from missing configuration
  evidence:
    - canary missing DISCOUNT_RULES_URL
    - stable task set orders-api:41 stayed healthy
  rejected_options:
    - option: patch_forward
      reason: not needed because artifact code was not the first cause
    - option: redeploy_previous_artifact
      reason: not needed because the stable task set was already healthy
  owner: Maya
```

The release record turns the recovery into shared memory. It shows the action, the evidence, and the paths the team intentionally did not take.


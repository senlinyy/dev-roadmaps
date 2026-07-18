---
title: "Disable the Isolated Flag"
sectionSlug: roll-forward
order: 2
---

Release `rel-2026-04-30-184` has a healthy canary artifact, but checkout fails only when the new discount engine runs. Maya owns the response, and the observed reason is `canary discount errors`. The bad path is controlled by a feature flag, so the smallest recovery move is to turn off that behavior and record why.

Your task:

1. **Disable `FEATURE_DISCOUNT_V2`** in production.
2. **Keep `FEATURE_DISCOUNT_V1` enabled** as the fallback path.
3. **Add an audit entry** with release id `rel-2026-04-30-184`, owner `maya`, and a reason containing `canary discount errors`.

The grader checks the feature flag config.

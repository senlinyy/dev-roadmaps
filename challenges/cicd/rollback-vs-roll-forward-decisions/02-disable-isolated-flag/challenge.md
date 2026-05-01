---
title: "Disable the Isolated Flag"
sectionSlug: disable-a-flag-when-the-bad-behavior-is-isolated
order: 2
---

The canary artifact is healthy, but checkout fails only when the new discount engine runs. The bad path is controlled by a feature flag, so the smallest recovery move is to turn off that behavior and record why.

Your task:

1. **Disable `FEATURE_DISCOUNT_V2`** in production.
2. **Keep `FEATURE_DISCOUNT_V1` enabled** as the fallback path.
3. **Add an audit entry** with the release id, owner, and reason.

The grader checks the feature flag config.

